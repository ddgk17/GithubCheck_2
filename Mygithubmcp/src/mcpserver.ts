import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getPRDetails, postPRComment } from "./github.ts";
import { analyzePRFiles } from "./ai.ts";

const server = new Server(
    {
        name: "github-pr-reviewer",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "analyze_pr_files",
                description: "Analyze GitHub PR files using AI",
                inputSchema: {
                    type: "object",
                    properties: {
                        owner: { type: "string", description: "GitHub repository owner" },
                        repo: { type: "string", description: "Repository name" },
                        pull_number: { type: "number", description: "Pull request number" },
                        query: { type: "string", description: "Optional analysis instructions" },
                    },
                    required: ["owner", "repo", "pull_number"],
                },
            },
            {
                name: "post_pr_comment",
                description: "Post a comment on a GitHub pull request",
                inputSchema: {
                    type: "object",
                    properties: {
                        owner: { type: "string", description: "GitHub repository owner" },
                        repo: { type: "string", description: "Repository name" },
                        pull_number: { type: "number", description: "Pull request number" },
                        body: { type: "string", description: "Comment text" },
                    },
                    required: ["owner", "repo", "pull_number", "body"],
                },
            },
        ],
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "analyze_pr_files") {
        const schema = z.object({
            owner: z.string(),
            repo: z.string(),
            pull_number: z.number(),
            query: z.string().optional(),
        });
        const { owner, repo, pull_number, query } = schema.parse(args);
        const details = await getPRDetails(owner, repo, pull_number);
        const analysis = await analyzePRFiles(details.files, query);
        return {
            content: [
                {
                    type: "text",
                    text: analysis,
                },
            ],
        };
    }

    if (name === "post_pr_comment") {
        const schema = z.object({
            owner: z.string(),
            repo: z.string(),
            pull_number: z.number(),
            body: z.string(),
        });
        const { owner, repo, pull_number, body } = schema.parse(args);
        const url = await postPRComment(owner, repo, pull_number, body);
        return {
            content: [
                {
                    type: "text",
                    text: `Comment posted successfully: ${url}`,
                },
            ],
        };
    }

    throw new Error(`Unknown tool: ${name}`);
});

const app = express();
app.use(express.json({ limit: "4mb" }));

const corsOrigins = process.env.MCP_CORS_ORIGINS
    ? process.env.MCP_CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
    : [];
app.use(
    cors({
        origin: corsOrigins.length > 0 ? corsOrigins : "*",
        exposedHeaders: ["Mcp-Session-Id"],
        allowedHeaders: ["Content-Type", "Mcp-Session-Id"],
    })
);

function parseList(value?: string): string[] | undefined {
    if (!value) {
        return undefined;
    }
    const parts = value.split(",").map((v) => v.trim()).filter(Boolean);
    return parts.length > 0 ? parts : undefined;
}

const transports = new Map<string, StreamableHTTPServerTransport>();

function createTransport(): StreamableHTTPServerTransport {
    const allowedHosts = parseList(process.env.MCP_ALLOWED_HOSTS);
    const allowedOrigins = parseList(process.env.MCP_ALLOWED_ORIGINS);

    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableDnsRebindingProtection: process.env.MCP_ENABLE_DNS_REBINDING === "true",
        allowedHosts,
        allowedOrigins,
        onsessioninitialized: (sessionId) => {
            transports.set(sessionId, transport);
        },
        onsessionclosed: (sessionId) => {
            transports.delete(sessionId);
        },
    });

    transport.onclose = () => {
        if (transport.sessionId) {
            transports.delete(transport.sessionId);
        }
    };

    return transport;
}

async function handleSessionBoundRequest(
    req: Parameters<express.RequestHandler>[0],
    res: Parameters<express.RequestHandler>[1]
) {
    const sessionId = req.header("Mcp-Session-Id");
    if (!sessionId) {
        res.status(400).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Missing Mcp-Session-Id header" },
            id: null,
        });
        return;
    }
    const transport = transports.get(sessionId);
    if (!transport) {
        res.status(404).json({
            jsonrpc: "2.0",
            error: { code: -32004, message: "Session not found" },
            id: null,
        });
        return;
    }

    try {
        await transport.handleRequest(req, res);
    } catch (error) {
        console.error("Error handling session-bound MCP request:", error);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: "2.0",
                error: { code: -32603, message: "Internal server error" },
                id: null,
            });
        }
    }
}

app.post("/mcp", async (req, res) => {
    const sessionId = req.header("Mcp-Session-Id");
    let transport = sessionId ? transports.get(sessionId) : undefined;

    try {
        if (!transport) {
            if (!isInitializeRequest(req.body)) {
                res.status(400).json({
                    jsonrpc: "2.0",
                    error: { code: -32600, message: "Expected initialization request for new session" },
                    id: null,
                });
                return;
            }
            transport = createTransport();
            await server.connect(transport);
        }

        await transport.handleRequest(req, res, req.body);
    } catch (error) {
        console.error("Error handling MCP POST request:", error);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: "2.0",
                error: { code: -32603, message: "Internal server error" },
                id: null,
            });
        }
    }
});

app.get("/mcp", handleSessionBoundRequest);
app.delete("/mcp", handleSessionBoundRequest);

const port = Number(process.env.MCP_PORT || 3100);

app
    .listen(port, () => {
        console.error(`GitHub PR Reviewer MCP Server running on http://0.0.0.0:${port}/mcp`);
    })
    .on("error", (error) => {
        console.error("Fatal error starting MCP server:", error);
        process.exit(1);
    });

