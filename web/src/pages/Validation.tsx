import { useEffect, useRef } from "react";
import { announce, useApi } from "../api";
import { Breadcrumbs, Card, DataTable, EpistemicTag, fmtClock, fmtTime, fmtValue, LoadView, NotFound, PageTitle, Status, StatusPill } from "../components/ui";
import { statusLabel } from "../status";
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
  const [load, reload] = useApi<ValidationRun>(`/validation-runs/${id}`, {
    pollWhile: (v) => v.status === "queued" || v.status === "running",
  });
  const prevStatus = useRef<string | null>(null);
  useEffect(() => {
    if (load.state !== "ok") return;
    const st = load.data.status;
    if (prevStatus.current && prevStatus.current !== st) announce(`Sandbox validation ${statusLabel("validation", st).toLowerCase()}.`);
    prevStatus.current = st;
    document.title = `Validation ${load.data.id} · Data Reliability Copilot`;
  }, [load]);
  const notFound = load.state === "error" && load.status === 404;
  useEffect(() => {
    if (notFound) document.title = `Validation run not found · Data Reliability Copilot`;
  }, [notFound]);
  const v = load.state === "ok" ? load.data : null;
  return (
    <>
      <Breadcrumbs
        items={[
          { href: "#/incidents", label: "Incidents" },
          ...(v?.incident_id ? [{ href: `#/incidents/${v.incident_id}`, label: "Incident" }] : []),
          ...(v?.investigation_id ? [{ href: `#/investigations/${v.investigation_id}`, label: "Investigation" }] : []),
          { label: "Sandbox validation" },
        ]}
      />
      {load.state !== "ok" && <PageTitle>{notFound ? "Validation run not found" : "Recovery validation"}</PageTitle>}
      <LoadView load={load} onRetry={reload} notFound={<NotFound what="validation run" id={id} back={{ href: "#/incidents", label: "Back to incidents" }} />}>
        {(run) => <ValidationView v={run} updatedAt={load.state === "ok" ? load.updatedAt : undefined} />}
      </LoadView>
    </>
  );
}

export function ValidationView({ v, updatedAt }: { v: ValidationRun; updatedAt?: Date }) {
  const passed = v.status === "passed";
  const active = v.status === "queued" || v.status === "running";
  const steps = v.steps ?? [];
  const isolation = v.isolation_checks ?? [];
  const invariants = v.invariants ?? [];
  const keys = [...new Set([...Object.keys(v.metrics_before ?? {}), ...Object.keys(v.metrics_after ?? {})])];
  return (
    <>
      <PageTitle>Recovery validation <code>{v.id}</code></PageTitle>
      <div className="row" style={{ marginBottom: "var(--sp-4)" }}>
        <Status entity="validation" value={v.status} />
        {passed && <EpistemicTag kind="verified" />}
        <span className="muted">
          sandbox <code>{v.sandbox_db}</code> · started {fmtTime(v.started_at)}
          {active ? <> · updates automatically{updatedAt && <> · last checked {fmtClock(updatedAt)}</>}</> : <> · cleaned up {fmtTime(v.cleaned_up_at)}</>}
        </span>
      </div>
      <p className="muted">
        Executed only on an isolated copy. "Verified" means the checks below passed in the sandbox; nothing was applied to production.
      </p>
      {active && (
        <Card title={v.status === "queued" ? "Waiting for a worker" : "Validating in the sandbox"}>
          <div className="state" role="status">
            <span className="spinner" aria-hidden="true" />{" "}
            {v.status === "queued" ? "Queued — a worker will start it shortly." : "Running — creating the sandbox, copying the snapshot and running the stages below."}{" "}
            Usually about a minute. Results appear here when it finishes.
          </div>
          <ol className="steps pending">
            {Object.entries(STEP_INFO).map(([k, [title, info]]) => (
              <li key={k}><div><strong>{title}</strong><div className="muted">{info}</div></div><span className="muted">pending</span></li>
            ))}
          </ol>
        </Card>
      )}
      {v.error && <p className="banner tone-fail" role="note"><strong>The run stopped with an error:</strong> {v.error}</p>}
      {!active && (
      <>
      <Card title="Steps">
        <ol className="steps">
          {steps.map((s) => (
            <li key={s.name}>
              <div>
                <strong>{STEP_INFO[s.name]?.[0] ?? s.name}</strong>
                <div className="muted">{STEP_INFO[s.name]?.[1]}</div>
                {s.detail != null && <div className="mono detail">{fmtValue(s.detail)}</div>}
              </div>
              <span>
                <Status entity="check" value={s.status} />
                {s.duration_ms != null && <span className="muted"> {s.duration_ms} ms</span>}
              </span>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Isolation checks">
          <DataTable
            caption="Checks that the sandbox cannot touch production"
            rows={isolation}
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
            rows={invariants}
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
      )}
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
