import { Alert, Anchor, Group, Paper, SimpleGrid, Text, Tooltip } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useApi } from "../api";
import { Card, EmptyState, fmtTime, LoadView, PageTitle, Status } from "../components/ui";
import type { PipelineHealth } from "../types";

export function Health() {
  const [load, reload] = useApi<PipelineHealth[]>("/pipelines/health");
  return (
    <>
      <PageTitle>Pipeline health</PageTitle>
      <LoadView load={load} onRetry={reload}>
        {(rows) =>
          rows.length ? <HealthCards rows={rows} /> : <EmptyState title="No pipeline runs yet" hint={<>Run <code>make demo</code> to execute the first pipeline.</>} />
        }
      </LoadView>
    </>
  );
}

// check result tiles: label + count on the status tone (never colour alone); the meter is a decorative summary of the same numbers
const CHECKS = [
  ["pass", "Passed", "pass"],
  ["warn", "Warnings", "warn"],
  ["fail", "Failed", "fail"],
  ["error", "Errored", "fail"],
] as const;

export function HealthCards({ rows }: { rows: PipelineHealth[] }) {
  return (
    <SimpleGrid cols={{ base: 1, lg: rows.length > 1 ? 2 : 1 }} spacing="lg">
      {rows.map((p) => {
        const c = p.checks;
        const total = c.pass + c.warn + c.fail + c.error;
        const bad = c.fail + c.error;
        const worst = bad ? "fail" : c.warn ? "warn" : "pass";
        return (
          <Card key={p.pipeline} title={p.pipeline} actions={<Status entity="check" value={worst} prefix="Checks" />}>
            {p.last_run.status === "succeeded" && bad > 0 && (
              <Alert color="yellow" variant="light" radius="md" mb="md" role="note" icon={<IconAlertTriangle size={20} />} title={`The run succeeded, but ${bad} quality check${bad === 1 ? "" : "s"} failed`}>
                The report it produced may be wrong. <Anchor href="#/incidents?status=unresolved">Review unresolved incidents</Anchor>.
              </Alert>
            )}
            <Text size="sm" fw={600} mb={6}>Quality checks on the last run ({total})</Text>
            <SimpleGrid cols={{ base: 2, xs: 4 }} spacing="xs" mb="xs">
              {CHECKS.map(([k, label, tone]) => (
                <Paper key={k} radius="md" p="sm" className={`stat-tile ${c[k] ? `tone-${tone}` : ""}`}>
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
              <dd><Group gap="xs"><Status entity="run" value={p.last_run.status} /><Text span size="sm" c="dimmed">finished {fmtTime(p.last_run.finished_at)}</Text></Group></dd>
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
