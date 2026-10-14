import { Alert, Anchor, Button, Group, Paper, SegmentedControl, SimpleGrid, Text } from "@mantine/core";
import { IconArrowRight, IconRefresh } from "@tabler/icons-react";
import { useState } from "react";
import { useApi } from "../api";
import { Breadcrumbs, Card, DataTable, EmptyState, fmtClock, fmtTime, LoadView, NotFound, PageTitle, Status, StatusPill } from "../components/ui";
import { checkLabel, checkResult } from "../labels";
import type { PipelineRunDetail, PipelineRunSummary } from "../types";

export function PipelineRuns() {
  const [load, reload] = useApi<PipelineRunSummary[]>("/pipeline-runs", { pollWhile: () => true, intervalMs: 10000 });
  return (
    <>
      <Group justify="space-between" align="flex-start" mb="md">
        <div><PageTitle>Pipeline runs</PageTitle><Text c="dimmed">Execution history and quality results. A completed transformation can still produce an incorrect report.</Text></div>
        <Button variant="default" leftSection={<IconRefresh size={16} />} onClick={reload} loading={load.state === "ok" && load.refreshing}>Refresh runs</Button>
      </Group>
      <LoadView load={load} onRetry={reload}>
        {(runs) => (
          <Card title="Recent executions">
            <RunTable runs={runs} />
            <Text size="xs" c="dimmed" mt="sm">Latest 20 runs · updates every 10 seconds{load.state === "ok" && ` · last checked ${fmtClock(load.updatedAt)}`}</Text>
          </Card>
        )}
      </LoadView>
    </>
  );
}

export function RunTable({ runs }: { runs: PipelineRunSummary[] }) {
  return (
    <DataTable caption="Pipeline execution history" rows={runs} rowKey={(r) => r.id}
      empty={<EmptyState title="No pipeline runs yet" hint="Executed pipelines appear here with their checks and related incidents." />}
      columns={[
        { header: "Run", render: (r) => <><Anchor href={`#/pipeline-runs/${r.id}`} className="row-title">{r.pipeline}</Anchor><code className="cell-code">{r.id}</code></> },
        { header: "Execution", render: (r) => <Status entity="run" value={r.status} /> },
        { header: "Quality", render: (r) => <StatusPill status={r.failed_checks ? "fail" : r.total_checks ? "info" : "unknown"} label={r.failed_checks ? `${r.failed_checks} failed` : r.total_checks ? `${r.passed_checks} of ${r.total_checks} passed` : "Not evaluated"} /> },
        { header: "Started", render: (r) => fmtTime(r.started_at) },
        { header: "Finished", render: (r) => fmtTime(r.finished_at) },
      ]}
    />
  );
}

export function PipelineRunPage({ id }: { id: string }) {
  const [checkView, setCheckView] = useState("attention");
  const [load, reload] = useApi<PipelineRunDetail>(`/pipeline-runs/${id}`, {
    pollWhile: (d) => d.run.status === "running" || !d.checks.length, intervalMs: 10000,
  });
  return (
    <>
      <Breadcrumbs items={[{ href: "#/pipeline-runs", label: "Pipeline runs" }, { label: "Run details" }]} />
      <PageTitle>Pipeline run <code>{id}</code></PageTitle>
      <LoadView load={load} onRetry={reload} notFound={<NotFound what="pipeline run" id={id} back={{ href: "#/pipeline-runs", label: "Back to runs" }} />}>
        {(d) => (
          <>
            <Card title={d.run.pipeline} actions={<Status entity="run" value={d.run.status} />}>
              <Text c="dimmed" mb="md">Recorded results for this execution. Investigation and recovery are started from its incident.</Text>
              <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm" mb="md">
                {([ ["Transformations", d.execution?.rc_run], ["Data tests", d.execution?.rc_test], ["Source freshness", d.execution?.rc_freshness] ] as const).map(([label, code]) => (
                  <Paper key={label} withBorder p="md" radius="md">
                    <Text fw={600} mb="xs">{label}</Text>
                    <StatusPill status={code == null ? "unknown" : code === 0 ? "pass" : "fail"} label={code == null ? "No result recorded" : code === 0 ? "Completed successfully" : `Exit code ${code}`} />
                  </Paper>
                ))}
              </SimpleGrid>
              <dl className="kv">
                <dt>Started</dt><dd>{fmtTime(d.run.started_at)}</dd>
                <dt>Finished</dt><dd>{fmtTime(d.run.finished_at)}</dd>
                <dt>dbt version</dt><dd>{d.run.dbt_version ?? "Not recorded"}</dd>
                <dt>Snapshot</dt><dd>{d.run.snapshot_schema ? <code>{d.run.snapshot_schema}</code> : "No snapshot recorded"}</dd>
              </dl>
            </Card>
            <Card title="Quality checks" actions={<SegmentedControl size="xs" value={checkView} onChange={setCheckView} aria-label="Show quality checks" data={[{ value: "attention", label: "Needs attention" }, { value: "all", label: "All checks" }]} />}>
              <Text size="sm" c="dimmed" mb="md">{d.checks.filter((c) => c.status !== "pass").length} of {d.checks.length} checks need attention. Failed, errored, warning and skipped checks are shown first.</Text>
              {!d.checks.length ? <Alert color="gray" title="Quality has not been evaluated">No checks are recorded yet. This is not evidence that the data is correct.</Alert> : (
                <DataTable caption="Checks for this execution" rows={d.checks.filter((c) => checkView === "all" || c.status !== "pass")} rowKey={(c) => c.id}
                  empty={<EmptyState title="No checks need attention" hint="Select All checks to inspect the recorded passes." />} columns={[
                  { header: "Check", render: (c) => <><span className="cell-title">{checkLabel(c.check_name)}</span><code className="cell-code">{c.check_name}</code></> },
                  { header: "Result", render: (c) => <Status entity="check" value={c.status} /> },
                  { header: "Dataset", render: (c) => c.dataset_id ?? "—" },
                  { header: "Finding", render: (c) => checkResult(c) },
                ]} />
              )}
            </Card>
            <Card title="Related incidents">
              {d.incidents.length ? d.incidents.map((incident) => (
                <Paper key={incident.id} withBorder p="md" radius="md" mb="sm">
                  <Group justify="space-between" align="flex-start">
                    <div><Anchor href={`#/incidents/${incident.id}`} fw={600}>{incident.title}</Anchor><code className="cell-code">{incident.id}</code></div>
                    <Status entity="incident" value={incident.status} />
                  </Group>
                  <Button component="a" href={`#/incidents/${incident.id}`} variant="light" size="xs" mt="sm" rightSection={<IconArrowRight size={14} />}>Open incident</Button>
                </Paper>
              )) : <EmptyState title="No incidents linked to this run" hint="Detection is separate from transformation. Check the recorded quality results before drawing a conclusion." />}
            </Card>
          </>
        )}
      </LoadView>
    </>
  );
}
