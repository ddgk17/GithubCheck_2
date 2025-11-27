import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is required");
}

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

export async function analyzePRFiles(
    files: { filename: string; patch?: string }[],
    query?: string
): Promise<string> {
    const fileSummaries = files
        .map((f) => {
            const patch = f.patch || "No patch available";
            return `### File: ${f.filename}\n\`\`\`diff\n${patch}\n\`\`\``;
        })
        .join("\n\n");

    const defaultQuery = `You are an expert GitHub pull request reviewer. Analyze the following changes and provide:
1. A summary of what changed
2. Potential bugs or regressions
3. Code quality concerns
4. Security considerations
5. Actionable suggestions

Reference file names and line numbers where possible.`;

    const prompt = `${query || defaultQuery}\n\n## Pull Request Changes:\n\n${fileSummaries}`;

    try {
        const result = await model.generateContent(prompt);
        const response = result.response;
        return response.text();
    } catch (error) {
        console.error("Error calling Gemini API:", error);
        throw new Error(`AI analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

