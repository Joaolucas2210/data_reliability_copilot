import { Fragment, useState } from "react";
import { api, ApiError, useApi, getRole } from "../api";
import { AccessDenied, Card, DataTable, EmptyState, EpistemicTag, EvidenceRef, fmtCost, fmtTime, LoadView, ModeBanner, StatusPill, Tabs } from "../components/ui";
import type { Investigation } from "../types";

const OUTCOME_STATUS: Record<string, string> = { diagnosed: "warn", abstained: "unknown", no_fault_found: "pass" };

export function InvestigationPage({ id }: { id: string }) {
  const [k, setK] = useState(0);
  const load = useApi<Investigation>(`/investigations/${id}`, k);
  return (
    <LoadView load={load} onRetry={() => setK(k + 1)}>
      {(inv) => <InvestigationView inv={inv} onChanged={() => setK(k + 1)} />}
    </LoadView>
  );
}

export function InvestigationView({ inv, onChanged }: { inv: Investigation; onChanged?: () => void }) {
  const d = inv.diagnosis;
  const known = new Set(inv.evidence.map((e) => e.id));
  const unsupported = new Set(inv.citation_report?.unsupported_facts ?? []);
  const refs = (ids: string[]) => ids.map((id) => <EvidenceRef key={id} id={id} exists={known.has(id)} />);

  return (
    <>
      <p><a href={`#/incidents/${inv.incident_id}`}>← Incident</a></p>
      <h1>Investigation <code>{inv.id}</code></h1>
      <ModeBanner mode={inv.mode} costStatus={inv.usage.cost_status} />
      <div className="row" style={{ marginBottom: "var(--sp-4)" }}>
        <StatusPill status={inv.status === "completed" ? "pass" : inv.status === "failed" ? "fail" : "info"} label={inv.status.replace("_", " ")} />
        {inv.outcome && <StatusPill status={OUTCOME_STATUS[inv.outcome] ?? "unknown"} label={`outcome: ${inv.outcome.replaceAll("_", " ")}`} />}
        <span className="muted">
          {inv.llm_provider}/{inv.llm_model ?? "—"} · prompt {inv.prompt_version}
        </span>
        {(inv.status === "queued" || inv.status === "running") && getRole() !== "viewer" && (
          <CancelButton id={inv.id} onDone={onChanged} />
        )}
      </div>

      {!d ? (
        <EmptyState title={inv.status === "failed" ? "Investigation failed before producing a diagnosis" : "Diagnosis not available yet"} />
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
                      <blockquote>“{f.quote}”</blockquote>
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
                        <StatusPill status={h.status === "supported" ? "pass" : h.status === "refuted" ? "fail" : "unknown"} label={h.status} />
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
                      <div key={p.id} className="row">
                        {p.status === "validated" && <EpistemicTag kind="verified" />}
                        <StatusPill status={p.status === "validated" ? "pass" : p.status === "validation_failed" ? "fail" : "info"} label={`proposal ${p.status}`} />
                        {p.latest_validation_run_id ? <a href={`#/validation-runs/${p.latest_validation_run_id}`}>Sandbox validation</a> : <ValidateButton proposalId={p.id} />}
                      </div>
                    ))}
                  </>
                ),
              },
            ]}
          />
          <ReviewCard inv={inv} onChanged={onChanged} />
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
          <EmptyState title="Not checked yet" />
        )}
        <p className="muted">A reference that exists does not prove it supports the claim; quote matching is a deterministic lower bar, not semantic verification.</p>
      </Card>

      <Card title={`Evidence (${inv.evidence.length})`}>
        {inv.evidence.length ? (
          inv.evidence.map((e) => (
            <article className="evidence" key={e.id} id={`ev-${e.id}`} tabIndex={-1} aria-label={`Evidence ${e.id}`}>
              <div className="row">
                <code>{e.id}</code> <StatusPill status="info" label={e.kind.replaceAll("_", " ")} /> <StatusPill status={e.access === "restricted" ? "warn" : "unknown"} label={e.access} />
              </div>
              <dl className="kv">
                <dt>Source</dt>
                <dd className="mono">{e.source}</dd>
                <dt>Locator</dt>
                <dd className="mono">{e.locator}</dd>
                <dt>Run</dt>
                <dd className="mono">{e.pipeline_run_id ?? "—"}</dd>
                <dt>Collected</dt>
                <dd>{fmtTime(e.collected_at)}</dd>
                <dt>Version</dt>
                <dd className="mono">{e.version ?? "—"}</dd>
              </dl>
              {e.redacted || e.content == null ? (
                <AccessDenied message="Content is restricted for your role." needed="investigator" />
              ) : (
                <pre aria-label="Evidence content (untrusted data)">{e.content}</pre>
              )}
            </article>
          ))
        ) : (
          <EmptyState title="No evidence collected" />
        )}
      </Card>

      <div className="grid">
        <Card title="Usage & limits">
          <dl className="kv">
            <dt>LLM calls</dt>
            <dd>{inv.usage.llm_calls}</dd>
            <dt>Tokens in / out</dt>
            <dd>{inv.usage.input_tokens ?? "unknown"} / {inv.usage.output_tokens ?? "unknown"}</dd>
            <dt>Cost</dt>
            <dd>{fmtCost(inv.usage.cost_usd, inv.usage.cost_status)} <span className="muted">({inv.usage.cost_status})</span></dd>
            <dt>Tool calls</dt>
            <dd>{inv.usage.tool_calls ?? "unknown"}</dd>
            <dt>Wall time</dt>
            <dd>{inv.usage.wall_ms != null ? `${inv.usage.wall_ms} ms` : "unknown"}</dd>
            <dt>Limit hit</dt>
            <dd>{inv.usage.limit_hit ?? "none"}</dd>
            <dt>Fallbacks</dt>
            <dd>{inv.usage.fallbacks?.length ? inv.usage.fallbacks.map((f) => `${f.from} (${f.reason})`).join(", ") : "none"}</dd>
            {Object.entries(inv.limits).map(([k, v]) => (
              <Fragment key={k}>
                <dt>limit {k}</dt>
                <dd>{String(v)}</dd>
              </Fragment>
            ))}
          </dl>
        </Card>
        <Card title="Tool calls">
          <DataTable
            caption="Bounded tool calls made during the investigation"
            rows={inv.tool_calls.map((t, i) => ({ ...t, i }))}
            rowKey={(t) => String(t.i)}
            columns={[
              { header: "Tool", render: (t) => <code>{t.tool}</code> },
              { header: "Status", render: (t) => <StatusPill status={t.status === "ok" ? "pass" : "fail"} label={t.status} /> },
              { header: "Rows", render: (t) => t.rows_returned ?? "—", numeric: true },
              { header: "ms", render: (t) => t.duration_ms ?? "—", numeric: true },
            ]}
          />
        </Card>
      </div>
    </>
  );
}

function ValidateButton({ proposalId }: { proposalId: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const run = async () => {
    try {
      const r = await api<{ validation_run_id: string }>(`/proposals/${proposalId}/validations`, { method: "POST" });
      location.hash = `#/validation-runs/${r.validation_run_id}`;
    } catch (e) {
      setMsg(e instanceof ApiError && e.status === 403 ? "Needs investigator role." : String(e));
    }
  };
  return (
    <>
      <button type="button" className="btn" onClick={run}>Validate in sandbox</button>
      {msg && <span role="alert" className="muted">{msg}</span>}
    </>
  );
}

function ReviewCard({ inv, onChanged }: { inv: Investigation; onChanged?: () => void }) {
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  if (inv.status !== "awaiting_review") return null;
  const decide = async (decision: "approve" | "reject") => {
    setMsg(null);
    try {
      await api(`/investigations/${inv.id}/review`, { method: "POST", body: JSON.stringify({ decision, note }) });
      onChanged?.();
    } catch (e) {
      setMsg(e instanceof ApiError && e.status === 403 ? "Only the approver role can record a review decision." : String(e));
    }
  };
  return (
    <Card title="Human review">
      <p className="muted">Approval records the decision. It does not apply anything to production in this phase.</p>
      {getRole() !== "approver" ? (
        <AccessDenied message="Only approvers can record a review decision (the API enforces this too)." needed="approver" />
      ) : (
      <>
      <label htmlFor="review-note">Note</label>
      <textarea id="review-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} style={{ width: "100%" }} />
      <div className="row" style={{ marginTop: "var(--sp-2)" }}>
        <button type="button" className="btn btn-primary" onClick={() => decide("approve")}>Approve diagnosis</button>
        <button type="button" className="btn" onClick={() => decide("reject")}>Reject</button>
      </div>
      {msg && <p role="alert" className="banner tone-fail">{msg}</p>}
      </>
      )}
    </Card>
  );
}

function CancelButton({ id, onDone }: { id: string; onDone?: () => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  const cancel = async () => {
    try {
      const r = await api<{ result: string }>(`/investigations/${id}/cancel`, { method: "POST" });
      setMsg(r.result === "cancelled" ? "Cancelled." : "Cancellation requested; it stops at the next step.");
      onDone?.();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : String(e));
    }
  };
  return (
    <>
      <button type="button" className="btn" onClick={cancel}>Cancel investigation</button>
      {msg && <span role="status" className="muted">{msg}</span>}
    </>
  );
}
