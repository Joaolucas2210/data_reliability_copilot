import { modals } from "@mantine/modals";
import { Accordion, Alert, Badge, Button, Checkbox, Group, Loader, Paper, SimpleGrid, Stack, Text, Textarea, ThemeIcon } from "@mantine/core";
import {
  IconAlertTriangle, IconCircleCheck, IconClockHour4, IconFlask2, IconGavel, IconPlayerStop, IconShieldCheck, IconThumbDown, IconThumbUp,
} from "@tabler/icons-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { announce, announceStatus, api, ApiError, canAct, getRole, useApi } from "../api";
import {
  AccessDenied, ActionButton, BackToClaim, Breadcrumbs, Card, DataTable, EmptyState, EpistemicTag, EvidenceRef, fmtClock, fmtCost, fmtTime,
  LoadView, ModeBanner, NotFound, PageTitle, revealAndFocus, Status, StatusPill, Tabs,
} from "../components/ui";
import { causeLabel } from "../labels";
import { ACTIVE_INVESTIGATION, humanize, statusLabel } from "../status";
import type { Investigation } from "../types";

export function InvestigationPage({ id }: { id: string }) {
  const [load, reload] = useApi<Investigation>(`/investigations/${id}`, {
    pollWhile: (inv) => ACTIVE_INVESTIGATION.has(inv.status) || inv.proposals.some((p) => p.status === "validating"),
  });
  const prevStatus = useRef<string | null>(null);
  const notFound = load.state === "error" && load.status === 404;

  useEffect(() => {
    if (notFound) document.title = "Investigation not found · Data Reliability Copilot";
    if (load.state !== "ok") return;
    const s = load.data.status;
    // a recorded decision already announced itself ("Decision recorded…"); don't follow it with "now completed"
    if (prevStatus.current && prevStatus.current !== s && !(s === "completed" && load.data.review))
      announceStatus(s === "awaiting_review" ? "Investigation finished: the result is ready for review." : `Investigation is now ${statusLabel("investigation", s).toLowerCase()}.`);
    prevStatus.current = s;
    document.title = `Investigation ${load.data.id} · Data Reliability Copilot`;
  }, [load, notFound]);

  return (
    <>
      <Breadcrumbs
        items={[
          { href: "#/incidents", label: "Incidents" },
          { href: load.state === "ok" ? `#/incidents/${load.data.incident_id}` : undefined, label: "Incident" }, // reserved while loading: no layout shift
          { label: "Investigation" },
        ]}
      />
      {/* one persistent h1 through loading → loaded so focus placed on it survives (C01) */}
      <PageTitle>{notFound ? "Investigation not found" : <>Investigation {load.state === "ok" ? <code>{load.data.id}</code> : <code>{id}</code>}</>}</PageTitle>
      {load.state === "ok" && load.data.incident_title && (
        <Text c="dimmed" mt={-8} mb="md">For incident <a href={`#/incidents/${load.data.incident_id}`}>{load.data.incident_title}</a></Text>
      )}
      <LoadView load={load} onRetry={reload} notFound={<NotFound what="investigation" id={id} back={{ href: "#/incidents", label: "Back to incidents" }} />}>
        {(inv) => <InvestigationView inv={inv} onChanged={reload} updatedAt={load.state === "ok" ? load.updatedAt : undefined} showTitle={false} />}
      </LoadView>
    </>
  );
}

export function InvestigationView({ inv, onChanged, updatedAt, showTitle = true }: { inv: Investigation; onChanged?: () => void; updatedAt?: Date; showTitle?: boolean }) {
  const d = inv.diagnosis;
  const known = new Set(inv.evidence.map((e) => e.id));
  const unsupported = new Set(inv.citation_report?.unsupported_facts ?? []);
  const kinds = new Map(inv.evidence.map((e) => [e.id, humanize(e.kind)]));
  const refs = (ids: string[]) => ids.map((id) => <EvidenceRef key={id} id={id} kind={kinds.get(id)} exists={known.has(id)} />);
  const active = ACTIVE_INVESTIGATION.has(inv.status);
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active) {
      modals.closeAll(); // e.g. "Cancel this investigation?" no longer applies
    }
    wasActive.current = active;
  }, [active]);
  const ended = !d && !active && !inv.evidence.length && !inv.tool_calls.length; // cancelled / failed with nothing collected: hide empty sections

  return (
    <>
      {showTitle && <PageTitle>Investigation <code>{inv.id}</code></PageTitle>}
      <ModeBanner mode={inv.mode} costStatus={inv.usage.cost_status} />
      <Group gap="xs" mb="lg" wrap="wrap">
        {inv.review ? <Status entity="decision" value={inv.review.decision} /> : <Status entity="investigation" value={inv.status} />}
        {inv.outcome && <Status entity="outcome" value={inv.outcome} />}
        <Text size="sm" c="dimmed">
          {inv.llm_provider === "fake" ? "Simulated LLM (no model)" : `${inv.llm_provider} · ${inv.llm_model ?? "model unknown"}`} · prompt {inv.prompt_version}
          {active && updatedAt && <> · updates automatically · last checked {fmtClock(updatedAt)}</>}
        </Text>
      </Group>

      {!d ? (
        <NoDiagnosis inv={inv} onChanged={onChanged} />
      ) : (
        <>
          <Card title="Summary">
            <Text mb="sm">{d.summary}</Text>
            <dl className="kv">
              <dt>Estimated scope</dt>
              <dd>{d.estimated_scope}</dd>
              <dt>Self-reported confidence</dt>
              <dd>{d.self_reported_confidence ?? "—"} <Text span size="sm" c="dimmed">(the model's own label, not a calibrated probability)</Text></dd>
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
                      <Group gap="xs" mb={4}><EpistemicTag kind="fact" />{unsupported.has(f.statement) && <StatusPill status="fail" label="quote not found in evidence" />}</Group>
                      <Text>{f.statement}</Text>
                      <blockquote>{quoted(f.quote)}</blockquote>
                      <Group gap="xs">Cites: {refs(f.evidence_ids)}</Group>
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
                      <Group gap="xs" mb={4}>
                        <EpistemicTag kind="hypothesis" />
                        <Status entity="hypothesis" value={h.status} />
                      </Group>
                      {h.cause_category && <Text fw={600}>{causeLabel(h.cause_category)}</Text>}
                      <Text>{h.statement}</Text>
                      <Group gap="xs" mt={6}>Supporting: {h.supporting_evidence_ids.length ? refs(h.supporting_evidence_ids) : <Text span c="dimmed" size="sm">none</Text>}</Group>
                      <Group gap="xs" mt={6}>Contradicting: {h.contradicting_evidence_ids.length ? refs(h.contradicting_evidence_ids) : <Text span c="dimmed" size="sm">none</Text>}</Group>
                    </div>
                  ))
                ) : (
                  <EmptyState title="No hypotheses" />
                ),
              },
              {
                id: "gaps",
                label: "Gaps",
                content: (
                  <>
                    <h3>Missing information</h3>
                    {d.missing_information.length ? <ul>{d.missing_information.map((m) => <li key={m}>{m}</li>)}</ul> : <Text c="dimmed" size="sm">None reported.</Text>}
                    <h3>Contradicting evidence</h3>
                    {d.contradicting_evidence.length ? <Group gap="xs">{refs(d.contradicting_evidence)}</Group> : <Text c="dimmed" size="sm">None reported.</Text>}
                  </>
                ),
              },
              {
                id: "rec",
                label: "Next step",
                content: (
                  <>
                    <div className="claim">
                      <EpistemicTag kind="recommendation" />
                      <Text mt={4}><strong>Next step:</strong> {d.next_step}</Text>
                    </div>
                    {d.recovery ? (
                      <div className="claim">
                        <EpistemicTag kind="recommendation" />
                        <Text mt={4}><strong>Recovery playbook:</strong> <code>{d.recovery.playbook}</code></Text>
                        <Text>{d.recovery.rationale}</Text>
                        <Group gap="xs" mt={6}>Cites: {refs(d.recovery.evidence_ids)}</Group>
                      </div>
                    ) : (
                      <Text c="dimmed" size="sm">No recovery proposed (not supported by the evidence).</Text>
                    )}
                    {inv.proposals.map((p) => (
                      <Group key={p.id} gap="sm" mt="md" align="flex-start" className="proposal-row">
                        {p.status === "validated" && <EpistemicTag kind="verified" />}
                        <Status entity="proposal" value={p.status} prefix="Recovery" />
                        {p.latest_validation_run_id && <a href={`#/validation-runs/${p.latest_validation_run_id}`}>View sandbox validation</a>}
                        {!inv.review && p.status !== "validating" && p.status !== "approved" && p.status !== "rejected" && <ValidateButton proposalId={p.id} again={!!p.latest_validation_run_id} />}
                      </Group>
                    ))}
                  </>
                ),
              },
            ]}
          />
          {inv.review ? <DecisionPanel inv={inv} /> : <ReviewCard inv={inv} onChanged={onChanged} />}
        </>
      )}

      {!ended && (
        <Card title="Citation check">
          {inv.citation_report ? (
            <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="sm" mb="sm">
              <Stat label="References cited" value={inv.citation_report.cited_ids} />
              <Stat label="References that exist" value={inv.citation_report.existing_ids} warn={inv.citation_report.missing_ids.length > 0 ? `${inv.citation_report.missing_ids.length} missing` : undefined} />
              <Stat label="Facts with verbatim quote" value={`${inv.citation_report.facts_supported} / ${inv.citation_report.facts_total}`} />
            </SimpleGrid>
          ) : (
            <Text c="dimmed" size="sm" mb="sm">{active ? "Runs after the diagnosis is produced." : "Not checked."}</Text>
          )}
          {inv.citation_report?.enforcement && <Text size="sm" mb="sm"><strong>Enforcement:</strong> {inv.citation_report.enforcement}</Text>}
          <Text size="sm" c="dimmed">A reference that exists does not prove it supports the claim; quote matching is a deterministic lower bar, not semantic verification.</Text>
        </Card>
      )}

      {!ended && <EvidenceList evidence={inv.evidence} active={active} />}

      <SimpleGrid cols={{ base: 1, lg: ended ? 1 : 2 }} spacing="lg">
        <Card title="Usage & limits">
          <dl className="kv">
            <dt>LLM calls</dt>
            <dd>{inv.usage.llm_calls ?? (active ? "counted when the run ends" : "—")}</dd>
            <dt>Tokens in / out</dt>
            <dd>{inv.usage.input_tokens ?? "unknown"} / {inv.usage.output_tokens ?? "unknown"}</dd>
            <dt>Cost</dt>
            <dd>{fmtCost(inv.usage.cost_usd, inv.usage.cost_status)}</dd>
            <dt>Tool calls</dt>
            <dd>{inv.usage.tool_calls ?? (inv.tool_calls.length ? `${inv.tool_calls.length} so far` : active ? "none yet" : "—")}</dd>
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
        {!ended && (
          <Card title="Tool calls">
            <DataTable
              caption="Bounded, read-only tool calls made during the investigation"
              rows={inv.tool_calls.map((t, i) => ({ ...t, i }))}
              rowKey={(t) => String(t.i)}
              empty={<EmptyState title={active ? "No tool calls yet" : "No tool calls"} />}
              columns={[
                { header: "Tool", render: (t) => <code>{t.tool}</code> },
                { header: "Status", render: (t) => <Status entity="tool" value={t.status} /> },
                { header: "Rows", render: (t) => t.rows_returned ?? "—", numeric: true },
                { header: "Time", render: (t) => (t.duration_ms != null ? fmtMs(t.duration_ms) : "—"), numeric: true },
              ]}
            />
          </Card>
        )}
      </SimpleGrid>
    </>
  );
}

function Stat({ label, value, warn }: { label: string; value: string | number; warn?: string }) {
  return (
    <Paper withBorder p="sm" radius="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text>
      <Text size="xl" fw={700}>{value}</Text>
      {warn && <StatusPill status="fail" label={warn} />}
    </Paper>
  );
}

function NoDiagnosis({ inv, onChanged }: { inv: Investigation; onChanged?: () => void }) {
  const last = inv.last_status_change;
  if (inv.status === "queued" || inv.status === "running")
    return (
      <Card title={inv.status === "queued" ? "Waiting for a worker" : "Investigating"}>
        <Group gap="md" wrap="nowrap" align="flex-start" mb="md" role="status">
          <Loader type="dots" size="md" aria-hidden="true" />
          <Text>
            {inv.status === "queued" ? `Queued${inv.created_at ? ` for ${secondsSince(inv.created_at)}` : ""} — a worker will pick this up shortly.` : "Running — collecting evidence and testing hypotheses."}{" "}
            This page updates on its own; you can leave and come back.
          </Text>
        </Group>
        <ActionButton
          label="Cancel investigation"
          busyLabel="Cancelling…"
          variant="danger"
          icon={<IconPlayerStop size={16} />}
          disabledReason={canAct("investigator") ? undefined : "Requires the investigator role"}
          confirm={{ title: "Cancel this investigation?", prompt: "It stops at its next step and cannot be resumed. You can start a new one from the incident.", confirmLabel: "Yes, cancel it" }}
          onAction={async () => {
            let r: { result: string };
            try {
              r = await api<{ result: string }>(`/investigations/${inv.id}/cancel`, { method: "POST" });
            } catch (e) {
              if (e instanceof ApiError && e.status === 409) throw new Error("The investigation finished before the cancellation arrived, so nothing was cancelled. Its result is shown on this page.");
              throw e;
            }
            sessionStorage.setItem("drc.focusCancelled", inv.id);
            announce(r.result === "cancelled" ? "Investigation cancelled." : "Cancellation requested; it stops at its next step.");
            onChanged?.();
          }}
        />
      </Card>
    );
  if (inv.status === "cancelled") {
    const who = inv.cancel_requested_by?.actor ?? last?.actor;
    return (
      <Alert
        ref={(el) => {
          // the Cancel button unmounted with the state change: put focus on the outcome instead of <body>
          if (el && sessionStorage.getItem("drc.focusCancelled") === inv.id) {
            sessionStorage.removeItem("drc.focusCancelled");
            el.focus();
          }
        }}
        tabIndex={-1}
        color="gray" variant="light" radius="lg" icon={<IconPlayerStop size={20} />} title="Investigation cancelled" mb="lg" role="note">
        <Text size="sm" mb="xs">
          Cancelled{who ? <> at the request of <strong>{who.replace(/^dev:/, "")}</strong></> : null}
          {last ? <> · stopped {fmtTime(last.at)}</> : null}. No diagnosis was produced.
        </Text>
        <Button component="a" href={`#/incidents/${inv.incident_id}`} size="xs" variant="default">Back to the incident</Button>
      </Alert>
    );
  }
  return (
    <Alert color="red" variant="light" radius="lg" icon={<IconAlertTriangle size={20} />} title="Investigation failed" mb="lg" role="note">
      <Text size="sm" mb="xs">The investigation stopped before producing a diagnosis{last ? <> ({fmtTime(last.at)})</> : null}.</Text>
      <Button component="a" href={`#/incidents/${inv.incident_id}`} size="xs" variant="default">Back to the incident to start a new one</Button>
    </Alert>
  );
}

function ValidateButton({ proposalId, again }: { proposalId: string; again: boolean }) {
  return (
    <ActionButton
      label={again ? "Validate again in sandbox" : "Validate in sandbox"}
      busyLabel="Starting validation…"
      icon={<IconFlask2 size={16} />}
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
  const approved = r.decision === "approve";
  return (
    <Paper withBorder p="lg" radius="lg" mb="lg" className={`decision ${approved ? "decision-approve" : "decision-reject"}`} component="section" aria-labelledby={`dec-${inv.id}`}>
      <Group justify="space-between" mb="sm">
        <Group gap="sm">
          <ThemeIcon variant="light" color={approved ? "teal" : "red"} radius="xl" size="lg" aria-hidden="true">{approved ? <IconThumbUp size={18} /> : <IconThumbDown size={18} />}</ThemeIcon>
          <h2 id={`dec-${inv.id}`} ref={ref} tabIndex={-1} className="focus-heading card-title-h">Decision recorded</h2>
        </Group>
        <Status entity="decision" value={r.decision} />
      </Group>
      <dl className="kv">
        <dt>Decision</dt>
        <dd>{approved ? "Diagnosis approved" : "Diagnosis rejected"}</dd>
        <dt>Reviewer</dt>
        <dd>{r.reviewer.replace(/^dev:/, "")}</dd>
        <dt>When</dt>
        <dd>{fmtTime(r.at)}</dd>
        <dt>Note</dt>
        <dd>{r.note ? `“${r.note}”` : <Text span c="dimmed" size="sm">No note</Text>}</dd>
      </dl>
      <Text size="sm" c="dimmed" mt="sm">
        Recording a decision does not change production. <a href={`#/incidents/${inv.incident_id}`}>Go to the incident</a> to see or change its status.
      </Text>
    </Paper>
  );
}

function ReviewCard({ inv, onChanged }: { inv: Investigation; onChanged?: () => void }) {
  const draftKey = `drc.reviewDraft.${inv.id}`;
  const [note, setNoteState] = useState(() => sessionStorage.getItem(draftKey) ?? "");
  const [resolve, setResolve] = useState(false); // opt-in: approving the diagnosis ≠ closing the incident (C07)
  const [noteError, setNoteError] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  if (inv.status !== "awaiting_review") return null;

  const setNote = (v: string) => {
    setNoteState(v);
    if (v) sessionStorage.setItem(draftKey, v);
    else sessionStorage.removeItem(draftKey);
    if (v.trim()) setNoteError(null);
  };
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

  const proposal = inv.proposals[0];
  const validated = proposal?.status === "validated";
  const validating = proposal?.status === "validating";
  const recoveryLine = !proposal ? (
    <Text size="sm" c="dimmed">No recovery was proposed for this diagnosis.</Text>
  ) : validating ? (
    <Alert color="blue" variant="light" radius="md" icon={<Loader size={16} />} p="sm" role="note">
      <Text size="sm">Sandbox validation of <code>{proposal.playbook}</code> is in progress — wait for the result before deciding.{" "}
        {proposal.latest_validation_run_id && <a href={`#/validation-runs/${proposal.latest_validation_run_id}`}>Follow the validation</a>}</Text>
    </Alert>
  ) : validated ? (
    <Group gap="xs"><EpistemicTag kind="verified" /><Text size="sm">Recovery <code>{proposal.playbook}</code> passed sandbox validation. <a href={`#/validation-runs/${proposal.latest_validation_run_id}`}>See results</a></Text></Group>
  ) : (
    <Alert color="yellow" variant="light" radius="md" icon={<IconAlertTriangle size={18} />} p="sm" role="note">
      <Text size="sm" mb="xs">Recovery <code>{proposal.playbook}</code> is <strong>{statusLabel("proposal", proposal.status).toLowerCase()}</strong> and has not passed sandbox validation. Validate it before approving.</Text>
      <Group gap="sm">
        <ValidateButton proposalId={proposal.id} again={!!proposal.latest_validation_run_id} />
        {proposal.latest_validation_run_id && <a href={`#/validation-runs/${proposal.latest_validation_run_id}`}>See the last validation</a>}
      </Group>
    </Alert>
  );

  return (
    <Card title={<Group gap="xs"><IconGavel size={20} aria-hidden="true" /> Human review</Group>}>
      <Stack gap="sm">
        <Paper withBorder p="sm" radius="md" className="review-context">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={4}>What you are deciding on</Text>
          <Group gap="xs" mb={6}>{inv.outcome && <Status entity="outcome" value={inv.outcome} />}<Text size="sm">{inv.diagnosis?.summary}</Text></Group>
          {recoveryLine}
        </Paper>
        {getRole() !== "approver" ? (
          <AccessDenied message="Approvers record the decision on this diagnosis; you can read everything here." needed="approver" />
        ) : (
          <>
            <Textarea
              ref={noteRef}
              label="Review note"
              description="Required to reject; recommended to approve. Saved with your decision."
              value={note}
              onChange={(e) => setNote(e.currentTarget.value)}
              autosize
              minRows={3}
              error={noteError}
            />
            <Checkbox label="Also mark the incident as resolved when approving" checked={resolve} onChange={(e) => setResolve(e.currentTarget.checked)} />
            <Group gap="sm" align="flex-start">
              <ActionButton
                label="Approve diagnosis"
                busyLabel="Recording…"
                variant="primary"
                icon={<IconCircleCheck size={16} />}
                precheck={() => { setNoteError(null); return true; }}
                disabledReason={validating ? "Wait for the sandbox validation to finish" : undefined}
                confirm={{
                  title: "Approve this diagnosis?",
                  prompt: <>{!validated && proposal ? "The proposed recovery has not passed sandbox validation. " : ""}The decision is recorded with your name{resolve ? " and the incident is marked resolved (it can be reopened)" : ""}. It cannot be undone.</>,
                  confirmLabel: "Yes, approve",
                }}
                onAction={decide("approve")}
              />
              <ActionButton
                label="Reject diagnosis"
                busyLabel="Recording…"
                variant="danger"
                icon={<IconThumbDown size={16} />}
                confirm={{ title: "Reject this diagnosis?", prompt: "The incident stays unresolved so another investigation can be started. The decision cannot be undone.", confirmLabel: "Yes, reject" }}
                precheck={noteGiven}
                onAction={decide("reject")}
              />
            </Group>
          </>
        )}
      </Stack>
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
  const [open, setOpen] = useState<string[]>([]);
  const [origin, setOrigin] = useState<{ id: string; origin: string } | null>(null);
  useEffect(() => {
    const on = (ev: Event) => {
      const { target, origin: o } = (ev as CustomEvent<{ target: string; origin: string }>).detail;
      setOrigin({ id: target, origin: o });
      setOpen((cur) => (cur.includes(target) ? cur : [...cur, target]));
      requestAnimationFrame(() => requestAnimationFrame(() => revealAndFocus(document.getElementById(`ev-${target}`))));
    };
    addEventListener("drc:cite", on);
    return () => removeEventListener("drc:cite", on);
  }, []);
  const all = open.length === evidence.length && evidence.length > 0;
  return (
    <Card
      title={`Evidence (${evidence.length})`}
      actions={evidence.length > 0 && (
        <Button variant="default" size="xs" aria-expanded={all} onClick={() => setOpen(all ? [] : evidence.map((e) => e.id))}>{all ? "Collapse all" : "Expand all"}</Button>
      )}
    >
      <Text size="sm" c="dimmed" mb="sm">Untrusted data collected by bounded, read-only tools. Citation chips open the item they point to.</Text>
      {evidence.length ? (
        <Accordion multiple value={open} onChange={setOpen} variant="contained" radius="md" chevronPosition="left" className="evidence-acc">
          {evidence.map((e) => {
            const first = (e.content ?? "").split("\n")[0];
            return (
              <Accordion.Item key={e.id} value={e.id} id={`ev-${e.id}`} tabIndex={-1} className="evidence" aria-label={`Evidence ${e.id}`}>
                <Accordion.Control>
                  <Group gap="xs" wrap="wrap">
                    <code>{e.id}</code>
                    <Badge variant="light" color="gray" radius="sm" tt="none" fw={600}>{evidenceKind(e.kind)}</Badge>
                    <Status entity="access" value={e.access} />
                  </Group>
                  {!open.includes(e.id) && first && <Text size="xs" c="dimmed" ff="monospace" mt={4} lineClamp={1}>{first}</Text>}
                </Accordion.Control>
                <Accordion.Panel>
                  <dl className="kv kv-mono">
                    <dt>Source</dt>
                    <dd>{e.source}</dd>
                    <dt>Locator</dt>
                    <dd>{e.locator}</dd>
                    <dt>Run</dt>
                    <dd>{e.pipeline_run_id ?? "—"}</dd>
                    <dt>Collected</dt>
                    <dd>{fmtTime(e.collected_at)}</dd>
                    <dt>Version</dt>
                    <dd>{e.version ?? "—"}</dd>
                  </dl>
                  {e.redacted || e.content == null ? (
                    <AccessDenied message="Content is restricted for your role." needed="investigator" />
                  ) : (
                    <pre tabIndex={0} aria-label={`Evidence ${e.id} content (untrusted data)`}>{e.content}</pre>
                  )}
                  {origin?.id === e.id && <BackToClaim origin={origin.origin} onDone={() => setOrigin(null)} />}
                </Accordion.Panel>
              </Accordion.Item>
            );
          })}
        </Accordion>
      ) : (
        <EmptyState title={active ? "Evidence appears here as tools return results" : "No evidence collected"} icon={active ? <IconClockHour4 size={22} /> : undefined} />
      )}
      <Text size="xs" c="dimmed" mt="sm"><IconShieldCheck size={12} aria-hidden="true" /> Evidence ids are content-addressed: the same fact always has the same id.</Text>
    </Card>
  );
}

function secondsSince(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000)); // re-rendered by the 2 s polling
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

function evidenceKind(kind: string) {
  return humanize(kind).replace(/^Dbt\b/, "dbt");
}
