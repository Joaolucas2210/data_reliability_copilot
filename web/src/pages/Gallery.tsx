import { AccessDenied, Card, EmptyState, EpistemicTag, ErrorState, EvidenceRef, Loading, ModeBanner, StatusPill, Tabs } from "../components/ui";
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

export function Gallery() {
  return (
    <>
      <h1>Component gallery</h1>
      <div className="banner tone-info" role="note">
        <p>
          <strong>Fixtures:</strong> every example on this page uses hand-written sample data from <code>src/fixtures.ts</code>, not pipeline output. Use the theme switch in the top bar to check light and dark themes.
        </p>
      </div>

      <Card title="Tokens">
        <ul className="grid" style={{ listStyle: "none", padding: 0, gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
          {SWATCHES.map((s) => (
            <li key={s} className="row">
              <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 4, background: `var(--${s})`, border: "1px solid var(--border-strong)" }} />
              <code>--{s}</code>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Status pills (icon + text)">
        <div className="row">
          {["pass", "warn", "fail", "error", "skipped", "unknown", "info"].map((s) => <StatusPill key={s} status={s} />)}
        </div>
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
          <ErrorState message="Network error (fixture)" onRetry={() => undefined} />
          <AccessDenied needed="approver" />
        </div>
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

      <h2 style={{ margin: "var(--sp-8) 0 var(--sp-4)" }}>Screens with fixture data</h2>
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
    </>
  );
}
