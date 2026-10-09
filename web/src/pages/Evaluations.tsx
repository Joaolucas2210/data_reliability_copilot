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

export function EvalView({ runs }: { runs: EvalRun[] }) {
  const metricKeys = [...new Set(runs.flatMap((r) => Object.keys(r.metrics)))];
  return (
    <>
      <ModeBanner mode={runs.some((r) => r.llm_provider === "fake") ? "fake" : "live"} />
      <Card title="Systems compared">
        <DataTable
          caption="Aggregate metrics per system (null = not measurable for this system)"
          rows={runs}
          rowKey={(r) => r.id}
          columns={[
            { header: "System", render: (r) => SYSTEM_LABEL[r.system] ?? r.system },
            { header: "Split", render: (r) => r.split },
            { header: "Provider/model", render: (r) => <code>{r.llm_provider}/{r.llm_model ?? "—"}</code> },
            ...metricKeys.map((m) => ({ header: m, render: (r: EvalRun) => (r.metrics[m] == null ? "n/a" : String(r.metrics[m])), numeric: true })),
          ]}
        />
      </Card>
      {runs.map((r) => (
        <Card key={r.id} title={`${SYSTEM_LABEL[r.system] ?? r.system} — per scenario`}>
          <p className="muted">{fmtTime(r.created_at)} · prompt {r.prompt_version}</p>
          <DataTable
            caption={`Scenario results for ${r.system}`}
            rows={r.per_scenario}
            rowKey={(s) => s.scenario_id}
            columns={[
              { header: "Scenario", render: (s) => <code>{s.scenario_id}</code> },
              { header: "Expected", render: (s) => statusLabel("outcome", s.expected) },
              { header: "Got", render: (s) => statusLabel("outcome", s.got) },
              { header: "Result", render: (s) => <StatusPill status={s.correct ? "pass" : "fail"} label={s.correct ? "correct" : "wrong"} /> },
              { header: "Unsupported claims", render: (s) => s.unsupported_claims ?? "—", numeric: true },
            ]}
          />
        </Card>
      ))}
    </>
  );
}
