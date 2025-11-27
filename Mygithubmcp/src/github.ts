import { Octokit } from "@octokit/rest";
import dotenv from "dotenv";

dotenv.config();

const token = process.env.GITHUB_TOKEN;
if (!token) {
    throw new Error("GITHUB_TOKEN environment variable is required");
}

const octokit = new Octokit({ auth: token });

export interface PRDetails {
    title: string;
    description: string;
    url: string;
    number: number;
    state: string;
    files: {
        filename: string;
        status: string;
        additions: number;
        deletions: number;
        patch?: string;
    }[];
}

export async function getPRDetails(
    owner: string,
    repo: string,
    pull_number: number
): Promise<PRDetails> {
    const { data: pr } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number,
    });

    const { data: files } = await octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number,
        per_page: 100,
    });

    return {
        title: pr.title,
        description: pr.body || "",
        url: pr.html_url,
        number: pr.number,
        state: pr.state,
        files: files.map((f) => ({
            filename: f.filename,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch ?? undefined,
        })),
    };
}

export async function postPRComment(
    owner: string,
    repo: string,
    pull_number: number,
    body: string
): Promise<string> {
    const { data: comment } = await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: pull_number,
        body,
    });

    return comment.html_url;
}

