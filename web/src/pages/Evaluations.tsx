import { useApi } from "../api";
import { Card, DataTable, EmptyState, fmtTime, LoadView, ModeBanner, PageTitle, StatusPill } from "../components/ui";
import { statusLabel } from "../status";
import type { EvalRun } from "../types";

const SYSTEM_LABEL: Record<string, string> = {
  A_rules: "A · rules + predefined diagnoses",
  B_summary_llm: "B · LLM with summary only",
  C_agent_tools: "C · agent with tools",
};

export function Evaluations() {
  const [load, reload] = useApi<{ runs: EvalRun[] }>("/evaluations/latest");
  return (
    <>
      <PageTitle>Evaluation results</PageTitle>
      <LoadView load={load} onRetry={reload}>
        {(d) => (d.runs.length ? <EvalView runs={d.runs} /> : <EmptyState title="No evaluation runs" hint={<>Run <code>make eval</code>.</>} />)}
      </LoadView>
    </>
  );
}

// label, definition, formatter — so nobody has to decode snake_case metric names
const METRICS: Record<string, [string, string, (v: number) => string]> = {
  scenarios: ["Scenarios", "Scenarios run for this system in this split.", (v) => String(v)],
  diagnosis_accuracy: ["Correct", "Share of scenarios where the outcome and the exact set of causes match the ground truth.", pct],
  false_positive_diagnoses: ["False-positive diagnoses", "Scenarios where the system named a cause although the right answer was to abstain or report no fault.", (v) => String(v)],
  appropriate_abstention_rate: ["Abstained when it should", "Share of insufficient-evidence scenarios where the system abstained.", pct],
  unsupported_claims_total: ["Unsupported claims", "Facts removed by the citation check (missing evidence id or quote not found).", (v) => String(v)],
  citation_precision: ["Citation precision", "Share of cited evidence ids that exist.", pct],
  quote_support_rate: ["Verbatim quotes", "Share of facts whose quote appears word for word in the cited evidence.", pct],
  extra_causes_total: ["Extra causes", "Causes named that are not in the ground truth.", (v) => String(v)],
  missed_causes_total: ["Missed causes", "Ground-truth causes the system did not name.", (v) => String(v)],
  recovery_valid: ["Recoveries validated", "Proposed recoveries that passed sandbox validation.", (v) => String(v)],
  recovery_attempted: ["Recoveries attempted", "Proposed recoveries that were validated in the sandbox.", (v) => String(v)],
  invariant_violations_after_recovery: ["Invariant violations after recovery", "Business invariants still failing after a validated recovery.", (v) => String(v)],
  required_evidence_kinds_missing: ["Required evidence not cited", "Evidence kinds the ground truth requires that the diagnosis did not cite.", (v) => String(v)],
  injected_instruction_followed: ["Injected instructions followed", "Times the system obeyed an instruction planted in the evidence.", (v) => String(v)],
  mean_latency_ms: ["Mean latency", "Average time per scenario for this system.", (v) => (v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`)],
  llm_calls_total: ["LLM calls", "Total model calls.", (v) => String(v)],
  cost_usd_total: ["Cost", "Total cost in USD; empty when unknown (never shown as zero).", (v) => `$${v.toFixed(4)}`],
  detected_all_rate: ["Detection rate", "Share of scenarios where every expected rule fired.", pct],
  rule_false_positives: ["Rule false positives", "Clean scenarios where a rule fired anyway.", (v) => String(v)],
};
const HEADLINE = ["diagnosis_accuracy", "false_positive_diagnoses", "appropriate_abstention_rate", "unsupported_claims_total", "recovery_valid", "cost_usd_total"];

function pct(v: number) {
  return `${Math.round(v * 1000) / 10}%`;
}

function fmtMetric(r: EvalRun, key: string) {
  const v = r.metrics[key];
  if (v == null) return key === "cost_usd_total" ? "unknown" : "not measured";
  return METRICS[key]?.[2](Number(v)) ?? String(v);
}

export function EvalView({ runs }: { runs: EvalRun[] }) {
  const splits = [...new Set(runs.map((r) => r.split))];
  const otherKeys = [...new Set(runs.flatMap((r) => Object.keys(r.metrics)))].filter((k) => !HEADLINE.includes(k) && k !== "cost_status");
  return (
    <>
      <ModeBanner mode={runs.some((r) => r.llm_provider === "fake") ? "fake" : "live"} />
      {splits.map((split) => {
        const rs = runs.filter((r) => r.split === split);
        const scenarios = [...new Set(rs.flatMap((r) => r.per_scenario.map((s) => s.scenario_id)))];
        return (
          <Card key={split} title={`${split === "final" ? "Final (held-out)" : "Dev"} split — ${scenarios.length} scenarios`}>
            <DataTable
              caption={`Headline results, ${split} split`}
              rows={rs}
              rowKey={(r) => r.id}
              columns={[
                { header: "System", render: (r) => SYSTEM_LABEL[r.system] ?? r.system },
                { header: "Correct", render: (r) => `${r.per_scenario.filter((s) => s.correct).length} / ${r.per_scenario.length} (${fmtMetric(r, "diagnosis_accuracy")})` },
                ...HEADLINE.slice(1).map((k) => ({ header: METRICS[k][0], render: (r: EvalRun) => fmtMetric(r, k), numeric: k !== "cost_usd_total" })),
              ]}
            />
            <DataTable
              caption={`Per scenario: expected outcome vs each system, ${split} split`}
              rows={scenarios}
              rowKey={(id) => id}
              columns={[
                { header: "Scenario", render: (id) => <code>{id}</code> },
                { header: "Expected", render: (id) => statusLabel("outcome", rs[0]?.per_scenario.find((s) => s.scenario_id === id)?.expected) },
                ...rs.map((r) => ({
                  header: (SYSTEM_LABEL[r.system] ?? r.system).split(" · ")[0] + " · " + r.system.split("_")[1],
                  render: (id: string) => {
                    const s = r.per_scenario.find((x) => x.scenario_id === id);
                    return s ? <StatusPill status={s.correct ? "pass" : "fail"} label={`${s.correct ? "Correct" : "Wrong"}: ${statusLabel("outcome", s.got)}`} /> : "—";
                  },
                })),
              ]}
            />
            <p className="muted">{fmtTime(rs[0]?.created_at)} · prompt {rs[0]?.prompt_version} · provider {rs[0]?.llm_provider}</p>
          </Card>
        );
      })}
      <Card title="All metrics">
        <details>
          <summary>Show every metric per system</summary>
          <DataTable
            caption="All recorded metrics (not measured = the metric does not apply to that system)"
            rows={runs}
            rowKey={(r) => r.id}
            columns={[
              { header: "System", render: (r) => `${SYSTEM_LABEL[r.system] ?? r.system} (${r.split})` },
              ...otherKeys.map((k) => ({ header: METRICS[k]?.[0] ?? k, render: (r: EvalRun) => fmtMetric(r, k), numeric: true })),
            ]}
          />
        </details>
        <h3>What the metrics mean</h3>
        <dl className="kv">
          {[...HEADLINE, ...otherKeys].filter((k) => METRICS[k]).map((k) => (
            <div key={k} className="contents">
              <dt>{METRICS[k][0]}</dt>
              <dd>{METRICS[k][1]}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </>
  );
}
