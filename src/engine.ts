import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  IncidentReport,
  IncidentReportSchema,
  PolicyGuardrailEngine,
  formatDiagnostics,
} from "./schema.js";

export interface PipelineTraceTurn {
  turn: number;
  stage: "SCHEMA_VALIDATION" | "POLICY_VERIFICATION" | "COMPLETED";
  passed: boolean;
  diagnostics?: string;
  rawOutput: string;
}

export interface TriageResult {
  success: boolean;
  data: IncidentReport | null;
  metrics: {
    totalTurns: number;
    latencyMs: number;
    recoveredViaSelfRepair: boolean;
  };
  trace: PipelineTraceTurn[];
  error?: string;
}

const SYSTEM_PROMPT = `
You are SentinelGate: an autonomous, mission-critical IT incident triage engine.
Your sole job is to translate unstructured, messy incident logs into strictly validated JSON.

OUTPUT REQUIREMENTS:
- You must output ONLY a valid JSON object matching this schema.
- Do NOT wrap in conversational text.
- Do NOT invent or hallucinate unsupported enum values.

SCHEMA DEFINITION:
{
  "severity": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "category": "DATABASE" | "AUTH" | "NETWORK" | "INFRASTRUCTURE",
  "serviceName": string,
  "summary": string,
  "rootCause": string,
  "action": "RESTART_POD" | "ROLLBACK" | "ALERT_ONCALL" | "LOG_TICKET",
  "rollbackTargetVersion": string (optional, mandatory if action is ROLLBACK e.g. "v1.2.4"),
  "canAutoExecute": boolean
}
`;

export class SentinelEngine {
  private genAI: GoogleGenerativeAI | null = null;
  private isMockMode: boolean = false;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      console.warn("⚠️  No GEMINI_API_KEY detected in .env - running in built-in Sentinel Self-Repair Simulation Mode.");
      this.isMockMode = true;
    } else {
      this.genAI = new GoogleGenerativeAI(apiKey);
    }
  }

  public async triageTicket(rawTicket: string, maxTurns: number = 3): Promise<TriageResult> {
    const startTime = Date.now();
    const trace: PipelineTraceTurn[] = [];

    // Conversation history to feed back errors iteratively
    let conversationContext = `${SYSTEM_PROMPT}\n\nIncident Ticket to Triage:\n"""\n${rawTicket}\n"""\nProvide the validated JSON:`;

    for (let turn = 1; turn <= maxTurns; turn++) {
      let rawOutput: string;

      if (this.isMockMode || !this.genAI) {
        rawOutput = this.simulateMockLlm(rawTicket, turn, trace);
      } else {
        const model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const response = await model.generateContent(conversationContext);
        rawOutput = response.response.text();
      }

      // Clean markdown code blocks if the model wrapped output in ```json
      const cleanedJson = rawOutput.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();

      // Stage 1: Syntactic & Schema Parsing
      let parsedObj: unknown;
      try {
        parsedObj = JSON.parse(cleanedJson);
      } catch (parseError: any) {
        const diag = `JSON Parse Error: Malformed JSON syntax - ${parseError.message}`;
        trace.push({
          turn,
          stage: "SCHEMA_VALIDATION",
          passed: false,
          diagnostics: diag,
          rawOutput,
        });

        conversationContext += `\n\nTurn ${turn} Output:\n${rawOutput}\n\nFeedback:\n${diag}\nFix the JSON syntax and output valid JSON only.`;
        continue;
      }

      const schemaResult = IncidentReportSchema.safeParse(parsedObj);
      if (!schemaResult.success) {
        const diag = formatDiagnostics(schemaResult.error.issues);
        trace.push({
          turn,
          stage: "SCHEMA_VALIDATION",
          passed: false,
          diagnostics: diag,
          rawOutput,
        });

        // Dynamic repair prompt feeding exact compiler/type errors back
        conversationContext += `\n\nTurn ${turn} Output:\n${rawOutput}\n\nFeedback:\nYour previous output violated the schema:\n${diag}\nPlease fix all listed errors and output strictly valid JSON.`;
        continue;
      }

      // Stage 2: Domain Safety & Policy Guardrails
      const candidateReport = schemaResult.data;
      const policyResult = PolicyGuardrailEngine.evaluate(candidateReport);

      if (!policyResult.passed) {
        const diag = formatDiagnostics([], policyResult.violations);
        trace.push({
          turn,
          stage: "POLICY_VERIFICATION",
          passed: false,
          diagnostics: diag,
          rawOutput,
        });

        conversationContext += `\n\nTurn ${turn} Output:\n${rawOutput}\n\nFeedback:\nYour output met the schema but violated safety guardrails:\n${diag}\nAdjust the values (e.g. set canAutoExecute=false or specify rollbackTargetVersion) to pass policy.`;
        continue;
      }

      // Stage 3: Full Verification Success
      trace.push({
        turn,
        stage: "COMPLETED",
        passed: true,
        rawOutput,
      });

      return {
        success: true,
        data: candidateReport,
        metrics: {
          totalTurns: turn,
          latencyMs: Date.now() - startTime,
          recoveredViaSelfRepair: turn > 1,
        },
        trace,
      };
    }

    // Exhausted retries without valid output
    return {
      success: false,
      data: null,
      metrics: {
        totalTurns: maxTurns,
        latencyMs: Date.now() - startTime,
        recoveredViaSelfRepair: false,
      },
      trace,
      error: `Failed to synthesize valid and policy-compliant incident report within ${maxTurns} turns.`,
    };
  }

  /**
   * Deterministic mock engine to simulate real LLM blunders and recovery:
   * Turn 1: Intentionally triggers a schema or policy violation (e.g. invalid category "REDIS").
   * Turn 2: Reads the feedback diagnostic and repairs it!
   */
  private simulateMockLlm(ticket: string, turn: number, trace: PipelineTraceTurn[]): string {
    const isCritical = ticket.toLowerCase().includes("down") || ticket.toLowerCase().includes("crash");

    if (turn === 1) {
      // Simulate common LLM blunder: hallucinated category "REDIS" instead of "DATABASE"
      return JSON.stringify(
        {
          severity: isCritical ? "CRITICAL" : "MEDIUM",
          category: "REDIS", // Violation: Not in enum
          serviceName: "cache-layer",
          summary: "Cache latency spikes causing timeouts across edge workers",
          rootCause: "Memory exhaustion under elevated QPS load",
          action: "RESTART_POD",
          canAutoExecute: true, // Violation if Critical
        },
        null,
        2
      );
    }

    // Turn 2+: Repair based on the feedback
    return JSON.stringify(
      {
        severity: isCritical ? "CRITICAL" : "MEDIUM",
        category: "DATABASE", // Repaired
        serviceName: "cache-layer",
        summary: "Cache latency spikes causing timeouts across edge workers",
        rootCause: "Memory exhaustion under elevated QPS load",
        action: "ALERT_ONCALL",
        canAutoExecute: false, // Repaired
      },
      null,
      2
    );
  }
}
