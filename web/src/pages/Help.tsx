import { useEffect, type ReactNode } from "react";
import { EpistemicTag, PageTitle, Status } from "../components/ui";

export const TERMS: [string, string, ReactNode][] = [
  ["incident", "Incident", "Opened automatically when a deterministic quality check fails after a pipeline run. Rules decide that something is wrong; the agent never does."],
  ["check", "Quality check", "A deterministic rule: schema contract, data test, freshness, business invariant, anomaly or model run. Each has its own type because they answer different questions."],
  ["invariant", "Business invariant", "A rule the report must satisfy against an independent source, e.g. daily collections must equal the core-banking control totals."],
  ["freshness", "Freshness", "Whether source data arrived recently enough. Late data can make a report wrong even if every other check passes."],
  ["investigation", "Investigation", "A bounded run of the agent over one incident: it collects evidence with read-only tools, tests hypotheses and produces a diagnosis or abstains."],
  ["evidence", "Evidence", "A piece of data collected by a tool (check result, log line, row count, schema, lineage). It is untrusted input and has a stable id you can cite."],
  ["outcome", "Outcome", <>How an investigation ended: <Status entity="outcome" value="diagnosed" /> a cause is supported by evidence; <Status entity="outcome" value="abstained" /> the evidence is not enough to decide; <Status entity="outcome" value="no_fault_found" /> nothing is wrong.</>],
  ["epistemic", "Fact, hypothesis, recommendation, verified", <><EpistemicTag kind="fact" /> observed in evidence and quoted verbatim; <EpistemicTag kind="hypothesis" /> a candidate cause with a status; <EpistemicTag kind="recommendation" /> a proposed next step or recovery; <EpistemicTag kind="verified" /> a result checked deterministically in the sandbox.</>],
  ["citation", "Citation check", "Every fact must cite evidence that exists and quote it word for word. This proves the quote exists, not that the statement follows from it."],
  ["proposal", "Recovery proposal", "A recovery the agent recommends, limited to an allow-listed playbook (for example deduplicating payments). It is never applied to production in this phase."],
  ["sandbox", "Sandbox validation", "The proposal is run on an isolated copy of the incident's data with a separate database and role. Six stages are reported separately; passing them means the playbook fixed that copy, nothing more."],
  ["review", "Human review", "An approver approves or rejects the diagnosis. The decision, reviewer, time and note are recorded and cannot be undone."],
  ["roles", "Roles", "Viewer reads everything except restricted evidence; investigator can also start investigations and sandbox validations; approver can also record review decisions."],
  ["fake", "Fake LLM", "A deterministic test double used when no model is configured. Its results show that the workflow works, not how good a model is."],
];

function showTerm(id: string) {
  const el = document.getElementById(`term-${id}`);
  el?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  el?.focus({ preventScroll: true });
}

export function Help({ term }: { term?: string }) {
  // deep link from search: #/help?term=<id> (after the page-level h1 focus)
  useEffect(() => {
    if (!term) return;
    const t = setTimeout(() => showTerm(term), 50);
    return () => clearTimeout(t);
  }, [term]);
  return (
    <>
      <PageTitle>Help & glossary</PageTitle>
      <p>
        Data Reliability Copilot explains incidents where a pipeline ran but its report may be wrong. The usual path is: open an{" "}
        <a href="#/incidents">incident</a>, read its investigation, check the cited evidence, validate a proposed recovery in the sandbox, then
        record a decision.
      </p>
      <nav aria-label="Glossary terms" className="toc">
        <ul>{TERMS.map(([id, term]) => <li key={id}><a href={`#/help`} onClick={(e) => { e.preventDefault(); showTerm(id); }}>{term}</a></li>)}</ul>
      </nav>
      <dl className="glossary">
        {TERMS.map(([id, term, def]) => (
          <div key={id} className="glossary-item">
            <dt id={`term-${id}`} tabIndex={-1}>{term}</dt>
            <dd>{def}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
