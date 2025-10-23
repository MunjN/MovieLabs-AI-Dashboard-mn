// server.mjs (sort of)
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import { parse } from "csv-parse/sync";
import { OpenAI } from "openai";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPEN_AI_API_KEY });

// Load CSV dataset, keep complete rows
let dataset = [];
function loadDataset() {
  try {
    const fileContent = fs.readFileSync("./ai_db.csv", "utf8");
    const rows = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }).filter(
      row => row["INFRA_ID"] && row["NAME"] && row["AI_TYPE"] && row["TASKS"]
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

  const lowerMsg = message.toLowerCase();

  // Quick relevance check: if message seems unrelated, bail early
  const allowedKeywords = [
    "ai", "tool", "infrastructure", "dataset", "infra_id", "task", "model",
    "training", "inference", "name", "organization", "framework", "parent",
    "foundational_model", "year_launched", "funding"
  ];
  const isRelevant = allowedKeywords.some(k => lowerMsg.includes(k));
  if (!isRelevant) {
    return res.json({
      reply: "Sorry, I’m only able to help with questions related to the dashboard data."
    });
  }

  // Filter dataset for rows that mention the message text
  const relevantRows = dataset.filter(r => 
    Object.values(r).join(" ").toLowerCase().includes(lowerMsg)
  ).slice(0, 10);  // limit to top 10

  if (relevantRows.length === 0) {
    return res.json({
      reply: "Sorry, I couldn’t find anything related to that in the dataset."
    });
  }

  // Build a compact tabular dump of relevant rows
  const rowDump = relevantRows.map(r => {
    return `INFRA_ID: ${r.INFRA_ID} | NAME: ${r.NAME} | AI_TYPE: ${r.AI_TYPE} | TASKS: ${r.TASKS} | FOUNDATIONAL_MODEL: ${r.FOUNDATIONAL_MODEL} | YEAR_LAUNCHED: ${r.YEAR_LAUNCHED}`;
  }).join("\n");

  const systemPrompt = `
You are ME-AI, a precise assistant for the provided dataset of AI infrastructure tools.
### YOUR JOB:
- Use the dataset rows provided below.
- If the user asks about a specific tool (by NAME or INFRA_ID), find it and answer based on the dataset values (e.g., FOUNDATIONAL_MODEL, TASKS, YEAR_LAUNCHED).
- Do **not** describe the dataset structure or list columns generically.
- If the dataset does not contain the requested information, say: "I couldn’t find that information in the dataset."
- If the user asks something unrelated to the dataset, say: "Sorry, I’m only able to help with questions related to the dashboard data."
### STYLE:
- Answer concisely with the relevant values.
- Reference column names exactly.
`;

  // Streaming chat response
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const stream = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    stream: true,
    temperature: 0.2,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Relevant rows:\n${rowDump}\n\nUser question: ${message}` }
    ]
  });

  for await (const chunk of stream) {
    const token = chunk.choices?.[0]?.delta?.content || "";
    res.write(token);
  }
  res.end();
});

app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});
