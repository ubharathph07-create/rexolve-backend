import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Groq } from "groq-sdk";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

/* ===================== HEALTH CHECK (IMPORTANT) ===================== */

app.get("/", (req, res) => {
res.send("OK");
});

/* ===================== SETUP ===================== */

const groq = new Groq({
apiKey: process.env.GROQ_API_KEY,
});

/* ===================== HELPERS ===================== */

function wantsWordList(text) {
const t = text.toLowerCase();
return (
t.includes("only words") ||
t.includes("just words") ||
t.includes("not a passage") ||
t.includes("not a paragraph") ||
t.includes("no explanation")
);

}

function extractWords(text) {
return text
.replace(/[^a-zA-Z\s]/g, " ")
.split(/\s+/)
.filter(Boolean);
}


function extractRequestedCount(text) {
const match = text.match(/(\d+)\s+words?/i);
return match ? parseInt(match[1], 10) : null;
}

function extractStartingLetter(text) {
const match = text.match(/starting with\s+([a-z])/i);
return match ? match[1].toLowerCase() : null;
}

/* ===================== ROUTE ===================== */ 

app.post("/ask-doubt", async (req, res) => {
try {
const { messages } = req.body;
if (!messages || !Array.isArray(messages) || messages.length === 0) {
return res.status(400).json({ error: "Missing messages" });

}

  

const lastUserMessage =
messages[messages.length - 1].content || "";
const completion = await groq.chat.completions.create({
model: "llama-3.1-8b-instant",
messages: [
{
role: "system",
content: `
You are a calm, neutral expert advisor.

Give concise, balanced recommendations for everyday decisions.
Default to short natural paragraphs of 3–4 sentences.

Guidelines:

- Start with a clear conclusion.
- Add one or two key reasons.
- Include one condition or tradeoff when relevant.
- Avoid rigid templates unless they improve clarity.
- Avoid commands and moral language.
- Prefer conditional, tradeoff-based advice over directives.
- Admit uncertainty when information is insufficient.
- Be professional, neutral, and non-judgmental.
- Preserve user agency: advise, do not decide.
- Optimize for trust, clarity, and natural expert communication.

Only provide detailed explanations if the user explicitly asks for more detail.
When explaining, be structured and balanced.

`,

},

...messages,
],
temperature: 0.2,
max_tokens: 700,
});

let answer = completion.choices[0].message.content;  

/* ===================== FORMAT ENFORCEMENT ===================== */

if (wantsWordList(lastUserMessage)) {
let words = extractWords(answer);

const letter = extractStartingLetter(lastUserMessage);
if (letter) {
words = words.filter((w) =>
w.toLowerCase().startsWith(letter)
);
}

const unique = [
...new Set(words.map((w) => w.toLowerCase())),
];

const requestedCount =
extractRequestedCount(lastUserMessage);

let finalWords = unique;
if (requestedCount) {
finalWords = unique.slice(0, requestedCount);
}

answer = finalWords.join(", ");

}

res.json({ answer });
} catch (err) {
console.error("AI error:", err);
res.status(500).json({ error: "AI error" });
}

});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
console.log(`Backend running on port ${PORT}`);

});