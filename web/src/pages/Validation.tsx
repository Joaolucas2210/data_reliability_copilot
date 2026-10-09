import { Accordion, Alert, Button, Code, Group, Loader, Text, ThemeIcon, Timeline } from "@mantine/core";
import { IconAlertTriangle, IconArrowLeft, IconCircleCheck, IconCircleDashed, IconCircleX } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { announceStatus, useApi } from "../api";
import { Breadcrumbs, Card, DataTable, EpistemicTag, fmtClock, fmtTime, fmtValue, LoadView, NotFound, PageTitle, Status, StatusPill } from "../components/ui";
import { checkLabel } from "../labels";
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
    if (prevStatus.current && prevStatus.current !== st) announceStatus(`Sandbox validation ${statusLabel("validation", st).toLowerCase()}.`);
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
      <PageTitle>{notFound ? "Validation run not found" : <>Sandbox validation <code>{v?.id ?? id}</code></>}</PageTitle>
      <LoadView load={load} onRetry={reload} notFound={<NotFound what="validation run" id={id} back={{ href: "#/incidents", label: "Back to incidents" }} />}>
        {(run) => <ValidationView v={run} updatedAt={load.state === "ok" ? load.updatedAt : undefined} showTitle={false} />}
      </LoadView>
    </>
  );
}

export function ValidationView({ v, updatedAt, showTitle = true }: { v: ValidationRun; updatedAt?: Date; showTitle?: boolean }) {
  const passed = v.status === "passed";
  const active = v.status === "queued" || v.status === "running";
  const steps = v.steps ?? [];
  const isolation = v.isolation_checks ?? [];
  const invariants = v.invariants ?? [];
  const keys = [...new Set([...Object.keys(v.metrics_before ?? {}), ...Object.keys(v.metrics_after ?? {})])];
  const elapsed = useElapsed(v.started_at, active ? null : v.finished_at);
  const decided = v.investigation_status === "completed";
  const failedStep = steps.find((s) => s.status === "fail" || s.status === "error");
  return (
    <>
      {showTitle && <PageTitle>Sandbox validation <code>{v.id}</code></PageTitle>}
      <Group gap="xs" mb="sm" wrap="wrap">
        <Status entity="validation" value={v.status} />
        {passed && <EpistemicTag kind="verified" />}
        <Text size="sm" c="dimmed">
          {v.playbook && <>playbook <code>{v.playbook}</code> · </>}{v.status === "queued" ? <>requested {fmtTime(v.started_at)} · queued for {elapsed}</> : <>started {fmtTime(v.started_at)} · {active ? "running for" : "took"} {elapsed}</>}
          {active && updatedAt && <> · updates automatically · last checked {fmtClock(updatedAt)}</>}
        </Text>
      </Group>
      <Text size="sm" c="dimmed" mb="lg">
        Runs only on an isolated copy (<code>{v.sandbox_db}</code>{v.cleaned_up_at ? <>, removed {fmtTime(v.cleaned_up_at)}</> : null}). "Verified" means the checks below passed in
        the sandbox; nothing was applied to production.
      </Text>

      {!active && (
        <Alert
          color={passed ? "teal" : "red"}
          variant="light"
          radius="lg"
          mb="lg"
          role="note"
          icon={passed ? <IconCircleCheck size={20} /> : <IconAlertTriangle size={20} />}
          title={passed ? "The recovery fixed the sandbox copy" : `Validation ${v.status === "error" ? "stopped with an error" : "failed"}${failedStep ? ` at “${STEP_INFO[failedStep.name]?.[0] ?? failedStep.name}”` : ""}`}
        >
          <Text size="sm" mb="sm">
            {passed
              ? decided
                ? "All stages and invariants passed on the isolated copy. The diagnosis has already been reviewed."
                : "All stages and invariants passed on the isolated copy. An approver can now review the diagnosis with this result in view."
              : v.error ?? "See the failing stage below. The recovery should not be approved as is."}
          </Text>
          {v.investigation_id && (
            <Button component="a" href={`#/investigations/${v.investigation_id}`} size="xs" variant={passed ? "filled" : "default"} leftSection={<IconArrowLeft size={14} />}>
              {decided ? "Back to the investigation" : "Back to the investigation to review"}
            </Button>
          )}
        </Alert>
      )}

      <Card title={active ? (v.status === "queued" ? "Waiting for a worker" : "Validating in the sandbox") : "Stages"}>
        {active && (
          <Group gap="sm" mb="md" wrap="nowrap" role="status">
            <Loader size="sm" type="dots" aria-hidden="true" />
            <Text size="sm">
              {v.status === "queued" ? "Queued — a worker will start it shortly." : `Stage ${Math.min(steps.length + 1, 6)} of 6: ${STEP_INFO[Object.keys(STEP_INFO)[steps.length]]?.[0] ?? "finishing"}.`} Usually about
              a minute; you can leave and come back.
            </Text>
          </Group>
        )}
        <Timeline active={steps.length - 1} bulletSize={26} lineWidth={2} className="stages">
          {Object.entries(STEP_INFO).map(([k, [title, info]], i) => {
            const s = steps.find((x) => x.name === k);
            const current = active && v.status === "running" && i === steps.length;
            const ok = s?.status === "pass";
            const bad = s && (s.status === "fail" || s.status === "error");
            return (
              <Timeline.Item
                key={k}
                bullet={
                  <ThemeIcon size={26} radius="xl" variant={s ? "filled" : "light"} color={ok ? "teal" : bad ? "red" : s ? "gray" : "gray"} aria-hidden="true">
                    {current ? <Loader size={12} color="currentColor" /> : ok ? <IconCircleCheck size={16} /> : bad ? <IconCircleX size={16} /> : <IconCircleDashed size={16} />}
                  </ThemeIcon>
                }
                title={
                  <Group gap="xs" wrap="wrap">
                    <Text fw={600}>{title}</Text>
                    {s ? <Status entity="check" value={s.status} /> : <Text size="sm" c="dimmed">{current ? "in progress" : active ? "pending" : "not run"}</Text>}
                    {s?.duration_ms != null && <Text size="sm" c="dimmed">{fmtMs(s.duration_ms)}</Text>}
                  </Group>
                }
              >
                <Text size="sm" c="dimmed">{info}</Text>
                {s?.detail != null && <StepDetail detail={s.detail} />}
              </Timeline.Item>
            );
          })}
        </Timeline>
      </Card>
      {!active && (
      <>
      <Card title="Isolation checks">
          <DataTable
            caption="Checks that the sandbox cannot touch production"
            rows={isolation}
            rowKey={(c) => c.name}
            columns={[
              { header: "Check", render: (c) => humanizeName(c.name) },
              { header: "Result", render: (c) => <StatusPill status={c.passed ? "pass" : "fail"} label={c.passed ? "isolated" : "NOT isolated"} /> },
              { header: "Detail", render: (c) => (typeof c.detail === "string" ? <IsolationDetail text={c.detail} passed={c.passed} /> : <StepDetail detail={c.detail} />) },
            ]}
          />
        </Card>
        <Card title="Business invariants">
          <DataTable
            caption="Invariants before and after the recovery"
            rows={invariants}
            rowKey={(i) => i.name}
            columns={[
              { header: "Invariant", render: (i) => <><span className="cell-title">{checkLabel(i.name)}</span><code className="cell-code">{i.name}</code></> },
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
            { header: "Metric", render: (k) => <><span className="cell-title">{METRIC_LABEL[k] ?? humanizeName(k)}</span><code className="cell-code">{k}</code></> },
            { header: "Before", render: (k) => fmtNum(v.metrics_before?.[k]), numeric: true },
            { header: "After", render: (k) => fmtNum(v.metrics_after?.[k]), numeric: true },
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
  return <>{d > 0 ? "▲ +" : "▼ "}{fmtNum(Math.round(d * 100) / 100)}</>;
}

function fmtInvariant(r: unknown) {
  if (r == null || typeof r !== "object") return fmtValue(r);
  const { passed, violations, diff } = r as { passed?: boolean; violations?: number | null; diff?: string | null };
  return `${passed ? "holds" : "violated"} · ${violations ?? "?"} violation${violations === 1 ? "" : "s"} · difference ${diff != null && !Number.isNaN(Number(diff)) ? fmtNum(Number(diff)) : diff ?? "?"}`;
}

/** Structured stage details as readable key/value pairs (collapsed), with the raw JSON one click away. */
function StepDetail({ detail }: { detail: unknown }) {
  if (detail == null) return null;
  if (typeof detail !== "object") return <Text size="sm" mt={4} className="detail">{String(detail)}</Text>;
  const entries = Object.entries(detail as Record<string, unknown>);
  return (
    <Accordion variant="subtle" chevronPosition="left" className="step-detail" mt={4} styles={{ control: { paddingInline: 4 }, label: { paddingBlock: 6 }, content: { paddingInline: 4 } }}>
      <Accordion.Item value="d">
        <Accordion.Control>Details ({entries.length} {entries.length === 1 ? "item" : "items"})</Accordion.Control>
        <Accordion.Panel>
          <dl className="kv kv-compact">
            {entries.map(([k, v]) => (
              <div key={k} className="contents">
                <dt>{humanizeName(k)}</dt>
                <dd>{fmtDetailValue(v)}</dd>
              </div>
            ))}
          </dl>
          <details className="raw-json">
            <summary>Raw JSON</summary>
            <Code block tabIndex={0} aria-label="Raw stage detail">{JSON.stringify(detail, null, 2)}</Code>
          </details>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}

function fmtDetailValue(v: unknown) {
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "none";
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("src" in o && "copy" in o) return <>{o.src === o.copy ? "matches" : "DIFFERS"} — source {String(o.src)}, copy {String(o.copy)}</>;
    return Object.entries(o).map(([k, x]) => `${k}: ${typeof x === "object" ? JSON.stringify(x) : String(x)}`).join(" · ");
  }
  return fmtValue(v);
}

function humanizeName(k: string) {
  const t = k.replace(/[_.]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function fmtMs(ms: number) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Elapsed time since `from`, ticking every second while `to` is null. */
function useElapsed(from: string, to: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (to) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [to]);
  const s = Math.max(0, Math.round(((to ? Date.parse(to) : now) - Date.parse(from)) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** Expected refusals read as a plain sentence; the raw driver message stays one click away. */
function IsolationDetail({ text, passed }: { text: string; passed: boolean }) {
  const refused = /permission denied|does not have CONNECT|password authentication failed|connection.*failed/i.test(text);
  if (!refused) return <Text size="sm" className="detail">{text}</Text>;
  return (
    <details className="raw-json">
      <summary>{passed ? "Connection refused — as expected" : "Connection refused"}</summary>
      <Text size="sm" className="detail">{text}</Text>
    </details>
  );
}

const METRIC_LABEL: Record<string, string> = {
  fct_rows: "Rows in fct_payments",
  fct_distinct_payment_ids: "Distinct payment ids in fct_payments",
  report_days: "Days in the report",
  report_amount: "Report total amount",
  report_payments: "Payments in the report",
};

function fmtNum(v: unknown) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  return Number.isNaN(n) ? fmtValue(v) : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
