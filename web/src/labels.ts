// Human labels for machine codes (C02). Codes stay visible as secondary text where they help experts.
import { humanize, statusLabel } from "./status";

const CAUSE: Record<string, string> = {
  duplication: "Duplicate records",
  schema_drift: "Source schema changed",
  delay: "Late or incomplete data",
  record_loss: "Missing records",
  bad_join: "Incorrect join",
  transformation_change: "Transformation logic changed",
};
export const causeLabel = (c: string | null | undefined) => (c ? CAUSE[c] ?? humanize(c) : "—");

/** Plain-language name for a quality check id (e.g. unique_fct_payments_payment_id → "payment_id is unique in fct_payments"). */
export function checkLabel(name: string): string {
  let m: RegExpMatchArray | null;
  if (name === "inv_reconciliation_amount") return "Report amount matches control totals";
  if (name === "inv_reconciliation_count") return "Report payment count matches control totals";
  if (name === "inv_payment_id_unique") return "Each payment appears once in the report data";
  if ((m = name.match(/^freshness_(\w+?)_(\w+)$/))) return `${m[1]}.${m[2]} arrived on time`;
  if ((m = name.match(/^model_error_(\w+)$/))) return `Model ${m[1]} builds`;
  if ((m = name.match(/^contract_(\w+)$/))) return `Model ${m[1]} matches its contract`;
  if ((m = name.match(/^unique_(stg|fct|rpt|dim)_(\w+?)_(\w+_id|business_date)$/))) return `${m[3]} is unique in ${m[1]}_${m[2]}`;
  if ((m = name.match(/^not_null_(stg|fct|rpt|dim)_(\w+?)_(\w+)$/))) return `${m[3]} is never empty in ${m[1]}_${m[2]}`;
  if (name.startsWith("relationships_")) return "References point to existing records";
  if (name.includes("volume_anomalies")) return "Payment volume within the expected range";
  return humanize(name);
}

/** Result of a check in words, avoiding the contradictory "observed 0 / expected 0 / fail" (C17). */
export function checkResult(c: { status: string; failures: number | null; observed_value: string | null; expected: string | null; check_type: string }) {
  if (c.status === "pass") return "OK";
  if (c.failures != null && c.failures > 0) return `${c.failures} violation${c.failures === 1 ? "" : "s"}`;
  if (c.observed_value != null && c.expected != null) return `observed ${c.observed_value}, expected ${c.expected}`;
  if (c.status === "error") return "Did not run";
  return statusLabel("check", c.status);
}

const ENTITY = (t: string) => ({ pipeline_run: "Pipeline run", incident: "Incident", investigation: "Investigation", proposal: "Recovery proposal", validation: "Sandbox validation" })[t] ?? humanize(t);

/** Audit event → sentence (C02): "Investigation moved to Awaiting review". */
export function eventSentence(e: { action: string; entity_type: string; from_status: string | null; to_status: string | null }) {
  const who = ENTITY(e.entity_type);
  const special: Record<string, string> = {
    "pipeline_run.started": "Pipeline run started",
    "pipeline_run.finished": `Pipeline run finished${e.to_status ? ` (${humanize(e.to_status).toLowerCase()})` : ""}`,
    "incident.opened": "Incident opened by a failing check",
    "incident.recurred": "The same failure was detected again",
    "incident.reported_manually": "Incident reported by a person",
    "investigation.created": "Investigation requested",
    "investigation.cancel_requested": "Cancellation requested",
    "proposal.created": "Recovery proposed",
    "validation.queued": "Sandbox validation queued",
    "validation.started": "Sandbox validation started",
  };
  if (special[e.action]) return special[e.action];
  const entity = e.entity_type as Parameters<typeof statusLabel>[0];
  if (e.to_status) {
    const label = ["incident", "investigation", "proposal", "validation"].includes(e.entity_type) ? statusLabel(entity, e.to_status) : humanize(e.to_status);
    return `${who} moved to ${label.toLowerCase()}`;
  }
  return humanize(e.action);
}
