import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Load } from "../api";
import type { Status } from "../types";

// ---------- status & epistemic tags (icon + text, never color alone) ----------

const STATUS_ICON: Record<Status, string> = { pass: "✓", warn: "▲", fail: "✕", error: "!", skipped: "–", unknown: "?", info: "i" };
const STATUS_TONE: Record<Status, string> = { pass: "pass", warn: "warn", fail: "fail", error: "fail", skipped: "unknown", unknown: "unknown", info: "info" };

export function StatusPill({ status, label }: { status: Status | string; label?: string }) {
  const s = (status in STATUS_ICON ? status : "unknown") as Status;
  return (
    <span className={`pill tone-${STATUS_TONE[s]}`}>
      <span aria-hidden="true" className="pill-icon">{STATUS_ICON[s]}</span>
      {label ?? status}
    </span>
  );
}

export type Epistemic = "fact" | "hypothesis" | "recommendation" | "verified";
const EPI: Record<Epistemic, [string, string]> = {
  fact: ["■", "Fact"],
  hypothesis: ["?", "Hypothesis"],
  recommendation: ["→", "Recommendation"],
  verified: ["✓", "Verified"],
};

export function EpistemicTag({ kind }: { kind: Epistemic }) {
  const [icon, label] = EPI[kind];
  return (
    <span className={`epi epi-${kind}`}>
      <span aria-hidden="true">{icon}</span> {label}
    </span>
  );
}

export function ModeBanner({ mode, costStatus }: { mode?: "fake" | "live"; costStatus?: "measured" | "estimated" | "unknown" }) {
  if (mode !== "fake" && (!costStatus || costStatus === "measured")) return null;
  return (
    <div className="banner tone-warn" role="note">
      {mode === "fake" && (
        <p>
          <strong>FAKE LLM</strong> — deterministic test double. Output shows that the pipeline works, not how good a model is.
        </p>
      )}
      {costStatus && costStatus !== "measured" && (
        <p>
          <strong>Cost {costStatus}</strong> — {costStatus === "unknown" ? "no reliable usage/price data; not zero." : "derived from a price table, not billed usage."}
        </p>
      )}
    </div>
  );
}

// ---------- layout ----------

export function Card({ title, children, actions, id }: { title: ReactNode; children: ReactNode; actions?: ReactNode; id?: string }) {
  const hid = useId();
  return (
    <section className="card" aria-labelledby={hid} id={id}>
      <header className="card-head">
        <h2 id={hid}>{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function SkipLink() {
  return (
    <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>
      Skip to content
    </a>
  );
}

// ---------- data ----------

export interface Column<T> {
  header: string;
  render: (row: T) => ReactNode;
  numeric?: boolean;
}

export function DataTable<T>({ caption, columns, rows, rowKey, empty }: { caption: string; columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; empty?: ReactNode }) {
  if (!rows.length) return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;
  return (
    // focusable scroll region so keyboard users can scroll wide tables
    <div className="table-wrap" role="region" aria-label={caption} tabIndex={0}>
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>{columns.map((c) => <th key={c.header} scope="col" className={c.numeric ? "num" : undefined}>{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)}>{columns.map((c) => <td key={c.header} className={c.numeric ? "num" : undefined}>{c.render(r)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Timeline({ items }: { items: { key: string; at: string; title: ReactNode; detail?: ReactNode }[] }) {
  if (!items.length) return <EmptyState title="No events recorded" />;
  return (
    <ol className="timeline">
      {items.map((i) => (
        <li key={i.key}>
          <time dateTime={i.at}>{fmtTime(i.at)}</time>
          <div>{i.title}</div>
          {i.detail && <div className="muted">{i.detail}</div>}
        </li>
      ))}
    </ol>
  );
}

/** Citation chip. `exists=false` marks a reference the citation validator could not resolve. */
export function EvidenceRef({ id, exists = true }: { id: string; exists?: boolean }) {
  if (!exists)
    return (
      <span className="cite cite-missing">
        <span aria-hidden="true">✕</span> {id} <span className="sr-only">(reference not found)</span>
      </span>
    );
  return (
    <button
      type="button"
      className="cite"
      aria-label={`Show evidence ${id}`}
      onClick={() => {
        const el = document.getElementById(`ev-${id}`);
        el?.scrollIntoView({ block: "center" });
        el?.focus();
      }}
    >
      {id}
    </button>
  );
}

// ---------- states ----------

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" /> {label}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="state">
      <p className="state-title">{title}</p>
      {hint && <p className="muted">{hint}</p>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state tone-fail" role="alert">
      <p className="state-title"><span aria-hidden="true">✕ </span>Could not load data</p>
      <p>{message}</p>
      {onRetry && <button type="button" className="btn" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function AccessDenied({ message, needed }: { message?: string; needed?: string }) {
  return (
    <div className="state tone-unknown" role="alert">
      <p className="state-title"><span aria-hidden="true">⊘ </span>Access denied</p>
      <p>{message || "Your role cannot see this resource."}{needed && <> Required role: <strong>{needed}</strong>.</>}</p>
    </div>
  );
}

/** Renders the non-ok states of a Load<T>; calls `children` with data when ok. */
export function LoadView<T>({ load, children, onRetry }: { load: Load<T>; children: (d: T) => ReactNode; onRetry?: () => void }) {
  switch (load.state) {
    case "loading":
      return <Loading />;
    case "denied":
      return <AccessDenied message={load.message} />;
    case "error":
      return load.status === 404 ? <EmptyState title="Not found" hint={load.message} /> : <ErrorState message={load.message} onRetry={onRetry} />;
    case "ok":
      return <>{children(load.data)}</>;
  }
}

// ---------- tabs (WAI-ARIA tabs pattern, automatic activation, roving tabindex) ----------

export function Tabs({ label, tabs }: { label: string; tabs: { id: string; label: string; content: ReactNode }[] }) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const base = useId();
  const onKey = (e: KeyboardEvent) => {
    const n = tabs.length;
    const next = { ArrowRight: active + 1, ArrowLeft: active - 1 + n, Home: 0, End: n - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const i = next % n;
    setActive(i);
    refs.current[i]?.focus();
  };
  return (
    <div className="tabs">
      <div role="tablist" aria-label={label} onKeyDown={onKey}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => { refs.current[i] = el; }}
            role="tab"
            type="button"
            id={`${base}-t-${t.id}`}
            aria-selected={i === active}
            aria-controls={`${base}-p-${t.id}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t, i) => (
        <div key={t.id} role="tabpanel" id={`${base}-p-${t.id}`} aria-labelledby={`${base}-t-${t.id}`} hidden={i !== active} tabIndex={0}>
          {t.content}
        </div>
      ))}
    </div>
  );
}

// ---------- formatting ----------

export function fmtTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

/** null cost is unknown — never render it as 0. */
export function fmtCost(usd: number | null | undefined, status?: string) {
  if (usd == null) return "unknown";
  return `$${usd.toFixed(4)}${status === "estimated" ? " (estimated)" : ""}`;
}

export function fmtValue(v: unknown) {
  if (v == null) return "—";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}
