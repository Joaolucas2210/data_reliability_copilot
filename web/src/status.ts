// Single source of truth for how every status is shown: label, tone (colour) and icon. Never colour alone.
// Tones map to CSS classes tone-pass | tone-warn | tone-fail | tone-info | tone-unknown.

export type Tone = "pass" | "warn" | "fail" | "info" | "unknown";
export type Entity =
  | "incident" | "investigation" | "proposal" | "validation" | "check" | "run" | "freshness"
  | "severity" | "outcome" | "hypothesis" | "access" | "tool" | "decision";

type Def = [label: string, tone: Tone, icon: string];

const DICT: Record<Entity, Record<string, Def>> = {
  incident: {
    open: ["Open", "warn", "●"],
    investigating: ["Investigating", "info", "◐"],
    awaiting_review: ["Awaiting review", "warn", "◷"],
    resolved: ["Resolved", "pass", "✓"],
    dismissed: ["Dismissed", "unknown", "–"],
  },
  investigation: {
    queued: ["Queued", "unknown", "…"],
    running: ["Running", "info", "◐"],
    awaiting_review: ["Awaiting review", "warn", "◷"],
    completed: ["Completed", "pass", "✓"],
    failed: ["Failed", "fail", "✕"],
    cancelled: ["Cancelled", "unknown", "⊘"],
  },
  proposal: {
    proposed: ["Proposed", "info", "→"],
    validating: ["Validating", "info", "◐"],
    validated: ["Validated in sandbox", "pass", "✓"],
    validation_failed: ["Validation failed", "fail", "✕"],
    approved: ["Approved", "pass", "✓"],
    rejected: ["Rejected", "unknown", "⊘"],
  },
  validation: {
    queued: ["Queued", "unknown", "…"],
    running: ["Running", "info", "◐"],
    passed: ["Passed", "pass", "✓"],
    failed: ["Failed", "fail", "✕"],
    error: ["Error", "fail", "!"],
  },
  check: {
    pass: ["Pass", "pass", "✓"],
    warn: ["Warning", "warn", "▲"],
    fail: ["Fail", "fail", "✕"],
    error: ["Error", "fail", "!"],
    skipped: ["Skipped", "unknown", "–"],
  },
  run: {
    running: ["Running", "info", "◐"],
    succeeded: ["Succeeded", "pass", "✓"],
    failed: ["Failed", "fail", "✕"],
  },
  freshness: {
    pass: ["Fresh", "pass", "✓"],
    warn: ["Late", "warn", "▲"],
    fail: ["Stale", "fail", "✕"],
    error: ["Check failed", "fail", "!"],
    unknown: ["Not checked", "unknown", "?"],
  },
  severity: {
    high: ["High severity", "fail", "▮▮▮"],
    medium: ["Medium severity", "warn", "▮▮▯"],
    low: ["Low severity", "info", "▮▯▯"],
  },
  outcome: {
    diagnosed: ["Diagnosed", "warn", "◆"],
    abstained: ["Abstained", "unknown", "◇"],
    no_fault_found: ["No fault found", "pass", "✓"],
    no_incident: ["No incident", "pass", "✓"],
  },
  hypothesis: {
    supported: ["Supported", "pass", "✓"],
    refuted: ["Refuted", "fail", "✕"],
    inconclusive: ["Inconclusive", "unknown", "?"],
  },
  access: {
    public: ["Public", "unknown", "○"],
    internal: ["Internal", "unknown", "◇"],
    restricted: ["Restricted", "warn", "⊘"],
  },
  tool: {
    ok: ["OK", "pass", "✓"],
    error: ["Error", "fail", "!"],
  },
  decision: {
    approve: ["Approved", "pass", "✓"],
    reject: ["Rejected", "fail", "✕"],
  },
};

export function statusDef(entity: Entity, value: string | null | undefined): Def {
  if (value == null) return ["—", "unknown", "?"];
  return DICT[entity][value] ?? [humanize(value), "unknown", "?"];
}

export const statusLabel = (entity: Entity, value: string | null | undefined) => statusDef(entity, value)[0];

/** snake_case / dotted codes → "Sentence case" for anything without an explicit label. */
export function humanize(code: string) {
  const s = code.replace(/[._]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const ACTIVE_INVESTIGATION = new Set(["queued", "running"]);
export const OPEN_INVESTIGATION = new Set(["queued", "running", "awaiting_review"]);
