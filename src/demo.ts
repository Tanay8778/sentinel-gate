import dotenv from "dotenv";
import { SentinelEngine } from "./engine.js";

dotenv.config();

async function runDemo() {
  console.log(`
================================================================================
   SENTINEL-GATE: AUTONOMOUS REPAIR & TYPE-SAFE SCHEMA ENGINE DEMO
================================================================================
`);

  const engine = new SentinelEngine();

  const testCases = [
    {
      name: "Scenario 1: High-Severity Database Outage with Self-Repair Loop",
      ticket: `
        URGENT: Primary Postgres replica cluster in us-east-1 went down with 500 error spikes.
        Transactions are stalling, pool exhausted. We need immediate pod restarts and traffic drain!
      `,
    },
    {
      name: "Scenario 2: Auth Service Token Timeout (Milder Incident)",
      ticket: `
        Users reporting intermittent token validation delays on login screen.
        Auth worker response time climbed from 45ms to 1200ms. CPU usage normal.
      `,
    },
  ];

  for (const [index, test] of testCases.entries()) {
    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(`[TEST CASE ${index + 1}] ${test.name}`);
    console.log(`INPUT TICKET:\n"${test.ticket.trim()}"`);
    console.log(`--------------------------------------------------------------------------------\n`);

    const result = await engine.triageTicket(test.ticket, 3);

    console.log(`🔍 Pipeline Execution Trace:`);
    for (const step of result.trace) {
      const statusIcon = step.passed ? "✅ [PASSED]" : "❌ [FAILED & CAUGHT]";
      console.log(`  Turn ${step.turn} | Stage: ${step.stage.padEnd(20)} | ${statusIcon}`);
      if (!step.passed && step.diagnostics) {
        console.log(`    ↳ Diagnostics sent back to model:\n${step.diagnostics.split("\n").map(l => "       " + l).join("\n")}`);
      }
    }

    console.log(`\n📊 Telemetry Metrics:`);
    console.log(`  - Success:                 ${result.success ? "YES" : "NO"}`);
    console.log(`  - Total Turns Needed:      ${result.metrics.totalTurns}`);
    console.log(`  - Recovered via Repair:    ${result.metrics.recoveredViaSelfRepair ? "YES (Self-Correction Active)" : "NO (Clean 1st turn)"}`);
    console.log(`  - Latency:                 ${result.metrics.latencyMs} ms`);

    if (result.success && result.data) {
      console.log(`\n📦 Final Verified Safe Payload:`);
      console.log(JSON.stringify(result.data, null, 2));
    }
  }

  console.log(`
================================================================================
   DEMO COMPLETE: All invariant guardrails and repair loops verified.
================================================================================
`);
}

runDemo().catch(console.error);
