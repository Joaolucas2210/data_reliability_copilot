import { Alert, Anchor, Button, Group, Paper, SimpleGrid, Text, Tooltip } from "@mantine/core";
import { IconAlertTriangle, IconArrowRight, IconRefresh } from "@tabler/icons-react";
import { useApi } from "../api";
import { Card, EmptyState, fmtClock, fmtTime, LoadView, PageTitle, Status, StatusPill } from "../components/ui";
import type { PipelineHealth } from "../types";

export function Health() {
  const [load, reload] = useApi<PipelineHealth[]>("/pipelines/health", { pollWhile: () => true, intervalMs: 10000 });
  return (
    <>
      <Group justify="space-between" align="flex-start" mb="md">
        <div><PageTitle>Pipeline health</PageTitle><Text c="dimmed">Follow the data, check the results, and decide what needs investigation.</Text></div>
        <Button variant="default" leftSection={<IconRefresh size={16} />} onClick={reload} loading={load.state === "ok" && load.refreshing}>Refresh health</Button>
      </Group>
      <Group justify="space-between" mb="lg">
        <Text size="xs" c="dimmed">Updates every 10 seconds{load.state === "ok" && ` · last checked ${fmtClock(load.updatedAt)}`}</Text>
        <Button component="a" href="#/pipeline-runs" variant="light" size="xs" rightSection={<IconArrowRight size={14} />}>View execution history</Button>
      </Group>
      <LoadView load={load} onRetry={reload}>
        {(rows) =>
          rows.length ? <HealthCards rows={rows} /> : <EmptyState title="No pipeline runs yet" hint={<>Run <code>make demo</code> to execute the first pipeline.</>} />
        }
      </LoadView>
      <Card title="Where the data goes">
        <Text size="sm" c="dimmed" mb="md">The pipeline loads payments, builds the report, then evaluates its quality. This diagram explains the data path; recorded execution results are available in each run.</Text>
        <ol className="data-flow">
          {[
            ["Receive", "raw.payments", "Payment records as delivered, including duplicate deliveries."],
            ["Prepare", "staging.stg_payments", "Standardize fields and types without silently removing duplicates."],
            ["Connect", "marts.fct_payments", "Join payments to installments and contracts."],
            ["Report", "marts.rpt_daily_collections", "Aggregate amounts and counts by business date."],
          ].map(([title, dataset, hint], index) => (
            <li key={dataset}><span className="flow-number" aria-hidden="true">{index + 1}</span><Text fw={600} mb={4}>{title}</Text><code>{dataset}</code><Text size="sm" c="dimmed" mt="xs">{hint}</Text></li>
          ))}
        </ol>
        <Text size="sm" mt="md">Failed checks create incidents. An investigator requests an investigation; the worker gathers evidence. Recovery is tested in a separate sandbox before a human decision.</Text>
        <Anchor href="#/help" size="sm">Understand the checks and investigation terms</Anchor>
      </Card>
    </>
  );
}

// check result tiles: label + count on the status tone (never colour alone); the meter is a decorative summary of the same numbers
const CHECKS = [
  ["pass", "Passed", "pass"],
  ["warn", "Warnings", "warn"],
  ["fail", "Failed", "fail"],
  ["error", "Errored", "fail"],
  ["skipped", "Skipped", "unknown"],
] as const;

export function HealthCards({ rows }: { rows: PipelineHealth[] }) {
  return (
    <SimpleGrid cols={{ base: 1, lg: rows.length > 1 ? 2 : 1 }} spacing="lg">
      {rows.map((p) => {
        const c = p.checks;
        const total = c.pass + c.warn + c.fail + c.error + c.skipped;
        const bad = c.fail + c.error;
        const worst = bad ? "fail" : c.warn || c.skipped ? "warn" : total ? "pass" : "unknown";
        return (
          <Card key={p.pipeline} title={p.pipeline} actions={<StatusPill status={worst} label={total ? `Checks ${worst === "pass" ? "passed" : worst === "warn" ? "need attention" : "failed"}` : "Quality not evaluated"} />}>
            <Group justify="space-between" mb="md">
              <Anchor href={`#/pipeline-runs/${p.last_run.id}`} size="sm">Open latest execution</Anchor>
              <Text size="xs" c="dimmed">Execution and data quality are separate results.</Text>
            </Group>
            {p.last_run.status === "succeeded" && bad > 0 && (
              <Alert color="yellow" variant="light" radius="md" mb="md" role="note" icon={<IconAlertTriangle size={20} />} title={`The run succeeded, but ${bad} quality check${bad === 1 ? "" : "s"} failed`}>
                The report it produced may be wrong. <Anchor href="#/incidents?status=unresolved">Review unresolved incidents</Anchor>.
              </Alert>
            )}
            <Text size="sm" fw={600} mb={6}>Quality checks on the last run ({total})</Text>
            <SimpleGrid cols={{ base: 2, sm: 5 }} spacing="xs" mb="xs">
              {CHECKS.map(([k, label, tone]) => (
                <Paper key={k} radius="md" p="sm" className={`stat-tile ${c[k] && tone !== "pass" ? `tone-${tone}` : ""}`}>
                  <Text size="xs" fw={600} tt="uppercase">{label}</Text>
                  <Text size="xl" fw={700} lh={1.2}>{c[k]}</Text>
                </Paper>
              ))}
            </SimpleGrid>
            {total > 0 && (
              <div className="meter" aria-hidden="true">
                {CHECKS.filter(([k]) => c[k] > 0).map(([k, label, tone]) => (
                  <Tooltip key={k} label={`${label}: ${c[k]} of ${total}`} withArrow>
                    <span className={`meter-seg seg-${tone}`} style={{ flexGrow: c[k] }} />
                  </Tooltip>
                ))}
              </div>
            )}
            <dl className="kv" style={{ marginTop: "var(--mantine-spacing-md)" }}>
              <dt>Last run</dt>
              <dd><Group gap="xs"><Status entity="run" value={p.last_run.status} /><Text span size="sm" c="dimmed">{p.last_run.finished_at ? `finished ${fmtTime(p.last_run.finished_at)}` : `started ${fmtTime(p.last_run.started_at)}`}</Text></Group></dd>
              <dt>Freshness</dt>
              <dd><Status entity="freshness" value={p.freshness} /></dd>
              <dt>Unresolved incidents</dt>
              <dd>{p.open_incidents ? <Anchor href="#/incidents?status=unresolved">{p.open_incidents} unresolved</Anchor> : "none"}</dd>
              <dt>dbt version</dt>
              <dd>{p.last_run.dbt_version ?? "—"}</dd>
            </dl>
          </Card>
        );
      })}
    </SimpleGrid>
  );
}
