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

export function HealthCards({ rows }: { rows: PipelineHealth[] }) {
  return (
    <div className="grid">
      {rows.map((p) => {
        const worst = p.checks.fail || p.checks.error ? "fail" : p.checks.warn ? "warn" : "pass";
        return (
          <Card key={p.pipeline} title={p.pipeline} actions={<Status entity="check" value={worst} prefix="Checks" />}>
            <dl className="kv">
              <dt>Last run</dt>
              <dd>
                <Status entity="run" value={p.last_run.status} />
              </dd>
              <dt>Finished</dt>
              <dd>{fmtTime(p.last_run.finished_at)}</dd>
              <dt>Checks</dt>
              <dd>
                {p.checks.pass} pass · {p.checks.warn} warn · {p.checks.fail} fail · {p.checks.error} error
              </dd>
              <dt>Freshness</dt>
              <dd><Status entity="freshness" value={p.freshness} /></dd>
              <dt>Open incidents</dt>
              <dd>{p.open_incidents ? <a href="#/incidents">{p.open_incidents} open</a> : "none"}</dd>
              <dt>dbt</dt>
              <dd className="mono">{p.last_run.dbt_version ?? "—"}</dd>
            </dl>
            {p.last_run.status === "succeeded" && (p.checks.fail > 0 || p.checks.error > 0) && (
              <p className="muted">The run finished successfully, but quality checks failed: report contents may be wrong.</p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
