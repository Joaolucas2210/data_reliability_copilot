import { Alert, Badge, Button, Group, Paper, Select, SimpleGrid, Stack, Text, Textarea, TextInput } from "@mantine/core";
import { IconCircleCheck, IconCircleDot, IconFlag, IconPlayerPlay, IconRefresh, IconSearch, IconX } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { announce, api, canAct, useApi } from "../api";
import { ActionButton, Breadcrumbs, Card, DataTable, EmptyState, fmtTime, LoadView, NotFound, PageTitle, revealAndFocus, Status, Timeline } from "../components/ui";
import { checkLabel, checkResult, eventSentence } from "../labels";
import { OPEN_INVESTIGATION, statusLabel } from "../status";
import type { AuditEvent, Incident, IncidentDetail, QualityCheckResult } from "../types";

const INCIDENT_STATUSES = ["open", "investigating", "awaiting_review", "resolved", "dismissed"];
const FILTER_LABEL = (s: string) => (s === "unresolved" ? "Unresolved (open, investigating or awaiting review)" : statusLabel("incident", s));
const PAGE = 25; // ponytail: client-side paging over the 200 fetched rows; server paging when lists grow
const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function IncidentList({ initialStatus = "", initialQuery = "", initialSort = "newest" }: { initialStatus?: string; initialQuery?: string; initialSort?: string }) {
  const [status, setStatus] = useState(initialStatus);
  const [query, setQuery] = useState(initialQuery);
  const [sort, setSort] = useState(initialSort);
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [status, query, sort]);
  const [load, reload] = useApi<Incident[]>(`/incidents?limit=200${status ? `&status=${status}` : ""}`);
  // pending announcement; for a status change it waits for data newer than what was on screen (no stale counts)
  const changed = useRef<false | { after?: Date }>(false);

  const choose = (s: string) => {
    setStatus(s);
    changed.current = { after: load.state === "ok" ? load.updatedAt : undefined };
  };

  // keep filter, search and sort in the URL (reload/back/share) without adding a history entry per change
  useEffect(() => {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (query) qs.set("q", query);
    if (sort !== "newest") qs.set("sort", sort);
    history.replaceState(null, "", `#/incidents${qs.size ? `?${qs}` : ""}`);
  }, [status, query, sort]);

  const rows = useMemo(() => {
    if (load.state !== "ok") return [];
    const q = query.trim().toLowerCase();
    const filtered = q ? load.data.filter((i) => `${i.title} ${i.id} ${i.dataset_id ?? ""}`.toLowerCase().includes(q)) : load.data;
    const sorted = [...filtered];
    if (sort === "oldest") sorted.reverse();
    if (sort === "severity") sorted.sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9));
    return sorted;
  }, [load, query, sort]);

  useEffect(() => {
    const pending = changed.current;
    if (load.state === "ok" && pending && !load.refreshing && (!pending.after || load.updatedAt !== pending.after)) {
      changed.current = false;
      announce(`${rows.length} incident${rows.length === 1 ? "" : "s"} shown${status ? ` with status ${FILTER_LABEL(status).toLowerCase()}` : ""}.`);
    }
  }, [load, rows.length, status]);

  return (
    <>
      <PageTitle>Incidents</PageTitle>
      <Paper withBorder p="md" mb="lg" className="filters">
        <Group align="flex-end" gap="md" wrap="wrap">
          <Select
            label="Status"
            value={status}
            onChange={(v) => choose(v ?? "")}
            allowDeselect={false}
            w={220}
            data={[
              { value: "", label: "All statuses" },
              { value: "unresolved", label: "Unresolved" },
              ...INCIDENT_STATUSES.map((s) => ({ value: s, label: statusLabel("incident", s) })),
            ]}
          />
          <TextInput
            label="Search"
            placeholder="Title, id or dataset"
            leftSection={<IconSearch size={16} />}
            value={query}
            onChange={(e) => { setQuery(e.currentTarget.value); changed.current = {}; }}
            w={260}
            rightSection={query ? (
              <button type="button" className="icon-btn" aria-label="Clear search" onClick={() => { setQuery(""); changed.current = {}; }}><IconX size={16} /></button>
            ) : null}
          />
          <Select label="Sort" value={sort} onChange={(v) => setSort(v ?? "newest")} allowDeselect={false} w={180}
            data={[{ value: "newest", label: "Newest first" }, { value: "oldest", label: "Oldest first" }, { value: "severity", label: "Severity" }]} />
          {load.state === "ok" && <Text size="sm" c="dimmed" ml="auto">{rows.length > limit ? `Showing ${limit} of ${rows.length} matching` : `${rows.length} of ${load.data.length} incidents`}</Text>}
        </Group>
      </Paper>
      <LoadView load={load} onRetry={reload}>
        {() => (
          <>
          <IncidentTable
            rows={rows.slice(0, limit)}
            empty={
              status || query ? (
                <EmptyState
                  title={query && status ? `No ${FILTER_LABEL(status).toLowerCase()} incidents match “${query}”` : query ? `No incidents match “${query}”` : `No incidents with status “${FILTER_LABEL(status)}”`}
                  hint={<Group gap="md" justify="center">{query && <Button size="xs" variant="default" onClick={() => { setQuery(""); changed.current = {}; }}>Clear search</Button>}{status && <Button size="xs" variant="default" onClick={() => choose("")}>Show all statuses</Button>}</Group>}
                />
              ) : (
                <EmptyState title="No incidents yet" hint="Incidents appear here when a quality check fails after a pipeline run." />
              )
            }
          />
          {rows.length > limit && (
            <Group justify="center" mt="md">
              <Button
                variant="default"
                onClick={() => {
                  const next = limit;
                  setLimit(limit + PAGE);
                  // keep the keyboard position: move to the first newly shown incident
                  requestAnimationFrame(() => document.querySelectorAll<HTMLElement>("table .row-title")[next]?.focus());
                }}
              >
                Show {Math.min(PAGE, rows.length - limit)} more ({rows.length - limit} not shown)
              </Button>
            </Group>
          )}
          </>
        )}
      </LoadView>
    </>
  );
}

export function IncidentTable({ rows, empty }: { rows: Incident[]; empty?: ReactNode }) {
  return (
    <DataTable
      caption="Incidents"
      rows={rows}
      rowKey={(r) => r.id}
      empty={empty ?? <EmptyState title="No incidents yet" />}
      columns={[
        { header: "Incident", render: (r) => <><a href={`#/incidents/${r.id}`} className="row-title">{r.title}</a><code className="cell-code">{r.id}</code></> },
        { header: "Severity", render: (r) => <Status entity="severity" value={r.severity} /> },
        { header: "Status", render: (r) => <Status entity="incident" value={r.status} /> },
        { header: "Dataset", render: (r) => <code>{r.dataset_id ?? "—"}</code> },
        { header: "Occurrences", render: (r) => r.occurrences, numeric: true },
        { header: "Opened", render: (r) => <span className="nowrap">{fmtTime(r.opened_at)}</span> },
      ]}
    />
  );
}

export function IncidentDetailPage({ id }: { id: string }) {
  const [load, reload] = useApi<IncidentDetail>(`/incidents/${id}`);
  const key = useRef(`ui-start-${id}-${Date.now()}`); // one idempotency key per page visit = per intent
  const notFound = load.state === "error" && load.status === 404;

  useEffect(() => {
    if (load.state === "ok") document.title = `${load.data.incident.title} · Incident · Data Reliability Copilot`;
    if (notFound) document.title = "Incident not found · Data Reliability Copilot";
  }, [load, notFound]);

  const start = async () => {
    const r = await api<{ investigation_id: string }>(`/incidents/${id}/investigations`, { method: "POST", headers: { "Idempotency-Key": key.current } });
    announce("Investigation started. Opening it.");
    location.hash = `#/investigations/${r.investigation_id}`;
  };

  return (
    <>
      <Breadcrumbs items={[{ href: "#/incidents", label: "Incidents" }, { label: load.state === "ok" ? "Incident" : id }]} />
      {/* one persistent h1: its text changes with the load state, the element (and focus on it) survives (C01) */}
      <PageTitle>{load.state === "ok" ? load.data.incident.title : notFound ? "Incident not found" : "Incident"}</PageTitle>
      <LoadView load={load} onRetry={reload} notFound={<NotFound what="incident" id={id} back={{ href: "#/incidents", label: "Back to incidents" }} />}>
        {(d) => (
          <>
            <Group gap="xs" mb="lg">
              <Status entity="incident" value={d.incident.status} />
              <Status entity="severity" value={d.incident.severity} />
              <Text size="sm" c="dimmed" ff="monospace">{d.incident.id}</Text>
              {d.incident.dataset_id && <Badge variant="outline" color="gray" radius="sm" tt="none" ff="monospace">{d.incident.dataset_id}</Badge>}
            </Group>
            <IncidentBody d={d} onStart={start} onChanged={reload} />
          </>
        )}
      </LoadView>
    </>
  );
}

export function IncidentBody({ d, onStart, onChanged }: { d: IncidentDetail; onStart?: () => Promise<void>; onChanged?: () => void }) {
  const closed = d.incident.status === "resolved" || d.incident.status === "dismissed";
  const active = d.investigations.find((i) => OPEN_INVESTIGATION.has(i.status));
  const startAction = onStart && !closed && (
    <ActionButton
      label={active ? "Start another investigation" : "Start investigation"}
      busyLabel="Starting…"
      variant={active ? "secondary" : "primary"}
      icon={<IconPlayerPlay size={16} />}
      onAction={onStart}
      disabledReason={canAct("investigator") ? undefined : "Requires the investigator role"}
      confirm={active ? { title: "Start another investigation?", prompt: <>Investigation <code>{active.id}</code> is still {statusLabel("investigation", active.status).toLowerCase()}. Start another one anyway?</>, confirmLabel: "Yes, start another" } : undefined}
    />
  );
  // latest decided investigation, while the incident is still open and nothing newer is running
  const latest = d.investigations.find((i) => i.status !== "cancelled" && i.status !== "failed"); // newest that produced something
  const decided = !closed && !active && latest?.review_decision ? latest : undefined;
  const manual = d.incident.title.startsWith("Manual report:");
  return (
    <>
      {decided && (
        <Alert
          color={decided.review_decision === "approve" ? "teal" : "gray"}
          variant="light"
          radius="lg"
          mb="lg"
          role="note"
          icon={decided.review_decision === "approve" ? <IconCircleCheck size={20} /> : <IconX size={20} />}
          title={decided.review_decision === "approve" ? "Diagnosis approved — incident not closed yet" : "Diagnosis rejected — the cause is still open"}
        >
          <Text size="sm">
            {decided.review_decision === "approve" ? (
              <>The diagnosis of <a href={`#/investigations/${decided.id}`}>{decided.id}</a> was approved. {canAct("approver") ? <>Mark the incident resolved (or dismiss it) under <a href="#incident-closure" onClick={(e) => { e.preventDefault(); revealAndFocus(document.querySelector<HTMLElement>("#incident-closure h2")); }}>Close the incident</a> below.</> : "An approver can now mark the incident resolved."}</>
            ) : (
              <>The diagnosis of <a href={`#/investigations/${decided.id}`}>{decided.id}</a> was rejected. Start another investigation{canAct("approver") ? <>, or dismiss the incident under <a href="#incident-closure" onClick={(e) => { e.preventDefault(); revealAndFocus(document.querySelector<HTMLElement>("#incident-closure h2")); }}>Close the incident</a> if it is not a real problem</> : null}.</>
            )}
          </Text>
        </Alert>
      )}
      <Card title={manual ? "Failing checks on the related run" : "Triggering checks"}>
        <CheckTable rows={d.checks} />
      </Card>
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg" style={{ alignItems: "start" }}>
        <Card title="Investigations" actions={startAction}>
          {active && (
            <Paper withBorder p="sm" mb="sm" className="soft-info" role="note">
              <Text size="sm">Investigation <a href={`#/investigations/${active.id}`}>{active.id}</a> is {statusLabel("investigation", active.status).toLowerCase()}.</Text>
            </Paper>
          )}
          {closed && <Text size="sm" c="dimmed" mb="sm">This incident is {statusLabel("incident", d.incident.status).toLowerCase()}; reopen it to start new investigations.</Text>}
          {d.investigations.length ? (
            <Stack gap="xs">
              {d.investigations.map((i) => (
                <Paper key={i.id} withBorder p="sm" className="inv-item">
                  <Group justify="space-between" gap="xs" wrap="wrap">
                    <a href={`#/investigations/${i.id}`} className="mono">{i.id}</a>
                    <Group gap={6}>
                      {i.review_decision ? <Status entity="decision" value={i.review_decision} /> : <Status entity="investigation" value={i.status} />}
                      {i.outcome && <Status entity="outcome" value={i.outcome} />}
                    </Group>
                  </Group>
                  <Text size="xs" c="dimmed" mt={4}>Started {fmtTime(i.created_at)}{i.mode === "fake" ? " · simulated LLM" : ""}</Text>
                </Paper>
              ))}
            </Stack>
          ) : (
            <EmptyState title="Not investigated yet" hint={closed ? undefined : canAct("investigator") ? "Start an investigation to collect evidence and get a diagnosis." : "An investigator can start an investigation to collect evidence and get a diagnosis."} />
          )}
        </Card>
        <Card title="Timeline">
          <Timeline items={d.timeline.map((e) => eventItem(e, d.incident.id))} />
        </Card>
      </SimpleGrid>
      {onChanged && <IncidentDecision d={d} onChanged={onChanged} />}
    </>
  );
}

/** Human closure / reopening of the incident itself (approver), with a note; audited by the API. */
function IncidentDecision({ d, onChanged }: { d: IncidentDetail; onChanged: () => void }) {
  const [note, setNote] = useState("");
  const closed = d.incident.status === "resolved" || d.incident.status === "dismissed";
  const allowed = canAct("approver");
  useEffect(() => {
    // the button that was used is replaced by the new state: put focus on this card's heading, not <body>
    // (flag in sessionStorage: the card may remount while the incident reloads)
    if (sessionStorage.getItem("drc.focusClosure") === d.incident.id + ":" + d.incident.status) {
      sessionStorage.removeItem("drc.focusClosure");
      // after the confirmation modal has finished closing (it returns focus to the now-removed trigger)
      setTimeout(() => document.querySelector<HTMLElement>("#incident-closure h2")?.focus(), 350);
    }
  }, [d.incident.status]);
  const change = (to: "resolved" | "dismissed" | "open", msg: string) => async () => {
    await api(`/incidents/${d.incident.id}/status`, { method: "POST", body: JSON.stringify({ to, note }) });
    setNote("");
    sessionStorage.setItem("drc.focusClosure", `${d.incident.id}:${to}`);
    announce(msg);
    onChanged();
  };
  return (
    <Card id="incident-closure" title={closed ? "Incident closed" : "Close the incident"}>
      <Text size="sm" c="dimmed" mb="sm">
        {closed
          ? `Marked ${statusLabel("incident", d.incident.status).toLowerCase()}${d.incident.closed_at ? ` at ${fmtTime(d.incident.closed_at)}` : ""}. Reopen it if the problem is not actually fixed.`
          : "Resolve when the report is confirmed correct again; dismiss when this was not a real problem. Both are recorded with your note and can be reopened."}
      </Text>
      {allowed ? (
        <>
          <Textarea label="Note (optional)" value={note} onChange={(e) => setNote(e.currentTarget.value)} autosize minRows={2} mb="sm" maw={560} />
          <Group gap="sm" align="flex-start">
            {closed ? (
              <ActionButton label="Reopen incident" busyLabel="Reopening…" icon={<IconRefresh size={16} />}
                confirm={{ title: "Reopen this incident?", prompt: "It goes back to Open so it can be investigated again.", confirmLabel: "Yes, reopen" }}
                onAction={change("open", "Incident reopened.")} successMessage="Incident reopened." />
            ) : (
              <>
                <ActionButton label="Mark resolved" busyLabel="Saving…" variant="primary" icon={<IconCircleCheck size={16} />}
                  confirm={{ title: "Mark this incident resolved?", prompt: "Use this when the report is confirmed correct again. You can reopen it later.", confirmLabel: "Yes, resolve" }}
                  onAction={change("resolved", "Incident marked resolved.")} successMessage="Incident marked resolved." />
                <ActionButton label="Dismiss" busyLabel="Saving…" icon={<IconFlag size={16} />}
                  confirm={{ title: "Dismiss this incident?", prompt: "Use this when it was not a real problem. You can reopen it later.", confirmLabel: "Yes, dismiss" }}
                  onAction={change("dismissed", "Incident dismissed.")} successMessage="Incident dismissed." />
              </>
            )}
          </Group>
        </>
      ) : (
        <Text size="sm" c="dimmed">Approvers can resolve, dismiss or reopen incidents.</Text>
      )}
    </Card>
  );
}

function eventItem(e: AuditEvent, selfId: string) {
  const detail = e.detail ?? {};
  const decision = typeof detail.decision === "string" ? detail.decision : null;
  const note = typeof detail.note === "string" && detail.note ? detail.note : null;
  const done = e.to_status && ["resolved", "completed", "passed", "validated", "approved"].includes(e.to_status);
  return {
    key: String(e.id),
    at: e.at,
    icon: done ? <IconCircleCheck size={14} /> : <IconCircleDot size={12} />,
    title: (
      <>
        {eventSentence(e)} {decision && <Status entity="decision" value={decision} />}
      </>
    ),
    detail: (
      <>
        {/* the related entity on its own line, except a link to this very incident */}
        {e.entity_id !== selfId && <span style={{ display: "block" }}><EntityLink type={e.entity_type} id={e.entity_id} /></span>}
        by {e.actor.replace(/^dev:/, "")}
        {note && <> · “{note}”</>}
      </>
    ),
  };
}

const ENTITY_ROUTE: Record<string, string> = { incident: "#/incidents/", investigation: "#/investigations/", validation: "#/validation-runs/" };

function EntityLink({ type, id }: { type: string; id: string }) {
  const base = ENTITY_ROUTE[type];
  return base ? <a href={base + id} className="mono entity-link">{id}</a> : null;
}

export function CheckTable({ rows }: { rows: QualityCheckResult[] }) {
  return (
    <DataTable
      caption="Failing quality checks for this run"
      rows={rows}
      rowKey={(r) => r.id}
      columns={[
        { header: "Check", render: (r) => <><span className="cell-title">{checkLabel(r.check_name)}</span><code className="cell-code">{r.check_name}</code></> },
        { header: "Type", render: (r) => CHECK_TYPE[r.check_type] ?? r.check_type },
        { header: "Status", render: (r) => <Status entity="check" value={r.status} /> },
        { header: "Result", render: (r) => checkResult(r) },
      ]}
    />
  );
}

const CHECK_TYPE: Record<string, string> = {
  schema_contract: "Schema contract", data_test: "Data test", freshness: "Freshness", invariant: "Business invariant", anomaly: "Anomaly", model_run: "Model build",
};
