import { Alert, Text, Textarea } from "@mantine/core";
import { AccessDenied, ActionButton, Card, EmbeddedContext, EmptyState, EpistemicTag, ErrorState, EvidenceRef, Loading, ModeBanner, NotFound, PageTitle, Status, StatusPill, Tabs } from "../components/ui";
import type { Entity } from "../status";
import { fxEval, fxHealth, fxIncident, fxInvestigation, fxValidation } from "../fixtures";
import { EvalView } from "./Evaluations";
import { HealthCards } from "./Health";
import { IncidentBody, IncidentTable } from "./Incidents";
import { InvestigationView } from "./Investigation";
import { ValidationView } from "./Validation";

const SWATCHES = ["bg", "surface", "surface-2", "text", "text-muted", "border-strong", "focus", "pass-fg", "warn-fg", "fail-fg", "info-fg", "unknown-fg", "fact-fg", "hypothesis-fg", "recommendation-fg", "verified-fg"];

const failedValidation = {
  ...fxValidation,
  id: "val_fx2",
  status: "failed",
  steps: fxValidation.steps.map((s) => (s.name === "invariants" ? { ...s, status: "fail" as const, detail: "collections_match_control_totals violated" } : s)),
  invariants: [{ name: "collections_match_control_totals", before: "1 day differs", after: "1 day differs", passed: false }],
};

const ENTITIES: [Entity, string[]][] = [
  ["incident", ["open", "investigating", "awaiting_review", "resolved", "dismissed"]],
  ["investigation", ["queued", "running", "awaiting_review", "completed", "failed", "cancelled"]],
  ["proposal", ["proposed", "validating", "validated", "validation_failed", "approved", "rejected"]],
  ["validation", ["queued", "running", "passed", "failed", "error"]],
  ["check", ["pass", "warn", "fail", "error", "skipped"]],
  ["severity", ["high", "medium", "low"]],
  ["outcome", ["diagnosed", "abstained", "no_fault_found"]],
  ["hypothesis", ["supported", "refuted", "inconclusive"]],
  ["access", ["public", "internal", "restricted"]],
  ["freshness", ["pass", "warn", "fail", "unknown"]],
  ["decision", ["approve", "reject"]],
];
const never = () => new Promise<void>(() => undefined); // keeps the busy state visible
const fails = async () => { throw new Error("fixture"); };

export function Gallery() {
  return (
    <>
      <PageTitle>Design system</PageTitle>
      <Alert color="blue" variant="light" radius="lg" mb="lg" role="note" title="Fixtures">
        Every example on this page uses hand-written sample data from <code>src/fixtures.ts</code>, not pipeline output. Use the theme switch in the top bar to check light and dark themes.
      </Alert>

      <Card title="Tokens">
        <ul className="grid" style={{ listStyle: "none", padding: 0, gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "var(--sp-3)" }}>
          {SWATCHES.map((s) => (
            <li key={s} className="row" style={{ flexWrap: "nowrap" }}>
              <span aria-hidden="true" style={{ flex: "none", width: 28, height: 28, borderRadius: 4, background: `var(--${s})`, border: "1px solid var(--border-strong)" }} />
              <code>--{s}</code>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Status dictionary (label + icon + tone, per entity)">
        <dl className="kv status-dict">
          {ENTITIES.map(([entity, values]) => (
            <div key={entity} className="contents">
              <dt>{entity}</dt>
              <dd className="row">{values.map((v) => <Status key={v} entity={entity} value={v} />)}</dd>
            </div>
          ))}
        </dl>
        <p className="muted">Generic tones (counts, tool rows): {["pass", "warn", "fail", "error", "skipped", "unknown", "info"].map((s) => <StatusPill key={s} status={s} />)}</p>
      </Card>

      <Card title="Buttons and actions">
        <div className="row gallery-actions">
          <ActionButton label="Primary action" busyLabel="Working…" variant="primary" onAction={async () => undefined} />
          <ActionButton label="Secondary action" busyLabel="Working…" onAction={async () => undefined} />
          <ActionButton label="Destructive action" busyLabel="Working…" variant="danger" confirm={{ prompt: "This cannot be undone. Continue?", confirmLabel: "Yes, continue" }} onAction={async () => undefined} />
          <ActionButton label="Not allowed for your role" busyLabel="" disabledReason="Requires the investigator role" onAction={async () => undefined} />
          <ActionButton label="Click to see busy state" busyLabel="Working…" onAction={never} />
          <ActionButton label="Click to see an error" busyLabel="Working…" onAction={fails} />
        </div>
      </Card>

      <Card title="Form field with validation">
        {/* the same component and props as the production review note */}
        <Textarea
          label="Review note"
          description="Required to reject; recommended to approve. Saved with your decision."
          autosize
          minRows={3}
          defaultValue=""
          error="Write a note explaining why you reject the diagnosis."
        />
      </Card>

      <Card title="Epistemic tags (label + icon + border shape)">
        <div className="row">
          <EpistemicTag kind="fact" />
          <EpistemicTag kind="hypothesis" />
          <EpistemicTag kind="recommendation" />
          <EpistemicTag kind="verified" />
        </div>
      </Card>

      <Card title="Evidence references">
        <div className="row">
          <EvidenceRef id="ev_fx_test" /> <EvidenceRef id="ev_does_not_exist" exists={false} />
        </div>
      </Card>

      <Card title="Mode banner">
        <ModeBanner mode="fake" costStatus="unknown" />
        <ModeBanner mode="live" costStatus="estimated" />
      </Card>

      <Card title="States">
        <div className="grid">
          <Loading />
          <EmptyState title="No incidents" hint="Deterministic checks found nothing." />
          <EmbeddedContext.Provider value={true}><ErrorState message="Network error (fixture)" onRetry={() => undefined} /></EmbeddedContext.Provider>
          <AccessDenied needed="approver" />
          <NotFound what="investigation" id="inv_example" />
        </div>
      </Card>

      <Card title="Restricted evidence (viewer)">
        <Text size="sm" c="dimmed" mb="sm">What a viewer sees inside an evidence item whose content is restricted; metadata stays visible.</Text>
        <Status entity="access" value="restricted" />
        <div style={{ marginTop: "var(--sp-2)" }}><AccessDenied message="Content is restricted for your role." needed="investigator" /></div>
      </Card>

      <Card title="Tabs">
        <Tabs
          label="Example tabs"
          tabs={[
            { id: "a", label: "First", content: <p>Arrow keys move between tabs; Home/End jump.</p> },
            { id: "b", label: "Second", content: <p>Second panel.</p> },
          ]}
        />
      </Card>

      <h2 style={{ margin: "var(--sp-8) 0 var(--sp-2)" }}>Screens with fixture data</h2>
      <p className="muted">These are non-interactive previews (sample ids lead nowhere), so they are inert: not focusable and hidden from assistive technology.</p>
      <EmbeddedContext.Provider value={true}>
      <div inert className="screen-previews">
      <Card title="1 · Pipeline health">
        <HealthCards rows={fxHealth} />
      </Card>
      <Card title="2 · Incident list">
        <IncidentTable rows={[fxIncident.incident]} />
      </Card>
      <Card title="3 · Incident detail & timeline">
        <IncidentBody d={fxIncident} />
      </Card>
      <Card title="4 · Hypotheses & evidence">
        <InvestigationView inv={fxInvestigation} />
      </Card>
      <Card title="5 · Recovery & comparison (passed)">
        <ValidationView v={fxValidation} />
      </Card>
      <Card title="5b · Recovery & comparison (invariant violated)">
        <ValidationView v={failedValidation} />
      </Card>
      <Card title="6 · Evaluation results">
        <EvalView runs={fxEval} />
      </Card>
      <Card title="7 · Investigation queued">
        <InvestigationView inv={{ ...fxInvestigation, id: "inv_fx_queued", status: "queued", outcome: null, diagnosis: null, evidence: [], tool_calls: [], proposals: [], review: null }} />
      </Card>
      <Card title="8 · Investigation cancelled">
        <InvestigationView inv={{ ...fxInvestigation, id: "inv_fx_cancelled", status: "cancelled", outcome: null, diagnosis: null, evidence: [], tool_calls: [], proposals: [], review: null, last_status_change: { at: "2026-10-09T12:00:00Z", actor: "dev:investigator", from_status: "running", to_status: "cancelled" } }} />
      </Card>
      </div>
      </EmbeddedContext.Provider>
    </>
  );
}
