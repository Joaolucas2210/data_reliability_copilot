import { Component, useEffect, useId, useRef, useState, type ErrorInfo, type KeyboardEvent, type ReactNode } from "react";
import { errorMessage, type Load } from "../api";
import { statusDef, type Entity } from "../status";
import type { Status as LegacyStatus } from "../types";

// ---------- status & epistemic tags (icon + text, never color alone) ----------

/** Entity-aware status pill: label, tone and icon come from status.ts so every screen agrees. */
export function Status({ entity, value, prefix }: { entity: Entity; value: string | null | undefined; prefix?: string }) {
  const [label, tone, icon] = statusDef(entity, value);
  return (
    <span className={`pill tone-${tone}`}>
      <span aria-hidden="true" className="pill-icon">{icon}</span>
      {prefix ? `${prefix} ${label.toLowerCase()}` : label}
    </span>
  );
}

const STATUS_ICON: Record<LegacyStatus, string> = { pass: "✓", warn: "▲", fail: "✕", error: "!", skipped: "–", unknown: "?", info: "i" };
const STATUS_TONE: Record<LegacyStatus, string> = { pass: "pass", warn: "warn", fail: "fail", error: "fail", skipped: "unknown", unknown: "unknown", info: "info" };

/** Generic tone pill (gallery / counts). Prefer <Status entity=… /> for domain statuses. */
export function StatusPill({ status, label }: { status: LegacyStatus | string; label?: string }) {
  const s = (status in STATUS_ICON ? status : "unknown") as LegacyStatus;
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

/** Page heading that receives focus on SPA navigation (App focuses `main h1`). */
export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 tabIndex={-1}>{children}</h1>;
}

export function Breadcrumbs({ items }: { items: { href?: string; label: ReactNode }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="crumbs">
      <ol>
        {items.map((it, i) => (
          <li key={i}>{it.href ? <a href={it.href}>{it.label}</a> : <span aria-current="page">{it.label}</span>}</li>
        ))}
      </ol>
    </nav>
  );
}

// ---------- actions ----------

/**
 * Button for a server action: one request at a time (disabled + busy label while in flight), optional two-step
 * confirmation, visible reason when the user's role cannot act, and the error shown right next to the control.
 */
export function ActionButton({
  label, busyLabel, onAction, variant = "secondary", disabledReason, confirm, describedBy, precheck,
}: {
  label: string;
  busyLabel: string;
  onAction: () => Promise<void>;
  variant?: "primary" | "secondary" | "danger";
  disabledReason?: string;
  confirm?: { prompt: ReactNode; confirmLabel: string };
  describedBy?: string;
  /** runs before confirming/sending; return false to stop (e.g. inline form validation) */
  precheck?: () => boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasonId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);

  useEffect(() => { if (confirming) confirmRef.current?.focus(); }, [confirming]);

  const run = async () => {
    if (inFlight.current) return; // guards double-clicks even before React re-renders
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await onAction();
      setConfirming(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const cls = `btn${variant === "primary" ? " btn-primary" : variant === "danger" ? " btn-danger" : ""}`;
  if (disabledReason)
    return (
      <span className="action">
        <button type="button" className={cls} aria-disabled="true" aria-describedby={reasonId} onClick={(e) => e.preventDefault()}>{label}</button>
        <span id={reasonId} className="action-note"><span aria-hidden="true">⊘ </span>{disabledReason}</span>
      </span>
    );

  return (
    <span className="action">
      {confirming && confirm ? (
        <span className="confirm" role="group" aria-label={`Confirm: ${label}`}>
          <span className="confirm-prompt">{confirm.prompt}</span>
          <span className="row">
            <button ref={confirmRef} type="button" className={cls} disabled={busy} aria-busy={busy} onClick={run}>
              {busy ? <><span className="spinner spinner-sm" aria-hidden="true" /> {busyLabel}</> : confirm.confirmLabel}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => { setConfirming(false); setTimeout(() => mainRef.current?.focus()); }}>
              Go back
            </button>
          </span>
        </span>
      ) : (
        <button
          ref={mainRef}
          type="button"
          className={cls}
          disabled={busy}
          aria-busy={busy}
          aria-describedby={describedBy}
          onClick={() => {
            if (precheck && !precheck()) return;
            if (confirm) setConfirming(true);
            else void run();
          }}
        >
          {busy ? <><span className="spinner spinner-sm" aria-hidden="true" /> {busyLabel}</> : label}
        </button>
      )}
      {error && <span role="alert" className="action-error"><span aria-hidden="true">✕ </span>{error}</span>}
    </span>
  );
}

// ---------- data ----------

export interface Column<T> {
  header: string;
  render: (row: T) => ReactNode;
  numeric?: boolean;
}

/** Table; under 600 px rows stack as label/value pairs (ARIA roles keep table semantics when CSS changes display). */
export function DataTable<T>({ caption, columns, rows, rowKey, empty }: { caption: string; columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; empty?: ReactNode }) {
  if (!rows.length) return <>{empty ?? <EmptyState title="Nothing to show" />}</>;
  return (
    // focusable scroll region so keyboard users can scroll wide tables
    <div className="table-wrap" role="region" aria-label={caption} tabIndex={0}>
      <table role="table" className="stack-sm">
        <caption>{caption}</caption>
        <thead role="rowgroup">
          <tr role="row">{columns.map((c) => <th key={c.header} role="columnheader" scope="col" className={c.numeric ? "num" : undefined}>{c.header}</th>)}</tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((r) => (
            <tr key={rowKey(r)} role="row">
              {columns.map((c) => <td key={c.header} role="cell" data-label={c.header} className={c.numeric ? "num" : undefined}>{c.render(r)}</td>)}
            </tr>
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

export function NotFound({ what, id, back }: { what: string; id?: string; back?: { href: string; label: string } }) {
  return (
    <div className="state">
      <p className="state-title">No {what} {id ? <>with id <code>{id}</code></> : "here"}</p>
      <p className="muted">It may have been removed, or the link is wrong.</p>
      <p className="row">
        {back && <a href={back.href}>{back.label}</a>}
        <a href="#/incidents">All incidents</a>
        <a href="#/">Pipeline health</a>
      </p>
    </div>
  );
}

/** Renders the non-ok states of a Load<T>; calls `children` with data when ok. */
export function LoadView<T>({ load, children, onRetry, notFound }: { load: Load<T>; children: (d: T) => ReactNode; onRetry?: () => void; notFound?: ReactNode }) {
  switch (load.state) {
    case "loading":
      return <Loading />;
    case "denied":
      return <AccessDenied message={load.message} />;
    case "error":
      return load.status === 404 ? <>{notFound ?? <NotFound what="item" />}</> : <ErrorState message={load.message} onRetry={onRetry} />;
    case "ok":
      return (
        <>
          {load.refreshError && (
            <p className="banner tone-warn" role="status">
              Showing data from {fmtClock(load.updatedAt)}; the latest refresh failed: {load.refreshError}{" "}
              {onRetry && <button type="button" className="btn" onClick={onRetry}>Retry</button>}
            </p>
          )}
          {children(load.data)}
        </>
      );
  }
}

/** Keeps one broken page from blanking the whole app; resets when `resetKey` (the route) changes. */
export class ErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("page crashed", error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <>
        <h1 tabIndex={-1}>This page could not be displayed</h1>
        <div className="state tone-fail" role="alert">
          <p className="state-title"><span aria-hidden="true">✕ </span>Something went wrong while showing this page.</p>
          <p>The rest of the app still works. Reload to try again, or go back.</p>
          <p className="row">
            <button type="button" className="btn btn-primary" onClick={() => location.reload()}>Reload page</button>
            <button type="button" className="btn" onClick={() => history.back()}>Go back</button>
            <a href="#/incidents">All incidents</a>
          </p>
          <details><summary>Technical details</summary><pre tabIndex={0}>{this.state.error.message}</pre></details>
        </div>
      </>
    );
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

export function fmtClock(d: Date) {
  return d.toISOString().slice(11, 19) + " UTC";
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
