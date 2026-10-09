import { useState } from "react";
import { useApi } from "../api";
import { Card, EmptyState, fmtTime, LoadView, StatusPill } from "../components/ui";
import type { PipelineHealth } from "../types";

export function Health() {
  const [k, setK] = useState(0);
  const load = useApi<PipelineHealth[]>("/pipelines/health", k);
  return (
    <>
      <h1>Pipeline health</h1>
      <LoadView load={load} onRetry={() => setK(k + 1)}>
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
          <Card key={p.pipeline} title={p.pipeline} actions={<StatusPill status={worst} label={`checks ${worst}`} />}>
            <dl className="kv">
              <dt>Last run</dt>
              <dd>
                <StatusPill status={p.last_run.status === "succeeded" ? "pass" : p.last_run.status === "failed" ? "fail" : "unknown"} label={p.last_run.status} />
              </dd>
              <dt>Finished</dt>
              <dd>{fmtTime(p.last_run.finished_at)}</dd>
              <dt>Checks</dt>
              <dd>
                {p.checks.pass} pass · {p.checks.warn} warn · {p.checks.fail} fail · {p.checks.error} error
              </dd>
              <dt>Freshness</dt>
              <dd><StatusPill status={p.freshness} /></dd>
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
