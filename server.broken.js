import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import sqlite3pkg from "sqlite3";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import Groq from "groq-sdk";

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sqlite3 = sqlite3pkg.verbose();
const db = new sqlite3.Database(path.join(__dirname, "doubt_solver.db"));

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

if (!fs.existsSync(path.join(__dirname, "uploads"))) {
  fs.mkdirSync(path.join(__dirname, "uploads"));
}

/* =======================
   FILE UPLOAD SETUP
======================= */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "uploads"));
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

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
   DATABASE SETUP
======================= */
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS Doubts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_text TEXT,
      image_url TEXT,
      answer TEXT,
      steps TEXT,
      subject TEXT,
      topic TEXT,
      timestamp TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS DailyTasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT,
      task_type TEXT,
      topic TEXT,
      question_text TEXT,
      is_completed INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS WeakTopics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT,
      score INTEGER,
      last_updated TEXT
    )
  `);
});

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
          "You are a friendly Indian school teacher helping students in classes 1–12. Explain concepts very clearly and step by step."
      },
      ...messages
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
    followUpQuestion: ""
  };
}

/* =======================
   HEALTH CHECK
======================= */
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Doubt Solver API running" });
});

/* =======================
   IMAGE UPLOAD
======================= */
app.post("/upload-image", upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  const imageUrl = `/uploads/${req.file.filename}`;
  res.json({ imageUrl });
});

/* =======================
   ASK DOUBT (NO AUTH)
======================= */
app.post("/ask-doubt", async (req, res) => {
  try {
    const { messages, image_url } = req.body;

    if (!messages || messages.length === 0) {
      return res.status(400).json({ error: "Messages required" });
    }

    const result = await getAIResponse(messages);
    const { subject, topic, answer, steps, followUpQuestion } = result;

    const timestamp = new Date().toISOString();

    await run(
      "INSERT INTO Doubts (question_text, image_url, answer, steps, subject, topic, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        messages[messages.length - 1].content || null,
        image_url || null,
        answer,
        JSON.stringify(steps || []),
        subject || "General",
        topic || "General",
        timestamp
      ]
    );

    // Update weak topics
    const now = new Date().toISOString();
    const existing = await get(
      "SELECT * FROM WeakTopics WHERE topic = ?",
      [topic || "General"]
    );

    if (!existing) {
      await run(
        "INSERT INTO WeakTopics (topic, score, last_updated) VALUES (?, ?, ?)",
        [topic || "General", 1, now]
      );
    } else {
      await run(
        "UPDATE WeakTopics SET score = score + 1, last_updated = ? WHERE id = ?",
        [now, existing.id]
      );
    }

    return res.json({
      subject: subject || "General",
      topic: topic || "General",
      answer,
      steps: steps || [],
      followUpQuestion: followUpQuestion || ""
    });
  } catch (err) {
    console.error("Ask doubt error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =======================
   HISTORY
======================= */
app.get("/history", async (req, res) => {
  try {
    const rows = await all(
      "SELECT id, question_text, subject, topic, timestamp FROM Doubts ORDER BY timestamp DESC"
    );
    res.json({ history: rows });
  } catch (err) {
    console.error("History error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/history/:id", async (req, res) => {
  try {
    const row = await get(
      "SELECT * FROM Doubts WHERE id = ?",
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: "Not found" });

    row.steps = row.steps ? JSON.parse(row.steps) : [];
    res.json({ doubt: row });
  } catch (err) {
    console.error("History detail error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =======================
   DAILY TASKS
======================= */
async function ensureDailyTasks() {
  const today = new Date().toISOString().slice(0, 10);

  const existing = await all(
    "SELECT * FROM DailyTasks WHERE date = ?",
    [today]
  );
  if (existing.length >= 5) return existing;

  const weakTopics = await all(
    "SELECT * FROM WeakTopics ORDER BY score DESC LIMIT 3"
  );

  const topics = weakTopics.length > 0 ? weakTopics.map(t => t.topic) : ["General"];
  const tasks = [];

  for (let i = 0; i < 3; i++) {
    const topic = topics[i % topics.length];
    tasks.push({
      task_type: "practice",
      topic,
      question_text: `Practice question on ${topic} #${i + 1}`,
    });
  }

  tasks.push({
    task_type: "revision",
    topic: topics[0],
    question_text: `Revision question on ${topics[0]}`,
  });

  tasks.push({
    task_type: "concept",
    topic: topics[0],
    question_text: `Read a short concept note on ${topics[0]}`,
  });

  for (const t of tasks) {
    await run(
      "INSERT INTO DailyTasks (date, task_type, topic, question_text, is_completed) VALUES (?, ?, ?, ?, ?)",
      [today, t.task_type, t.topic, t.question_text, 0]
    );
  }

  const allToday = await all(
    "SELECT * FROM DailyTasks WHERE date = ?",
    [today]
  );
  return allToday;
}

app.get("/daily-tasks", async (req, res) => {
  try {
    const tasks = await ensureDailyTasks();
    res.json({ tasks });
  } catch (err) {
    console.error("Daily tasks error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =======================
   COMPLETE TASK
======================= */
app.post("/complete-task", async (req, res) => {
  try {
    const { taskId } = req.body;
    if (!taskId) {
      return res.status(400).json({ error: "taskId required" });
    }

    await run(
      "UPDATE DailyTasks SET is_completed = 1 WHERE id = ?",
      [taskId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Complete task error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =======================
   WEAK TOPICS
======================= */
app.get("/weak-topics", async (req, res) => {
  try {
    const rows = await all(
      "SELECT topic, score FROM WeakTopics ORDER BY score DESC LIMIT 5"
    );
    res.json({ weakTopics: rows });
  } catch (err) {
    console.error("Weak topics error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =======================
   START SERVER
======================= */
app.listen(PORT, () => {
  console.log(`Doubt Solver backend running on http://localhost:${PORT}`);
});
