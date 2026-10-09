import { useState } from "react";
import { api, ApiError, useApi } from "../api";
import { Card, DataTable, EmptyState, fmtTime, LoadView, StatusPill, Timeline } from "../components/ui";
import type { AuditEvent, Incident, IncidentDetail, QualityCheckResult } from "../types";

const SEVERITY_STATUS = { high: "fail", medium: "warn", low: "info" } as const;
const INCIDENT_STATUS: Record<string, string> = { open: "fail", investigating: "info", awaiting_review: "warn", resolved: "pass", dismissed: "skipped" };

export function IncidentList() {
  const [status, setStatus] = useState("");
  const [k, setK] = useState(0);
  const load = useApi<Incident[]>(`/incidents${status ? `?status=${status}` : ""}`, k);
  return (
    <>
      <h1>Incidents</h1>
      <div className="row" style={{ marginBottom: "var(--sp-4)" }}>
        <label>
          Status{" "}
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">all</option>
            {Object.keys(INCIDENT_STATUS).map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
      </div>
      <LoadView load={load} onRetry={() => setK(k + 1)}>
        {(rows) => <IncidentTable rows={rows} />}
      </LoadView>
    </>
  );
}

export function IncidentTable({ rows }: { rows: Incident[] }) {
  return (
    <DataTable
      caption="Incidents, newest first"
      rows={rows}
      rowKey={(r) => r.id}
      empty={<EmptyState title="No incidents" hint="Deterministic checks have not opened any incident for this filter." />}
      columns={[
        { header: "Incident", render: (r) => <a href={`#/incidents/${r.id}`}>{r.title}</a> },
        { header: "Severity", render: (r) => <StatusPill status={SEVERITY_STATUS[r.severity]} label={r.severity} /> },
        { header: "Status", render: (r) => <StatusPill status={INCIDENT_STATUS[r.status] ?? "unknown"} label={r.status.replace("_", " ")} /> },
        { header: "Dataset", render: (r) => <code>{r.dataset_id ?? "—"}</code> },
        { header: "Seen", render: (r) => `${r.occurrences}×`, numeric: true },
        { header: "Opened", render: (r) => fmtTime(r.opened_at) },
      ]}
    />
  );
}

export function IncidentDetailPage({ id }: { id: string }) {
  const [k, setK] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useApi<IncidentDetail>(`/incidents/${id}`, k);

  const start = async () => {
    setMsg(null);
    try {
      const r = await api<{ investigation_id: string }>(`/incidents/${id}/investigations`, {
        method: "POST",
        headers: { "Idempotency-Key": `ui-${id}-${Date.now()}` },
      });
      location.hash = `#/investigations/${r.investigation_id}`;
    } catch (e) {
      setMsg(e instanceof ApiError && e.status === 403 ? "Your role cannot start investigations (needs investigator)." : String(e));
    }
  };

  return (
    <LoadView load={load} onRetry={() => setK(k + 1)}>
      {(d) => (
        <>
          <p><a href="#/incidents">← Incidents</a></p>
          <h1>{d.incident.title}</h1>
          <div className="row" style={{ marginBottom: "var(--sp-4)" }}>
            <StatusPill status={INCIDENT_STATUS[d.incident.status] ?? "unknown"} label={d.incident.status.replace("_", " ")} />
            <StatusPill status={SEVERITY_STATUS[d.incident.severity]} label={`severity ${d.incident.severity}`} />
            <code>{d.incident.id}</code>
          </div>
          <IncidentBody d={d} onStart={start} />
          {msg && <p role="alert" className="tone-fail banner">{msg}</p>}
        </>
      )}
    </LoadView>
  );
}

export function IncidentBody({ d, onStart }: { d: IncidentDetail; onStart?: () => void }) {
  return (
    <>
      <Card title="Triggering checks">
        <CheckTable rows={d.checks} />
      </Card>
      <div className="grid">
        <Card title="Timeline">
          <Timeline items={d.timeline.map(eventItem)} />
        </Card>
        <Card title="Investigations" actions={onStart && <button type="button" className="btn btn-primary" onClick={onStart}>Start investigation</button>}>
          {d.investigations.length ? (
            <ul>
              {d.investigations.map((i) => (
                <li key={i.id}>
                  <a href={`#/investigations/${i.id}`}>{i.id}</a> <StatusPill status={i.status === "completed" ? "pass" : i.status === "failed" ? "fail" : "info"} label={i.status} />{" "}
                  {i.outcome && <span className="muted">outcome: {i.outcome}</span>} {i.mode === "fake" && <strong className="muted">(fake LLM)</strong>}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Not investigated yet" />
          )}
        </Card>
      </div>
    </>
  );
}

function eventItem(e: AuditEvent) {
  return {
    key: String(e.id),
    at: e.at,
    title: (
      <>
        <strong>{e.action}</strong> {e.entity_type} <code>{e.entity_id}</code>
        {e.to_status && <> {e.from_status ?? "∅"} → {e.to_status}</>}
      </>
    ),
    detail: <>by {e.actor}{e.trace_id && <> · trace <code>{e.trace_id.slice(0, 16)}</code></>}</>,
  };
}

export function CheckTable({ rows }: { rows: QualityCheckResult[] }) {
  return (
    <DataTable
      caption="Quality checks (type distinguishes contract, test, freshness, invariant, anomaly)"
      rows={rows}
      rowKey={(r) => r.id}
      columns={[
        { header: "Check", render: (r) => <code>{r.check_name}</code> },
        { header: "Type", render: (r) => r.check_type.replace("_", " ") },
        { header: "Status", render: (r) => <StatusPill status={r.status} /> },
        { header: "Observed", render: (r) => r.observed_value ?? "—" },
        { header: "Expected", render: (r) => r.expected ?? "—" },
        { header: "Failures", render: (r) => r.failures ?? "—", numeric: true },
      ]}
    />
  );
}
