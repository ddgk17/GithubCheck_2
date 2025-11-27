import express from "express";
import cors from "cors";
import { analyzePRFiles } from "./ai.ts";
import { getPRDetails, postPRComment } from "./github.ts";

const WEBHOOK_PORT = Number(process.env.WEBHOOK_PORT || process.env.PORT || 4100);
const BODY_LIMIT = process.env.WEBHOOK_BODY_LIMIT || "1mb";
const allowedEvents = new Set(
    (process.env.GITHUB_PR_EVENTS || "pull_request")
        .split(",")
        .map((event) => event.trim())
        .filter(Boolean)
);
const allowedActions = new Set(
    (process.env.GITHUB_PR_ACTIONS || "opened,synchronize,reopened,ready_for_review")
        .split(",")
        .map((action) => action.trim())
        .filter(Boolean)
);

const app = express();
app.use(express.json({ limit: BODY_LIMIT }));
app.use(
    cors({
        origin: process.env.WEBHOOK_CORS_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean) || "*",
    })
);

app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "github-pr-reviewer", timestamp: new Date().toISOString() });
});

app.post("/github/webhook", async (req, res) => {
    const eventKey = req.header("X-GitHub-Event") || "";
    if (!allowedEvents.has(eventKey)) {
        res.status(202).json({ skipped: true, reason: "unsupported_event", eventKey });
        return;
    }

    const action = req.body?.action;
    if (action && !allowedActions.has(action)) {
        res.status(202).json({ skipped: true, reason: "unsupported_action", eventKey, action });
        return;
    }

    const pullRequest = req.body?.pull_request;
    const repository = req.body?.repository;
    const owner = repository?.owner?.login || repository?.owner?.name;
    const repo = repository?.name;
    const pullNumber = pullRequest?.number;

    if (!owner || !repo || typeof pullNumber !== "number") {
        res.status(400).json({
            error: "invalid_payload",
            message: "Missing owner, repo, or pull request number in webhook payload",
        });
        return;
    }

    try {
        console.info(`Processing GitHub webhook ${eventKey}:${action} for ${owner}/${repo}#${pullNumber}`);
        const prDetails = await getPRDetails(owner, repo, pullNumber);
        const analysis = await analyzePRFiles(prDetails.files);
        const heading =
            process.env.GITHUB_COMMENT_HEADING || `Automated PR Review for #${prDetails.number}`;
        const footer =
            process.env.GITHUB_COMMENT_FOOTER || "_Generated automatically by GitHub PR Reviewer_.";
        const commentBody = `${heading}\n\n${analysis}\n\n---\n${footer}`;
        const commentUrl = await postPRComment(owner, repo, pullNumber, commentBody);
        res.json({
            ok: true,
            commentUrl,
        });
    } catch (error) {
        console.error("Failed to handle GitHub webhook:", error);
        res.status(500).json({
            error: "processing_failed",
            message: error instanceof Error ? error.message : "Unknown error",
        });
    }
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("Unhandled webhook error:", err);
    res.status(500).json({ error: "internal_error", message: err.message });
});

app.listen(WEBHOOK_PORT, () => {
    console.log(`GitHub webhook server listening on http://0.0.0.0:${WEBHOOK_PORT}`);
});

