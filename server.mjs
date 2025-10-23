import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import { parse } from "csv-parse/sync";
import { OpenAI } from "openai";

dotenv.config();

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPEN_AI_API_KEY });

// 🔹 Load CSV: keep only complete rows
let dataset = [];
function loadDataset() {
  try {
    const fileContent = fs.readFileSync("./ai_db.csv", "utf8");
    const rows = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }).filter(
      (row) =>
        row["INFRA_ID"] && row["NAME"] && row["AI_TYPE"] && row["TASKS"]
    );
    dataset = rows;
    console.log(`✅ Loaded ${rows.length} valid rows`);
  } catch (err) {
    console.error("❌ Failed to load CSV:", err);
  }
}
loadDataset();

app.post("/chat", async (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'message'." });
  }

  try {
    // inject all rows (cleaned)
    const rowDump = dataset.map((row, i) => `Row ${i + 1}: ${JSON.stringify(row)}`).join("\n");

    // 🔧 SYSTEM PROMPT
    const systemPrompt = `
You are ME-AI, a scoped assistant that ONLY answers questions based on the dataset of AI infrastructure tools provided.

## ANALYSIS BEHAVIOR (DATA SCIENTIST MODE)
- Act like a data scientist: filter, group, summarize, compare
- Use frequency, trends, ranges, and clustering across columns
- Be precise and structured in how you answer
- Reference column names exactly (e.g., AI_TYPE, GENERATED_OUTPUT)

## IDENTIFIERS
- Each row includes a unique identifier: INFRA_ID
- You can use INFRA_ID to filter, lookup, compare, or cross-reference rows
- If a user asks "tell me about tool X" or "what is this ID", find it using either NAME or INFRA_ID

## INTERNET ACCESS RULE
You may only use the internet via the tool \`search(query)\` IF:
1. The user asks for additional info about a known tool in the dataset
2. The dataset does not already contain the answer
3. The entity is clearly found in NAME, LINK, or PARENT_ORGANIZATION

Never search the internet for topics unrelated to the dataset.

## OUT OF SCOPE RULE
If the user asks something not related to this dataset, say:
"Sorry, I’m only able to help with questions related to the dashboard data."
`;

    // 🔹 USER PROMPT: inject all rows (cleaned)
    const userPrompt = `
The dataset includes ${dataset.length} rows and 24 columns.

Here is the full dataset:
${rowDump}

User Question:
${message}
`;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      stream: true,
      temperature: 0.3,
      tools: [
        {
          type: "function",
          function: {
            name: "search",
            description: "Use this to enrich known tools/entities if data is missing from the dataset",
            parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Search query for additional company or tool details",
                },
              },
              required: ["query"],
            },
          },
        },
      ],
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    for await (const chunk of stream) {
      const token = chunk.choices?.[0]?.delta?.content || "";
      res.write(token);
    }

    res.end();
  } catch (err) {
    console.error("❌ Chat stream error:", err);
    res.status(500).json({ error: "Streaming chat failed." });
  }
});


// Power BI endpoints unchanged
app.post("/auth-token", async (req, res) => {
  const tenantId = process.env.TENANT_ID;
  const clientId = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;

  const authUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const scope = "https://analysis.windows.net/powerbi/api/.default";

  try {
    const response = await fetch(authUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: scope,
      }),
    });

    if (!response.ok) throw new Error("Auth token request failed");

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Auth token error:", error);
    res.status(500).json({ error: "Failed to fetch auth token" });
  }
});

app.post("/embed-token", async (req, res) => {
  const groupId = "4c6a6199-2d9c-423c-a366-7e72edc983ad";
  const reportId = "9f92cc54-8318-44c4-a671-a020ea14ef56";
  const authToken = req.body.authToken;

  try {
    const response = await fetch(
      `https://api.powerbi.com/v1.0/myorg/groups/${groupId}/reports/${reportId}/GenerateToken`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ accessLevel: "View" }),
      }
    );

    if (!response.ok) throw new Error("Failed to get embed token");

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Embed token error:", error);
    res.status(500).json({ error: "Failed to get embed token" });
  }
});

app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});
