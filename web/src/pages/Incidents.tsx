import { useEffect, useRef, useState, type ReactNode } from "react";
import { announce, api, canAct, useApi } from "../api";
import { ActionButton, Breadcrumbs, Card, DataTable, EmptyState, fmtTime, LoadView, NotFound, PageTitle, Status, Timeline } from "../components/ui";
import { humanize, OPEN_INVESTIGATION, statusLabel } from "../status";
import type { AuditEvent, Incident, IncidentDetail, QualityCheckResult } from "../types";

const INCIDENT_STATUSES = ["open", "investigating", "awaiting_review", "resolved", "dismissed"];
const FILTER_LABEL = (s: string) => (s === "unresolved" ? "Unresolved (open, investigating or awaiting review)" : statusLabel("incident", s));

export function IncidentList({ initialStatus = "" }: { initialStatus?: string }) {
  const [status, setStatus] = useState(initialStatus);
  const [load, reload] = useApi<Incident[]>(`/incidents${status ? `?status=${status}` : ""}`);
  const changed = useRef(false);

  const choose = (s: string) => {
    setStatus(s);
    changed.current = true;
    // keep the filter in the URL (reload/back/share) without adding a history entry per change
    history.replaceState(null, "", `#/incidents${s ? `?status=${s}` : ""}`);
  };
  useEffect(() => {
    if (load.state === "ok" && changed.current) {
      changed.current = false;
      announce(`${load.data.length} incident${load.data.length === 1 ? "" : "s"}${status ? ` with status ${FILTER_LABEL(status).toLowerCase()}` : ""}.`);
    }
  }, [load, status]);

  return (
    <>
      <PageTitle>Incidents</PageTitle>
      <div className="row filter-row">
        <label>
          Status{" "}
          <select value={status} onChange={(e) => choose(e.target.value)}>
            <option value="">All statuses</option>
            <option value="unresolved">Unresolved</option>
            {INCIDENT_STATUSES.map((s) => <option key={s} value={s}>{statusLabel("incident", s)}</option>)}
          </select>
        </label>
        {load.state === "ok" && <span className="muted">{load.data.length} shown{load.data.length === 200 ? " (first 200)" : ""}</span>}
      </div>
      <LoadView load={load} onRetry={reload}>
        {(rows) => (
          <IncidentTable
            rows={rows}
            empty={
              status ? (
                <EmptyState
                  title={`No incidents with status “${FILTER_LABEL(status)}”`}
                  hint={<button type="button" className="btn" onClick={() => choose("")}>Show all incidents</button>}
                />
              ) : (
                <EmptyState title="No incidents yet" hint="Incidents appear here when a quality check fails after a pipeline run." />
              )
            }
          />
        )}
      </LoadView>
    </>
  );
}

export function IncidentTable({ rows, empty }: { rows: Incident[]; empty?: ReactNode }) {
  return (
    <DataTable
      caption="Incidents, newest first"
      rows={rows}
      rowKey={(r) => r.id}
      empty={empty ?? <EmptyState title="No incidents yet" />}
      columns={[
        { header: "Incident", render: (r) => <a href={`#/incidents/${r.id}`}>{r.title}</a> },
        { header: "Severity", render: (r) => <Status entity="severity" value={r.severity} /> },
        { header: "Status", render: (r) => <Status entity="incident" value={r.status} /> },
        { header: "Dataset", render: (r) => <code>{r.dataset_id ?? "—"}</code> },
        { header: "Occurrences", render: (r) => r.occurrences, numeric: true },
        { header: "Opened", render: (r) => fmtTime(r.opened_at) },
      ]}
    />
  );
}

export function IncidentDetailPage({ id }: { id: string }) {
  const [load, reload] = useApi<IncidentDetail>(`/incidents/${id}`);
  const key = useRef(`ui-start-${id}-${Date.now()}`); // one idempotency key per page visit = per intent

  useEffect(() => {
    if (load.state === "ok") document.title = `${load.data.incident.title} · Incident · Data Reliability Copilot`;
  }, [load]);

  const start = async () => {
    const r = await api<{ investigation_id: string }>(`/incidents/${id}/investigations`, {
      method: "POST",
      headers: { "Idempotency-Key": key.current },
    });
    announce("Investigation started. Opening it.");
    location.hash = `#/investigations/${r.investigation_id}`;
  };

  const notFound = load.state === "error" && load.status === 404;
  useEffect(() => {
    if (notFound) document.title = `Incident not found · Data Reliability Copilot`;
  }, [notFound]);
  return (
    <>
      <Breadcrumbs items={[{ href: "#/incidents", label: "Incidents" }, { label: load.state === "ok" ? "Incident" : id }]} />
      {load.state !== "ok" && <PageTitle>{notFound ? "Incident not found" : "Incident"}</PageTitle>}
      <LoadView load={load} onRetry={reload} notFound={<NotFound what="incident" id={id} back={{ href: "#/incidents", label: "Back to incidents" }} />}>
        {(d) => (
          <>
            <PageTitle>{d.incident.title}</PageTitle>
            <div className="row" style={{ marginBottom: "var(--sp-4)" }}>
              <Status entity="incident" value={d.incident.status} />
              <Status entity="severity" value={d.incident.severity} />
              <code>{d.incident.id}</code>
            </div>
            <IncidentBody d={d} onStart={start} />
          </>
        )}
      </LoadView>
    </>
  );
}

export function IncidentBody({ d, onStart }: { d: IncidentDetail; onStart?: () => Promise<void> }) {
  const closed = d.incident.status === "resolved" || d.incident.status === "dismissed";
  const active = d.investigations.find((i) => OPEN_INVESTIGATION.has(i.status));
  const startAction = onStart && !closed && (
    <ActionButton
      label={active ? "Start another investigation" : "Start investigation"}
      busyLabel="Starting…"
      variant={active ? "secondary" : "primary"}
      onAction={onStart}
      disabledReason={canAct("investigator") ? undefined : "Requires the investigator role"}
      confirm={active ? { prompt: <>Investigation <code>{active.id}</code> is still {statusLabel("investigation", active.status).toLowerCase()}. Start another one anyway?</>, confirmLabel: "Yes, start another" } : undefined}
    />
  );
  return (
    <>
      <Card title="Triggering checks">
        <CheckTable rows={d.checks} />
      </Card>
      <div className="grid">
        <Card title="Timeline">
          <Timeline items={d.timeline.map(eventItem)} />
        </Card>
        <Card title="Investigations" actions={startAction}>
          {active && (
            <p className="banner tone-info" role="note">
              Investigation <a href={`#/investigations/${active.id}`}>{active.id}</a> is {statusLabel("investigation", active.status).toLowerCase()}.
            </p>
          )}
          {closed && <p className="muted">This incident is {statusLabel("incident", d.incident.status).toLowerCase()}; no new investigations can be started.</p>}
          {d.investigations.length ? (
            <ul className="inv-list">
              {d.investigations.map((i) => (
                <li key={i.id}>
                  <a href={`#/investigations/${i.id}`}>{i.id}</a>
                  <span className="row">
                    <Status entity="investigation" value={i.status} />
                    {i.outcome && <Status entity="outcome" value={i.outcome} />}
                    {i.mode === "fake" && <span className="muted">fake LLM</span>}
                  </span>
                  <span className="muted">started {fmtTime(i.created_at)}</span>
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
  const detail = e.detail ?? {};
  const decision = typeof detail.decision === "string" ? detail.decision : null;
  const note = typeof detail.note === "string" && detail.note ? detail.note : null;
  return {
    key: String(e.id),
    at: e.at,
    title: (
      <>
        <strong>{humanize(e.action)}</strong> {humanize(e.entity_type).toLowerCase()} <EntityLink type={e.entity_type} id={e.entity_id} />
        {e.to_status && <> {e.from_status ? humanize(e.from_status) : "∅"} → {humanize(e.to_status)}</>}
        {decision && <> · <Status entity="decision" value={decision} /></>}
      </>
    ),
    detail: (
      <>
        by {e.actor}
        {note && <> · note: “{note}”</>}
        {e.trace_id && <> · trace <code>{e.trace_id.slice(0, 16)}</code></>}
      </>
    ),
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
        { header: "Type", render: (r) => humanize(r.check_type) },
        { header: "Status", render: (r) => <Status entity="check" value={r.status} /> },
        { header: "Observed", render: (r) => r.observed_value ?? "—" },
        { header: "Expected", render: (r) => r.expected ?? "—" },
        { header: "Failures", render: (r) => r.failures ?? "—", numeric: true },
      ]}
    />
  );
}

const ENTITY_ROUTE: Record<string, string> = { incident: "#/incidents/", investigation: "#/investigations/", validation: "#/validation-runs/" };

function EntityLink({ type, id }: { type: string; id: string }) {
  const base = ENTITY_ROUTE[type];
  return base ? <a href={base + id} className="mono">{id}</a> : <code>{id}</code>;
}
