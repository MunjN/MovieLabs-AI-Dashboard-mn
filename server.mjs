import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import { parse } from "csv-parse/sync";
import { OpenAI } from "openai";
import google from "googlethis";
import fetch from "node-fetch";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPEN_AI_API_KEY });

/* =========================================================
   🔹 LOAD CSV DATASET
   ========================================================= */
let dataset = [];
let fullDatasetDump = ""; // 👈 ADDED: Global var to hold the entire dataset dump

function loadDataset() {
  try {
    const fileContent = fs.readFileSync("./ai_db.csv", "utf8");
    const rows = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }).filter(
      (r) => r["INFRA_ID"] && r["NAME"] && r["AI_TYPE"] && r["TASKS"]
    );

    dataset = rows;
    console.log(`✅ Loaded ${rows.length} valid rows`);

    // --- 👇 ADDED THIS BLOCK ---
    // Pre-process the entire dataset into a single string
    fullDatasetDump = rows
      .map(
        (r) =>
          `INFRA_ID: ${r.INFRA_ID} | NAME: ${r.NAME} | AI_TYPE: ${r.AI_TYPE} | TASKS: ${r.TASKS} | FOUNDATIONAL_MODEL: ${r.FOUNDATIONAL_MODEL} | YEAR_LAUNCHED: ${r.YEAR_LAUNCHED}`
      )
      .join("\n");
    console.log(`✅ Pre-processed full dataset dump`);
    // --- 👆 END OF NEW BLOCK ---

  } catch (err) {
    console.error("❌ Failed to load CSV:", err);
  }
}
loadDataset();

/* =========================================================
   🔹 SYSTEM PROMPT
   ========================================================= */
const systemPrompt = `
You are ME-AI — a friendly yet precise assistant for the ME-NEXUS dashboard.

### PERSONALITY
- Greet the user naturally (e.g., "Hey there!", "Welcome back!", "Hope your day’s going great!").
- Keep a warm, conversational tone but remain professional and helpful.

### KNOWLEDGE
You have access to a dataset of AI infrastructure tools (each with NAME, INFRA_ID, TASKS, FOUNDATIONAL_MODEL, etc.).

### INTERNET ACCESS
You may use the "search(query)" tool ONLY to:
1. Find **recent updates, news, or announcements** about tools already in the dataset.
2. Get more details about a known tool if the dataset lacks that info.

### RULES
- If the user asks about a tool, find it by NAME or INFRA_ID and answer directly from the dataset.
- If the question is unrelated to AI tools or the dashboard, respond:
  "Sorry, I can only help with questions about AI tools and dashboard data."
- If the data doesn’t exist in the dataset, use the web search.
- Always answer concisely and politely.
`;

/* =========================================================
   🔹 SIMPLE IN-MEMORY SESSION CONTEXT
   ========================================================= */
const sessions = new Map();

/* =========================================================
   🔹 CHAT ENDPOINT
   ========================================================= */
app.post("/chat", async (req, res) => {
  const { message, sessionId } = req.body;
  if (!message) return res.status(400).json({ error: "Missing 'message'." });

  const history = sessions.get(sessionId) || [];

  // --- ⛔️ REMOVED FILTERING LOGIC ⛔️ ---
  // const lowerMsg = message.toLowerCase();
  // const relevantRows = dataset.filter(...)
  // const rowDump = relevantRows.map(...)
  // --- ⛔️ END OF REMOVAL ⛔️ ---

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      stream: true,
      temperature: 0.25,
      tools: [
        {
          type: "function",
          function: {
            name: "search",
            description:
              "Fetch recent info or updates about a known tool from the web",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "Search query text" },
              },
              required: ["query"],
            },
          },
        },
      ],
      messages: [
        { role: "system", content: systemPrompt },
        ...history,
        {
          role: "user",
          // --- 👇 MODIFIED THIS LINE ---
          content: `Here is the full dataset:\n${fullDatasetDump}\n\nUser: ${message}`,
          // --- 👆 END OF MODIFICATION ---
        },
      ],
    });

    let buffer = "";

    for await (const chunk of completion) {
      const choice = chunk.choices?.[0];
      const toolCall = choice?.delta?.tool_calls?.[0];
      const token = choice?.delta?.content || "";

      // Stream text tokens directly
      if (token) {
        buffer += token;
        res.write(token);
      }

      // Handle tool call (web search)
      if (toolCall && toolCall.function?.name === "search") {
        // 👇 FIX: Protect against partial tool arguments
        let q = null;
        try {
          const args = JSON.parse(toolCall.function.arguments || "{}");
          q = args.query;
        } catch (err) {
          console.warn("⚠️ Skipping incomplete tool arguments:", toolCall.function.arguments);
          continue; // wait for the next chunk
      . }

        if (q) {
          console.log(`🌐 ME-AI websearch: ${q}`);
          try {
            const searchResults = await google.search(q, { safe: false });
            const summary = searchResults.results
              .slice(0, 3)
              .map(
                (r) =>
                  `• [${r.title}](${r.url}) — ${r.description?.slice(0, 200) || ""}`
              )
              .join("\n");

            const followUp = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              temperature: 0.3,
              messages: [
                { role: "system", content: systemPrompt },
                {
                  role: "user",
                  content: `Here are web search results for "${q}":\n${summary}\n\nSummarize in two concise sentences.`,
                },
              ],
            });

            const final = followUp.choices[0].message.content;
            buffer += "\n\n" + final;
            res.write("\n\n" + final);
          } catch (err) {
            console.error("Web search failed:", err);
            res.write("\n\n(Sorry, I couldn’t fetch live updates right now.)\n");
          }
        }
      }
    }

    // Save short-term context
D    history.push({ role: "user", content: message });
    history.push({ role: "assistant", content: buffer });
    sessions.set(sessionId, history);

    res.end();
  } catch (err) {
    console.error("❌ Chat stream error:", err);
    if (!res.headersSent)
      res.status(500).json({ error: "Streaming chat failed." });
    else res.end("\n\n[Error: Chat stream failed]");
  }
});

/* =========================================================
   🔹 POWER BI AUTH + EMBED ENDPOINTS
   ========================================================= */
app.post("/auth-token", async (req, res) => {
D  const { TENANT_ID, CLIENT_ID, CLIENT_SECRET } = process.env;
  const authUrl = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const scope = "https://analysis.windows.net/powerbi/api/.default";

  try {
    const response = await fetch(authUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
D      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope,
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
t}
});

/* =========================================================
   🔹 START SERVER
   ========================================================= */
app.listen(port, () => {
  console.log(`🚀 ME-AI backend running on http://localhost:${port}`);
});
