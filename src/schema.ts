import { z } from "zod";

/**
 * Core Enum Types
 */
export const SeverityEnum = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type Severity = z.infer<typeof SeverityEnum>;

export const CategoryEnum = z.enum(["DATABASE", "AUTH", "NETWORK", "INFRASTRUCTURE"]);
export type Category = z.infer<typeof CategoryEnum>;

export const ActionEnum = z.enum(["RESTART_POD", "ROLLBACK", "ALERT_ONCALL", "LOG_TICKET"]);
export type Action = z.infer<typeof ActionEnum>;

/**
 * 1. Strict Syntactic & Type Schema
 */
export const IncidentReportSchema = z.object({
  severity: SeverityEnum,
  category: CategoryEnum,
  serviceName: z.string().min(2, "serviceName must be at least 2 characters"),
  summary: z.string().min(10, "summary must be at least 10 characters describing the incident"),
  rootCause: z.string().min(10, "rootCause hypothesis must be at least 10 characters"),
  action: ActionEnum,
  rollbackTargetVersion: z.string().optional(),
  canAutoExecute: z.boolean(),
});

export type IncidentReport = z.infer<typeof IncidentReportSchema>;

/**
 * 2. Business Policy & Invariant Engine
 * Static types ensure structure; Domain policies ensure real-world system safety.
 */
export interface PolicyEvaluation {
  passed: boolean;
  violations: string[];
}

export class PolicyGuardrailEngine {
  public static evaluate(report: IncidentReport): PolicyEvaluation {
    const violations: string[] = [];

    // Rule 1: High or Critical severity incidents must NEVER auto-execute without human sign-off
    if (["HIGH", "CRITICAL"].includes(report.severity) && report.canAutoExecute) {
      violations.push(
        `Safety Invariant #1: Incidents with severity "${report.severity}" cannot have canAutoExecute=true. Human on-call approval is strictly mandatory.`
      );
    }

    // Rule 2: Rollback actions must supply a valid semver-style target version
    if (report.action === "ROLLBACK") {
      if (!report.rollbackTargetVersion || !/^v?\d+\.\d+\.\d+/.test(report.rollbackTargetVersion)) {
        violations.push(
          `Safety Invariant #2: Action "ROLLBACK" requires a valid "rollbackTargetVersion" string (e.g., "v2.1.0"). Got: "${report.rollbackTargetVersion ?? "undefined"}"`
        );
      }
    }

    // Rule 3: Database restart operations carry high data-loss risks and cannot be auto-executed
    if (report.category === "DATABASE" && report.action === "RESTART_POD" && report.canAutoExecute) {
      violations.push(
        `Safety Invariant #3: Database pod restarts carry data replication hazard. canAutoExecute must be false.`
      );
    }

    return {
      passed: violations.length === 0,
      violations,
    };
  }
}

/**
 * Diagnostic Formatter: Transforms raw Zod and Policy errors into
 * targeted compiler-style feedback for the LLM's next turn.
 */
export function formatDiagnostics(zodIssues: z.ZodIssue[], policyViolations: string[] = []): string {
  const lines: string[] = [];

  for (const issue of zodIssues) {
    const fieldPath = issue.path.join(".") || "root";
    lines.push(`• Schema Field "${fieldPath}": ${issue.message}`);
  }

  for (const violation of policyViolations) {
    lines.push(`• Policy Violation: ${violation}`);
  }

  return lines.join("\n");
}
