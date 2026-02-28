import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";

const db = new Database("korean_srs.db");

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    korean TEXT NOT NULL,
    vietnamese TEXT NOT NULL,
    interval INTEGER DEFAULT 0,
    repetition INTEGER DEFAULT 0,
    easiness REAL DEFAULT 2.5,
    nextReview INTEGER DEFAULT 0,
    createdAt INTEGER DEFAULT (strftime('%s', 'now') * 1000)
  )
`);

async function startServer() {
  const app = express();
  app.use(express.json());

  // API Routes
  app.get("/api/words", (req, res) => {
    const words = db.prepare("SELECT * FROM words ORDER BY createdAt DESC").all();
    res.json(words);
  });

  app.get("/api/words/due", (req, res) => {
    const now = Date.now();
    const words = db.prepare("SELECT * FROM words WHERE nextReview <= ?").all(now);
    res.json(words);
  });

  app.post("/api/words", (req, res) => {
    const { korean, vietnamese } = req.body;
    const info = db.prepare("INSERT INTO words (korean, vietnamese, nextReview) VALUES (?, ?, ?)").run(korean, vietnamese, Date.now());
    res.json({ id: info.lastInsertRowid });
  });

  app.post("/api/words/:id/review", (req, res) => {
    const { id } = req.params;
    const { quality } = req.body; // 0 (forgot) to 5 (perfect)
    
    // Simplified SM-2 Algorithm
    const word = db.prepare("SELECT * FROM words WHERE id = ?").get(id);
    if (!word) return res.status(404).json({ error: "Word not found" });

    let { interval, repetition, easiness } = word;

    if (quality >= 3) {
      if (repetition === 0) {
        interval = 1;
      } else if (repetition === 1) {
        interval = 6;
      } else {
        interval = Math.round(interval * easiness);
      }
      repetition++;
    } else {
      repetition = 0;
      interval = 1;
    }

    easiness = easiness + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (easiness < 1.3) easiness = 1.3;

    const nextReview = Date.now() + interval * 24 * 60 * 60 * 1000;

    db.prepare("UPDATE words SET interval = ?, repetition = ?, easiness = ?, nextReview = ? WHERE id = ?")
      .run(interval, repetition, easiness, nextReview, id);

    res.json({ success: true, nextReview });
  });

  app.delete("/api/words/:id", (req, res) => {
    db.prepare("DELETE FROM words WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist/index.html"));
    });
  }

  const PORT = 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
