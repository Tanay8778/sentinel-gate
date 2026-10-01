import express, { Request, Response } from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { SentinelEngine } from "./engine.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// Serve the interactive playground UI from the 'public' folder
app.use(express.static(path.join(__dirname, "../public")));

const engine = new SentinelEngine();
const PORT = process.env.PORT || 3000;

// Health check endpoint
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    status: "healthy",
    service: "SentinelGate Incident Triage Gateway",
    timestamp: new Date().toISOString(),
    llmProvider: process.env.GEMINI_API_KEY ? "Google Gemini 1.5 Flash" : "Sentinel Self-Repair Simulator",
  });
});

// Main Triage API
app.post("/api/triage", async (req: Request, res: Response): Promise<void> => {
  const { ticket, maxTurns } = req.body;

  if (!ticket || typeof ticket !== "string" || ticket.trim().length === 0) {
    res.status(400).json({
      error: "Bad Request: 'ticket' field (non-empty string) is required.",
    });
    return;
  }

  try {
    const turns = typeof maxTurns === "number" && maxTurns > 0 ? maxTurns : 3;
    const result = await engine.triageTicket(ticket, turns);

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(422).json(result);
    }
  } catch (err: any) {
    console.error("Unhandled error processing triage request:", err);
    res.status(500).json({
      error: "Internal Server Error",
      message: err.message || "Failed to process incident report",
    });
  }
});

app.listen(PORT, () => {
  console.log(`
🛡️  ==============================================================
   SentinelGate: Autonomous Guarded Triage Gateway running
   Dashboard: http://localhost:${PORT}
   Mode:      ${process.env.GEMINI_API_KEY ? "Live Gemini AI API" : "Interactive Simulation Mode"}
   Endpoint:  POST http://localhost:${PORT}/api/triage
==============================================================
  `);
});
