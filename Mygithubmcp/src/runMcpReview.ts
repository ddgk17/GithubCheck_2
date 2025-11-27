import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

type TextContent = { type: "text"; text: string };

function ensureEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} environment variable is required`);
    }
    return value;
}

function extractText(result: any): string {
    if (result.isError) {
        const message = result.error?.message || "Tool returned an error";
        throw new Error(message);
    }
    const contents: TextContent[] = (result.content || []).filter(
        (item: any): item is TextContent => item?.type === "text" && typeof item.text === "string"
    );
    if (contents.length === 0) {
        throw new Error("Tool response did not include text content");
    }
    return contents.map((c) => c.text.trim()).filter(Boolean).join("\n\n");
}

async function main() {
    const serverUrl = process.env.MCP_SERVER_URL || "http://localhost:3100/mcp";
    const owner = ensureEnv("GITHUB_OWNER");
    const repo = ensureEnv("GITHUB_REPO");
    const pullNumberRaw = ensureEnv("GITHUB_PR_NUMBER");
    const pull_number = Number(pullNumberRaw);
    if (Number.isNaN(pull_number)) {
        throw new Error(`GITHUB_PR_NUMBER must be numeric. Received ${pullNumberRaw}`);
    }

    const query = process.env.MCP_REVIEW_QUERY;
    const heading = process.env.MCP_COMMENT_HEADING;
    const footer = process.env.MCP_COMMENT_FOOTER;
    const defaultQuery = `You are reviewing pull request ${owner}/${repo}#${pull_number}. Provide:
1. A concise summary of the changes
2. Potential bugs or regressions
3. Code quality or style issues
4. Security or performance risks
5. Actionable follow-up suggestions

Reference file names and line numbers where possible.`;
    const effectiveQuery = query && query.trim().length > 0 ? query : defaultQuery;

    const transport = new StreamableHTTPClientTransport(new URL(serverUrl));
    const client = new Client({ name: "github-actions-runner", version: "1.0.0" });

    try {
        await client.connect(transport);
        await client.listTools();

        const analysisResult = await client.callTool({
            name: "analyze_pr_files",
            arguments: {
                owner,
                repo,
                pull_number,
                query: effectiveQuery,
            },
        });

        const analysisText = extractText(analysisResult);

        const bodyParts: string[] = [];
        if (heading) bodyParts.push(heading);
        bodyParts.push(analysisText);
        if (footer) bodyParts.push(footer);
        const body = bodyParts.join("\n\n---\n\n");

        await client.callTool({
            name: "post_pr_comment",
            arguments: {
                owner,
                repo,
                pull_number,
                body,
            },
        });

        console.log("PR review comment posted successfully");
    } finally {
        await transport.close();
    }
}

main().catch((error) => {
    console.error("Failed to run MCP review:", error);
    process.exit(1);
});

