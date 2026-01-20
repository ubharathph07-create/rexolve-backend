import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import sqlite3pkg from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import Groq from "groq-sdk";

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sqlite3 = sqlite3pkg.verbose();
const db = new sqlite3.Database(
  path.join(__dirname, "doubt_solver.db")
);

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

if (!fs.existsSync(path.join(__dirname, "uploads"))) {
  fs.mkdirSync(path.join(__dirname, "uploads"));
}

/* =======================
   SQLITE HELPERS
======================= */
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

/* =======================
   AI RESPONSE
======================= */
async function getAIResponse(messages) {
  const completion = await groq.chat.completions.create({
    model: "llama-3.1-70b-versatile",
    messages: [
      {
        role: "system",
        content:
          "You are a friendly Indian school teacher helping students in classes 1–12. Explain concepts very clearly and step by step.",
      },
      ...messages,
    ],
    temperature: 0.4,
  });

  const content =
    completion.choices[0]?.message?.content ||
    "Sorry, I could not generate an answer.";

  return {
    subject: "General",
    topic: "General",
    answer: content,
    steps: [],
    followUpQuestion: "",
  };
}

/* =======================
   HEALTH CHECK
======================= */
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Doubt Solver API running" });
});

/* =======================
   START SERVER
======================= */
app.listen(PORT, () => {
  console.log(
    `Doubt Solver backend running on http://localhost:${PORT}`
  );
});
