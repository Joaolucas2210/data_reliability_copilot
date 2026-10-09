import { useState } from "react";
import { useApi } from "../api";
import { Card, DataTable, EpistemicTag, fmtTime, fmtValue, LoadView, StatusPill } from "../components/ui";
import type { ValidationRun } from "../types";

// What each step does and does NOT prove — shown next to its result.
const STEP_INFO: Record<string, [string, string]> = {
  snapshot: ["Snapshot", "Copies production raw data into the sandbox; per-table row count + hash must match."],
  compile: ["SQL compilation", "Proves the SQL renders; says nothing about correctness."],
  static_check: ["Static validation", "Parses SQL and rejects disallowed statements/macros before execution."],
  dbt_build: ["dbt build on sandbox copy", "Models materialize on an isolated database snapshot."],
  data_tests: ["Data tests", "dbt tests pass on the rebuilt sandbox data."],
  invariants: ["Business invariants", "Report reconciles with control totals; the closest proxy for 'the report is right'."],
};

export function ValidationPage({ id }: { id: string }) {
  const [k, setK] = useState(0);
  const load = useApi<ValidationRun>(`/validation-runs/${id}`, k);
  return (
    <LoadView load={load} onRetry={() => setK(k + 1)}>
      {(v) => <ValidationView v={v} />}
    </LoadView>
  );
}

export function ValidationView({ v }: { v: ValidationRun }) {
  const passed = v.status === "passed";
  const keys = [...new Set([...Object.keys(v.metrics_before ?? {}), ...Object.keys(v.metrics_after ?? {})])];
  return (
    <>
      <h1>Recovery validation <code>{v.id}</code></h1>
      <div className="row" style={{ marginBottom: "var(--sp-4)" }}>
        <StatusPill status={passed ? "pass" : v.status === "running" || v.status === "queued" ? "info" : "fail"} label={v.status} />
        {passed && <EpistemicTag kind="verified" />}
        <span className="muted">sandbox <code>{v.sandbox_db}</code> · started {fmtTime(v.started_at)} · cleaned up {fmtTime(v.cleaned_up_at)}</span>
      </div>
      <p className="muted">
        Executed only on an isolated copy. "Verified" means the checks below passed in the sandbox; nothing was applied to production.
      </p>

      <Card title="Steps">
        <ol className="steps">
          {v.steps.map((s) => (
            <li key={s.name}>
              <div>
                <strong>{STEP_INFO[s.name]?.[0] ?? s.name}</strong>
                <div className="muted">{STEP_INFO[s.name]?.[1]}</div>
                {s.detail != null && <div className="mono detail">{fmtValue(s.detail)}</div>}
              </div>
              <span>
                <StatusPill status={s.status} />
                {s.duration_ms != null && <span className="muted"> {s.duration_ms} ms</span>}
              </span>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Isolation checks">
          <DataTable
            caption="Checks that the sandbox cannot touch production"
            rows={v.isolation_checks}
            rowKey={(c) => c.name}
            columns={[
              { header: "Check", render: (c) => c.name },
              { header: "Result", render: (c) => <StatusPill status={c.passed ? "pass" : "fail"} label={c.passed ? "isolated" : "NOT isolated"} /> },
              { header: "Detail", render: (c) => <span className="mono detail">{fmtValue(c.detail)}</span> },
            ]}
          />
        </Card>
        <Card title="Business invariants">
          <DataTable
            caption="Invariants before and after the recovery"
            rows={v.invariants}
            rowKey={(i) => i.name}
            columns={[
              { header: "Invariant", render: (i) => i.name },
              { header: "Before", render: (i) => fmtInvariant(i.before) },
              { header: "After", render: (i) => fmtInvariant(i.after) },
              { header: "After holds", render: (i) => <StatusPill status={i.passed ? "pass" : "fail"} label={i.passed ? "holds" : "violated"} /> },
            ]}
          />
        </Card>

      <Card title="Before / after comparison">
        <DataTable
          caption="Report metrics on the snapshot (before) vs. after the recovery playbook"
          rows={keys}
          rowKey={(k) => k}
          columns={[
            { header: "Metric", render: (k) => <code>{k}</code> },
            { header: "Before", render: (k) => fmtValue(v.metrics_before?.[k]), numeric: true },
            { header: "After", render: (k) => fmtValue(v.metrics_after?.[k]), numeric: true },
            { header: "Change", render: (k) => delta(v.metrics_before?.[k], v.metrics_after?.[k]), numeric: true },
          ]}
        />
      </Card>
    </>
  );
}

function delta(a: unknown, b: unknown) {
  const x = Number(a), y = Number(b);
  if (a == null || b == null || Number.isNaN(x) || Number.isNaN(y)) return "—";
  const d = y - x;
  if (d === 0) return "no change";
  // neutral styling: whether a change is good depends on the metric and is judged by the invariants above
  return <>{d > 0 ? "▲ +" : "▼ "}{Math.round(d * 100) / 100}</>;
}

function fmtInvariant(r: unknown) {
  if (r == null || typeof r !== "object") return fmtValue(r);
  const { passed, violations, diff } = r as { passed?: boolean; violations?: number | null; diff?: string | null };
  return `${passed ? "holds" : "violated"} · violations ${violations ?? "?"} · diff ${diff ?? "?"}`;
}
