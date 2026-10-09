import { Fragment, useEffect, useId, useRef, useState } from "react";
import { announce, api, canAct, getRole, useApi } from "../api";
import {
  AccessDenied, ActionButton, Breadcrumbs, Card, DataTable, EmptyState, EpistemicTag, EvidenceRef, fmtClock, fmtCost,
  fmtTime, LoadView, ModeBanner, NotFound, PageTitle, revealAndFocus, Status, StatusPill, Tabs,
} from "../components/ui";
import { ACTIVE_INVESTIGATION, humanize, statusLabel } from "../status";
import type { Investigation } from "../types";

export function InvestigationPage({ id }: { id: string }) {
  const [load, reload] = useApi<Investigation>(`/investigations/${id}`, {
    pollWhile: (inv) => ACTIVE_INVESTIGATION.has(inv.status) || inv.proposals.some((p) => p.status === "validating"),
  });
  const prevStatus = useRef<string | null>(null);

  useEffect(() => {
    if (load.state !== "ok") return;
    const s = load.data.status;
    if (prevStatus.current && prevStatus.current !== s) announce(`Investigation is now ${statusLabel("investigation", s).toLowerCase()}.`);
    prevStatus.current = s;
    document.title = `Investigation ${load.data.id} · Data Reliability Copilot`;
  }, [load]);

  const notFound = load.state === "error" && load.status === 404;
  useEffect(() => {
    if (notFound) document.title = `Investigation not found · Data Reliability Copilot`;
  }, [notFound]);
  return (
    <>
      <Breadcrumbs
        items={[
          { href: "#/incidents", label: "Incidents" },
          ...(load.state === "ok" ? [{ href: `#/incidents/${load.data.incident_id}`, label: "Incident" }] : []),
          { label: "Investigation" },
        ]}
      />
      {load.state !== "ok" && <PageTitle>{notFound ? "Investigation not found" : "Investigation"}</PageTitle>}
      <LoadView load={load} onRetry={reload} notFound={<NotFound what="investigation" id={id} back={{ href: "#/incidents", label: "Back to incidents" }} />}>
        {(inv) => <InvestigationView inv={inv} onChanged={reload} updatedAt={load.state === "ok" ? load.updatedAt : undefined} />}
      </LoadView>
    </>
  );
}

export function InvestigationView({ inv, onChanged, updatedAt }: { inv: Investigation; onChanged?: () => void; updatedAt?: Date }) {
  const d = inv.diagnosis;
  const known = new Set(inv.evidence.map((e) => e.id));
  const unsupported = new Set(inv.citation_report?.unsupported_facts ?? []);
  const refs = (ids: string[]) => ids.map((id) => <EvidenceRef key={id} id={id} exists={known.has(id)} />);
  const active = ACTIVE_INVESTIGATION.has(inv.status);

  return (
    <>
      <PageTitle>Investigation <code>{inv.id}</code></PageTitle>
      <ModeBanner mode={inv.mode} costStatus={inv.usage.cost_status} />
      <div className="row" style={{ marginBottom: "var(--sp-4)" }}>
        <Status entity="investigation" value={inv.status} />
        {inv.outcome && <Status entity="outcome" value={inv.outcome} />}
        <span className="muted">
          {inv.llm_provider === "fake" ? "Fake LLM (no model)" : `${inv.llm_provider} · ${inv.llm_model ?? "model unknown"}`} · prompt {inv.prompt_version}
          {active && updatedAt && <> · updates automatically · last checked {fmtClock(updatedAt)}</>}
        </span>
      </div>

      {!d ? (
        <NoDiagnosis inv={inv} onChanged={onChanged} />
      ) : (
        <>
          <Card title="Summary">
            <p>{d.summary}</p>
            <dl className="kv">
              <dt>Estimated scope</dt>
              <dd>{d.estimated_scope}</dd>
              <dt>Self-reported confidence</dt>
              <dd>{d.self_reported_confidence ?? "—"} <span className="muted">(model's own label, not a calibrated probability)</span></dd>
            </dl>
          </Card>
          <Tabs
            label="Diagnosis sections"
            tabs={[
              {
                id: "facts",
                label: `Facts (${d.observed_facts.length})`,
                content: d.observed_facts.length ? (
                  d.observed_facts.map((f, i) => (
                    <div className="claim" key={i}>
                      <div className="row"><EpistemicTag kind="fact" />{unsupported.has(f.statement) && <StatusPill status="fail" label="quote not found in evidence" />}</div>
                      <p>{f.statement}</p>
                      <blockquote>{quoted(f.quote)}</blockquote>
                      <div className="row">Cites: {refs(f.evidence_ids)}</div>
                    </div>
                  ))
                ) : (
                  <EmptyState title="No observed facts" />
                ),
              },
              {
                id: "hyp",
                label: `Hypotheses (${d.hypotheses.length})`,
                content: d.hypotheses.length ? (
                  d.hypotheses.map((h) => (
                    <div className="claim hypothesis" key={h.id}>
                      <div className="row">
                        <EpistemicTag kind="hypothesis" />
                        <Status entity="hypothesis" value={h.status} />
                        {h.cause_category && <code>{h.cause_category}</code>}
                      </div>
                      <p>{h.statement}</p>
                      <div className="row">Supporting: {h.supporting_evidence_ids.length ? refs(h.supporting_evidence_ids) : "none"}</div>
                      <div className="row">Contradicting: {h.contradicting_evidence_ids.length ? refs(h.contradicting_evidence_ids) : "none"}</div>
                    </div>
                  ))
                ) : (
                  <EmptyState title="No hypotheses" />
                ),
              },
              {
                id: "gaps",
                label: "Gaps & contradictions",
                content: (
                  <>
                    <h3>Missing information</h3>
                    {d.missing_information.length ? <ul>{d.missing_information.map((m) => <li key={m}>{m}</li>)}</ul> : <p className="muted">None reported.</p>}
                    <h3>Contradicting evidence</h3>
                    {d.contradicting_evidence.length ? <div className="row">{refs(d.contradicting_evidence)}</div> : <p className="muted">None reported.</p>}
                  </>
                ),
              },
              {
                id: "rec",
                label: "Recommendation",
                content: (
                  <>
                    <div className="claim">
                      <EpistemicTag kind="recommendation" />
                      <p><strong>Next step:</strong> {d.next_step}</p>
                    </div>
                    {d.recovery ? (
                      <div className="claim">
                        <EpistemicTag kind="recommendation" />
                        <p><strong>Recovery playbook:</strong> <code>{d.recovery.playbook}</code></p>
                        <p>{d.recovery.rationale}</p>
                        <div className="row">Cites: {refs(d.recovery.evidence_ids)}</div>
                      </div>
                    ) : (
                      <p className="muted">No recovery proposed (not supported by the evidence).</p>
                    )}
                    {inv.proposals.map((p) => (
                      <div key={p.id} className="row proposal-row">
                        {p.status === "validated" && <EpistemicTag kind="verified" />}
                        <Status entity="proposal" value={p.status} prefix="Proposal" />
                        {p.latest_validation_run_id && <a href={`#/validation-runs/${p.latest_validation_run_id}`}>View sandbox validation</a>}
                        {p.status !== "validating" && p.status !== "approved" && p.status !== "rejected" && <ValidateButton proposalId={p.id} again={!!p.latest_validation_run_id} />}
                      </div>
                    ))}
                  </>
                ),
              },
            ]}
          />
          {inv.review ? <DecisionPanel inv={inv} /> : <ReviewCard inv={inv} onChanged={onChanged} />}
        </>
      )}

      <Card title="Citation check">
        {inv.citation_report ? (
          <dl className="kv">
            <dt>References cited</dt>
            <dd>{inv.citation_report.cited_ids}</dd>
            <dt>References that exist</dt>
            <dd>{inv.citation_report.existing_ids} {inv.citation_report.missing_ids.length > 0 && <StatusPill status="fail" label={`${inv.citation_report.missing_ids.length} missing`} />}</dd>
            <dt>Facts with verbatim quote</dt>
            <dd>{inv.citation_report.facts_supported} / {inv.citation_report.facts_total}</dd>
            {inv.citation_report.enforcement && (
              <>
                <dt>Enforcement</dt>
                <dd>{inv.citation_report.enforcement}</dd>
              </>
            )}
          </dl>
        ) : (
          <EmptyState title={active ? "Runs after the diagnosis is produced" : "Not checked"} />
        )}
        <p className="muted">A reference that exists does not prove it supports the claim; quote matching is a deterministic lower bar, not semantic verification.</p>
      </Card>

      <EvidenceList evidence={inv.evidence} active={active} />

      <div className="grid">
        <Card title="Usage & limits">
          <dl className="kv">
            <dt>LLM calls</dt>
            <dd>{inv.usage.llm_calls ?? (active ? "not started" : "—")}</dd>
            <dt>Tokens in / out</dt>
            <dd>{inv.usage.input_tokens ?? "unknown"} / {inv.usage.output_tokens ?? "unknown"}</dd>
            <dt>Cost</dt>
            <dd>
              {fmtCost(inv.usage.cost_usd, inv.usage.cost_status)}
              {inv.usage.cost_status && inv.usage.cost_usd != null && <span className="muted"> ({inv.usage.cost_status})</span>}
            </dd>
            <dt>Tool calls</dt>
            <dd>{inv.usage.tool_calls ?? (active ? "not started" : "—")}</dd>
            <dt>Wall time</dt>
            <dd>{inv.usage.wall_ms != null ? fmtMs(inv.usage.wall_ms) : "—"}</dd>
            <dt>Limit reached</dt>
            <dd>{inv.usage.limit_hit ? LIMIT_LABEL[inv.usage.limit_hit]?.[0] ?? humanize(inv.usage.limit_hit) : "none"}</dd>
            <dt>Fallbacks</dt>
            <dd>{inv.usage.fallbacks?.length ? inv.usage.fallbacks.map((f) => `${f.from} (${f.reason})`).join(", ") : "none"}</dd>
          </dl>
          <h3>Limits for this investigation</h3>
          <dl className="kv">
            {Object.entries(inv.limits).map(([k, v]) => (
              <Fragment key={k}>
                <dt>{LIMIT_LABEL[k]?.[0] ?? humanize(k)}</dt>
                <dd>{LIMIT_LABEL[k]?.[1](v) ?? String(v)}</dd>
              </Fragment>
            ))}
          </dl>
        </Card>
        <Card title="Tool calls">
          <DataTable
            caption="Bounded tool calls made during the investigation"
            rows={inv.tool_calls.map((t, i) => ({ ...t, i }))}
            rowKey={(t) => String(t.i)}
            empty={<EmptyState title={active ? "No tool calls yet" : "No tool calls"} />}
            columns={[
              { header: "Tool", render: (t) => <code>{t.tool}</code> },
              { header: "Status", render: (t) => <Status entity="tool" value={t.status} /> },
              { header: "Rows", render: (t) => t.rows_returned ?? "—", numeric: true },
              { header: "ms", render: (t) => t.duration_ms ?? "—", numeric: true },
            ]}
          />
        </Card>
      </div>
    </>
  );
}

function NoDiagnosis({ inv, onChanged }: { inv: Investigation; onChanged?: () => void }) {
  const last = inv.last_status_change;
  if (inv.status === "queued" || inv.status === "running")
    return (
      <Card title={inv.status === "queued" ? "Waiting for a worker" : "Investigating"}>
        <div className="state" role="status">
          <span className="spinner" aria-hidden="true" />{" "}
          {inv.status === "queued"
            ? "Queued — a worker will pick this up shortly."
            : "Running — collecting evidence and testing hypotheses."}{" "}
          This page updates on its own; you can leave and come back.
        </div>
        <ActionButton
          label="Cancel investigation"
          busyLabel="Cancelling…"
          variant="danger"
          disabledReason={canAct("investigator") ? undefined : "Requires the investigator role"}
          confirm={{ prompt: "Cancel this investigation? It stops at its next step and cannot be resumed.", confirmLabel: "Yes, cancel it" }}
          onAction={async () => {
            const r = await api<{ result: string }>(`/investigations/${inv.id}/cancel`, { method: "POST" });
            announce(r.result === "cancelled" ? "Investigation cancelled." : "Cancellation requested; it stops at its next step.");
            onChanged?.();
          }}
        />
      </Card>
    );
  if (inv.status === "cancelled")
    return (
      <Card title="Investigation cancelled">
        <p>
          Cancelled{last ? <> by <strong>{last.actor}</strong> at {fmtTime(last.at)}</> : null}. No diagnosis was produced.
        </p>
        <p><a href={`#/incidents/${inv.incident_id}`}>Back to the incident</a> to start a new investigation.</p>
      </Card>
    );
  return (
    <Card title="Investigation failed">
      <p>The investigation stopped before producing a diagnosis{last ? <> ({fmtTime(last.at)})</> : null}.</p>
      <p><a href={`#/incidents/${inv.incident_id}`}>Back to the incident</a> to start a new investigation.</p>
    </Card>
  );
}

function ValidateButton({ proposalId, again }: { proposalId: string; again: boolean }) {
  return (
    <ActionButton
      label={again ? "Validate again in sandbox" : "Validate in sandbox"}
      busyLabel="Starting validation…"
      disabledReason={canAct("investigator") ? undefined : "Requires the investigator role"}
      onAction={async () => {
        const r = await api<{ validation_run_id: string }>(`/proposals/${proposalId}/validations`, { method: "POST" });
        announce("Sandbox validation started. Opening it.");
        location.hash = `#/validation-runs/${r.validation_run_id}`;
      }}
    />
  );
}

function DecisionPanel({ inv }: { inv: Investigation }) {
  const r = inv.review!;
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // move focus here right after a decision is recorded (flag set by ReviewCard)
    if (sessionStorage.getItem("drc.focusDecision") === inv.id) {
      sessionStorage.removeItem("drc.focusDecision");
      ref.current?.focus();
    }
  }, [inv.id]);
  return (
    <section className="card decision" aria-labelledby={`dec-${inv.id}`}>
      <header className="card-head">
        <h2 id={`dec-${inv.id}`} ref={ref} tabIndex={-1}>Decision recorded</h2>
        <Status entity="decision" value={r.decision} />
      </header>
      <dl className="kv">
        <dt>Decision</dt>
        <dd>{r.decision === "approve" ? "Diagnosis approved" : "Diagnosis rejected"}</dd>
        <dt>Reviewer</dt>
        <dd>{r.reviewer}</dd>
        <dt>When</dt>
        <dd>{fmtTime(r.at)}</dd>
        <dt>Note</dt>
        <dd>{r.note ? `“${r.note}”` : <span className="muted">No note</span>}</dd>
      </dl>
      <p className="muted">
        Recording a decision does not change production. <a href={`#/incidents/${inv.incident_id}`}>Go to the incident</a> to see its status.
      </p>
    </section>
  );
}

function ReviewCard({ inv, onChanged }: { inv: Investigation; onChanged?: () => void }) {
  const draftKey = `drc.reviewDraft.${inv.id}`;
  const [note, setNoteState] = useState(() => sessionStorage.getItem(draftKey) ?? "");
  const setNote = (v: string) => {
    setNoteState(v);
    if (v) sessionStorage.setItem(draftKey, v);
    else sessionStorage.removeItem(draftKey);
  };
  const [resolve, setResolve] = useState(true);
  const [noteError, setNoteError] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const errId = useId();
  if (inv.status !== "awaiting_review") return null;

  const decide = (decision: "approve" | "reject") => async () => {
    await api(`/investigations/${inv.id}/review`, {
      method: "POST",
      body: JSON.stringify({ decision, note, close_incident: decision === "approve" && resolve ? "resolved" : null }),
    });
    sessionStorage.setItem("drc.focusDecision", inv.id);
    sessionStorage.removeItem(draftKey);
    announce(`Decision recorded: diagnosis ${decision === "approve" ? "approved" : "rejected"}.`);
    onChanged?.();
  };
  const noteGiven = () => {
    if (note.trim()) return true;
    setNoteError("Write a note explaining why you reject the diagnosis.");
    noteRef.current?.focus();
    return false;
  };

  return (
    <Card title="Human review">
      <p className="muted">Your decision is recorded with your name and note. It does not apply anything to production in this phase.</p>
      {getRole() !== "approver" ? (
        <AccessDenied message="Only approvers can record a review decision (the API enforces this too)." needed="approver" />
      ) : (
        <>
          <label htmlFor={`note-${inv.id}`}>Review note <span className="muted">(required to reject)</span></label>
          <textarea
            id={`note-${inv.id}`}
            ref={noteRef}
            value={note}
            onChange={(e) => { setNote(e.target.value); if (e.target.value.trim()) setNoteError(null); }}
            rows={3}
            aria-invalid={!!noteError}
            aria-describedby={noteError ? errId : undefined}
          />
          {noteError && <p id={errId} className="field-error" role="alert"><span aria-hidden="true">✕ </span>{noteError}</p>}
          <label className="check">
            <input type="checkbox" checked={resolve} onChange={(e) => setResolve(e.target.checked)} /> When approving, also mark the incident as resolved
          </label>
          <div className="row review-actions">
            <ActionButton
              label="Approve diagnosis"
              busyLabel="Recording…"
              variant="primary"
              confirm={{ prompt: <>Approve this diagnosis{resolve ? " and resolve the incident" : ""}? The decision is recorded and cannot be undone.</>, confirmLabel: "Yes, approve" }}
              onAction={decide("approve")}
            />
            <ActionButton
              label="Reject diagnosis"
              busyLabel="Recording…"
              variant="danger"
              confirm={{ prompt: "Reject this diagnosis? The incident stays unresolved so another investigation can be started.", confirmLabel: "Yes, reject" }}
              precheck={noteGiven}
              onAction={decide("reject")}
            />
          </div>
        </>
      )}
    </Card>
  );
}

const LIMIT_LABEL: Record<string, [string, (v: unknown) => string]> = {
  max_rounds: ["Max investigation rounds", (v) => String(v)],
  max_tool_calls: ["Max tool calls", (v) => String(v)],
  max_llm_calls: ["Max LLM calls", (v) => String(v)],
  max_input_tokens: ["Max input tokens", (v) => Number(v).toLocaleString("en-US")],
  max_wall_s: ["Max wall time", (v) => `${v} s`],
  max_cost_usd: ["Max cost", (v) => `$${Number(v).toFixed(2)}`],
};

function fmtMs(ms: number) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Wrap a quote in typographic quotes unless it already starts/ends with a quote character. */
function quoted(q: string) {
  return /^["“']/.test(q) && /["”']$/.test(q) ? q : `“${q}”`;
}

function EvidenceList({ evidence, active }: { evidence: Investigation["evidence"]; active: boolean }) {
  const [allOpen, setAllOpen] = useState<{ open: boolean; v: number }>({ open: false, v: 0 });
  return (
    <Card
      title={`Evidence (${evidence.length})`}
      actions={
        evidence.length > 0 && (
          <button type="button" className="btn" aria-expanded={allOpen.open} onClick={() => setAllOpen((a) => ({ open: !a.open, v: a.v + 1 }))}>
            {allOpen.open ? "Collapse all" : "Expand all"}
          </button>
        )
      }
    >
      <p className="muted">Evidence is untrusted data collected by bounded tools. Citation chips above open the item they point to.</p>
      {evidence.length ? (
        evidence.map((e) => <EvidenceItem key={e.id} e={e} allOpen={allOpen} />)
      ) : (
        <EmptyState title={active ? "Evidence appears here as tools return results" : "No evidence collected"} />
      )}
    </Card>
  );
}

function EvidenceItem({ e, allOpen }: { e: Investigation["evidence"][number]; allOpen: { open: boolean; v: number } }) {
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (allOpen.v) setOpen(allOpen.open);
  }, [allOpen]);
  useEffect(() => {
    const on = (ev: Event) => {
      const { target, origin: o } = (ev as CustomEvent<{ target: string; origin: string }>).detail;
      if (target !== e.id) return;
      setOrigin(o);
      setOpen(true);
      requestAnimationFrame(() => revealAndFocus(ref.current));
    };
    addEventListener("drc:cite", on);
    return () => removeEventListener("drc:cite", on);
  }, [e.id]);
  const first = (e.content ?? "").split("\n")[0];
  return (
    <article className="evidence" id={`ev-${e.id}`} ref={ref} tabIndex={-1} aria-label={`Evidence ${e.id}`}>
      <details open={open} onToggle={(ev) => setOpen((ev.currentTarget as HTMLDetailsElement).open)}>
        <summary>
          <code>{e.id}</code> <StatusPill status="info" label={humanize(e.kind)} /> <Status entity="access" value={e.access} />
          {!open && first && <span className="evidence-preview muted">{first.length > 110 ? first.slice(0, 110) + "…" : first}</span>}
        </summary>
        <dl className="kv">
          <dt>Source</dt>
          <dd className="mono">{e.source}</dd>
          <dt>Locator</dt>
          <dd className="mono">{e.locator}</dd>
          <dt>Run</dt>
          <dd className="mono">{e.pipeline_run_id ?? "—"}</dd>
          <dt>Collected</dt>
          <dd className="mono">{fmtTime(e.collected_at)}</dd>
          <dt>Version</dt>
          <dd className="mono">{e.version ?? "—"}</dd>
        </dl>
        {e.redacted || e.content == null ? (
          <AccessDenied message="Content is restricted for your role." needed="investigator" />
        ) : (
          <pre tabIndex={0} aria-label={`Evidence ${e.id} content (untrusted data)`}>{e.content}</pre>
        )}
      </details>
      {origin && (
        <button
          type="button"
          className="btn btn-link"
          onClick={() => {
            const o = document.getElementById(origin);
            revealAndFocus(o);
            setOrigin(null);
          }}
        >
          <span aria-hidden="true">↩ </span>Back to the claim
        </button>
      )}
    </article>
  );
}
