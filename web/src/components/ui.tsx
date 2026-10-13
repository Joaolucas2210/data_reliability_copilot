import {
  Alert, Anchor, Breadcrumbs as MBreadcrumbs, Button, Card as MCard, Group, Loader, Paper, Skeleton, Stack, Table, Tabs as MTabs,
  Text, ThemeIcon, Timeline as MTimeline, Title,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import {
  IconAlertTriangle, IconArrowBackUp, IconBan, IconCheck, IconCircleDot, IconFlask, IconInbox, IconLock, IconMapPinOff, IconRefresh,
} from "@tabler/icons-react";
import { Component, useEffect, createContext, useContext, useId, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { errorMessage, type Load } from "../api";
import { statusDef, type Entity } from "../status";
import type { Status as LegacyStatus } from "../types";

// ---------- status & epistemic tags (icon + text, never color alone; tone colours validated AA in tokens.css) ----------

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

/** Generic tone pill (counts, kinds). Prefer <Status entity=… /> for domain statuses. */
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
    <Alert role="note" variant="light" color="yellow" radius="lg" icon={<IconFlask size={20} />} mb="md" className="mode-banner"
      title={mode === "fake" ? "Simulated LLM — deterministic policy, no model" : "Cost is an estimate"}>
      {mode === "fake" && <Text size="sm">Output shows that the pipeline works, not how good a model is. Provider <code>fake</code> in code.</Text>}
      {costStatus && costStatus !== "measured" && (
        <Text size="sm">
          <strong>Cost {costStatus}:</strong> {costStatus === "unknown" ? "no reliable usage/price data — not zero." : "derived from a price table, not billed usage."}
        </Text>
      )}
    </Alert>
  );
}

// ---------- layout ----------

export function Card({ title, children, actions, id }: { title: ReactNode; children: ReactNode; actions?: ReactNode; id?: string }) {
  const hid = useId();
  return (
    <MCard component="section" aria-labelledby={hid} id={id} mb="lg" className="card">
      <Group justify="space-between" align="flex-start" mb="sm" gap="sm" className="card-head">
        <Title order={2} size="h4" id={hid} tabIndex={-1}>{title}</Title>
        {actions}
      </Group>
      {children}
    </MCard>
  );
}

export function SkipLink() {
  return (
    <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>
      Skip to content
    </a>
  );
}

/** Inside the design-system gallery, page views are embedded examples: their titles become h2 (one h1 per page). */
export const EmbeddedContext = createContext(false);

/** Page heading; stays mounted through loading → loaded so focus placed on it is never lost. */
export function PageTitle({ children }: { children: ReactNode }) {
  const embedded = useContext(EmbeddedContext);
  return embedded ? (
    <Title order={2} size="h3" className="embedded-title">{children}</Title>
  ) : (
    <Title order={1} tabIndex={-1} className="page-title">{children}</Title>
  );
}

export function Breadcrumbs({ items }: { items: { href?: string; label: ReactNode }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="crumbs">
      <MBreadcrumbs separator="›" separatorMargin={6}>
        {items.map((it, i) =>
          it.href ? <Anchor key={i} href={it.href} size="sm">{it.label}</Anchor> : <Text key={i} size="sm" c="dimmed" aria-current="page">{it.label}</Text>,
        )}
      </MBreadcrumbs>
    </nav>
  );
}

// ---------- actions ----------

/**
 * Server action button: one request at a time (Mantine loading state), optional confirmation in an accessible modal
 * (focus trap, Escape cancels, focus returns to the button), a visible reason when the role cannot act, the error next
 * to the control, and a success notification.
 */
export function ActionButton({
  label, busyLabel, onAction, variant = "secondary", disabledReason, confirm, describedBy, precheck, successMessage, icon,
}: {
  label: string;
  busyLabel: string;
  onAction: () => Promise<void>;
  variant?: "primary" | "secondary" | "danger";
  disabledReason?: string;
  confirm?: { prompt: ReactNode; confirmLabel: string; title?: string };
  describedBy?: string;
  /** runs before confirming/sending; return false to stop (e.g. inline form validation) */
  precheck?: () => boolean;
  successMessage?: string;
  icon?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasonId = useId();
  const inFlight = useRef(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const run = async () => {
    if (inFlight.current) return; // guards double-clicks even before React re-renders
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await onAction();
      if (successMessage) notifications.show({ color: "teal", icon: <IconCheck size={18} />, title: "Done", message: successMessage, withBorder: true });
    } catch (e) {
      // the page may have moved on (e.g. the state changed under an open confirmation): never fail silently
      if (!mounted.current) notifications.show({ color: "red", icon: <IconAlertTriangle size={18} />, title: `${label} did not complete`, message: errorMessage(e), withBorder: true });
      else {
        setError(errorMessage(e));
        setTimeout(() => btnRef.current?.focus(), 350); // after a confirmation modal returns focus: stay on the control that failed
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const mVariant = variant === "primary" ? "filled" : variant === "danger" ? "light" : "default";
  const color = variant === "danger" ? "red" : undefined;

  if (disabledReason)
    return (
      <Stack gap={4} className="action">
        <Button ref={btnRef} variant={mVariant} color={color} data-disabled aria-disabled="true" aria-describedby={reasonId} onClick={(e) => e.preventDefault()} leftSection={icon}>
          {label}
        </Button>
        <Text id={reasonId} size="sm" c="dimmed" className="action-note"><IconLock size={14} aria-hidden="true" style={{ verticalAlign: "-2px" }} /> {disabledReason}</Text>
      </Stack>
    );

  return (
    <Stack gap={4} className="action">
      <Button
        ref={btnRef}
        variant={mVariant}
        color={color}
        loading={busy}
        loaderProps={{ type: "dots" }}
        aria-describedby={describedBy}
        leftSection={icon}
        onClick={() => {
          if (precheck && !precheck()) return;
          if (!confirm) return void run();
          modals.openConfirmModal({
            title: confirm.title ?? label,
            children: <Text size="sm">{confirm.prompt}</Text>,
            labels: { confirm: confirm.confirmLabel, cancel: "Go back" },
            confirmProps: { color: variant === "danger" ? "red" : undefined },
            cancelProps: { "data-autofocus": true }, // irreversible actions: Enter on open must not commit
            onConfirm: () => void run(),
          });
        }}
      >
        {busy ? busyLabel : label}
      </Button>
      {error && (
        <Text role="alert" size="sm" className="action-error">
          <IconAlertTriangle size={14} aria-hidden="true" style={{ verticalAlign: "-2px" }} /> {error}
        </Text>
      )}
    </Stack>
  );
}

// ---------- data ----------

export interface Column<T> {
  header: string;
  render: (row: T) => ReactNode;
  numeric?: boolean;
}

/** Table; below 900 px rows stack as label/value pairs (ARIA roles keep table semantics when CSS changes display). */
export function DataTable<T>({ caption, columns, rows, rowKey, empty }: { caption: string; columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; empty?: ReactNode }) {
  if (!rows.length) return <>{empty ?? <EmptyState title="Nothing to show" />}</>;
  return (
    <div className="table-wrap" role="region" aria-label={caption} tabIndex={0}>
      <Table role="table" className="stack-sm" striped highlightOnHover verticalSpacing="sm" captionSide="top">
        <Table.Caption>{caption}</Table.Caption>
        <Table.Thead role="rowgroup">
          <Table.Tr role="row">{columns.map((c) => <Table.Th key={c.header} role="columnheader" scope="col" className={c.numeric ? "num" : undefined}>{c.header}</Table.Th>)}</Table.Tr>
        </Table.Thead>
        <Table.Tbody role="rowgroup">
          {rows.map((r) => (
            <Table.Tr key={rowKey(r)} role="row">
              {columns.map((c) => <Table.Td key={c.header} role="cell" data-label={c.header} className={c.numeric ? "num" : undefined}>{c.render(r)}</Table.Td>)}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </div>
  );
}

export function Timeline({ items }: { items: { key: string; at: string; title: ReactNode; detail?: ReactNode; icon?: ReactNode }[] }) {
  if (!items.length) return <EmptyState title="No events recorded" />;
  return (
    <MTimeline bulletSize={22} lineWidth={2} className="timeline" active={items.length}>
      {items.map((i) => (
        <MTimeline.Item key={i.key} bullet={i.icon ?? <IconCircleDot size={12} />} title={<span className="timeline-title">{i.title}</span>}>
          <Text component="time" dateTime={i.at} size="xs" c="dimmed" ff="monospace">{fmtTime(i.at)}</Text>
          {i.detail && <Text size="sm" c="dimmed">{i.detail}</Text>}
        </MTimeline.Item>
      ))}
    </MTimeline>
  );
}

/** Citation chip. `exists=false` marks a reference the citation validator could not resolve. */
export function EvidenceRef({ id, exists = true, kind }: { id: string; exists?: boolean; kind?: string }) {
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
      aria-label={`Show evidence ${id}${kind ? ` (${kind})` : ""}`}
      onClick={(e) => {
        const origin = e.currentTarget;
        if (!origin.id) origin.id = `cite-${id}-${Math.random().toString(36).slice(2, 8)}`;
        window.dispatchEvent(new CustomEvent("drc:cite", { detail: { target: id, origin: origin.id } }));
      }}
    >
      {kind && <span className="cite-kind">{kind}</span>}
      {id}
    </button>
  );
}

/** Scroll an element into view and focus it: smooth (continuity) unless the user prefers reduced motion. */
export function revealAndFocus(el: HTMLElement | null) {
  if (!el) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  el.focus({ preventScroll: true });
  el.classList.remove("flash");
  void el.offsetWidth; // restart the highlight animation
  el.classList.add("flash");
}

export function BackToClaim({ origin, onDone }: { origin: string; onDone: () => void }) {
  return (
    <Button variant="subtle" size="xs" leftSection={<IconArrowBackUp size={16} />} onClick={() => { revealAndFocus(document.getElementById(origin)); onDone(); }}>
      Back to the claim
    </Button>
  );
}

// ---------- states ----------

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <Group gap="xs" mb="sm"><Loader size="sm" type="dots" /> <Text size="sm" c="dimmed">{label}</Text></Group>
      <Stack gap="sm" aria-hidden="true">
        <Skeleton height={18} width="40%" radius="sm" />
        <Skeleton height={90} radius="md" />
        <Skeleton height={90} radius="md" />
      </Stack>
    </div>
  );
}

export function EmptyState({ title, hint, icon }: { title: string; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <Paper withBorder p="xl" radius="lg" className="state empty-state">
      <Stack align="center" gap={6}>
        <ThemeIcon variant="light" color="gray" size="xl" radius="xl" aria-hidden="true">{icon ?? <IconInbox size={22} />}</ThemeIcon>
        <Text fw={600} className="state-title">{title}</Text>
        {hint && <Text size="sm" c="dimmed" ta="center" component="div">{hint}</Text>}
      </Stack>
    </Paper>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const embedded = useContext(EmbeddedContext); // design-system previews must not announce
  return (
    <Alert role={embedded ? "note" : "alert"} color="red" variant="light" radius="lg" icon={<IconAlertTriangle size={20} />} title="Could not load data" className="state">
      <Text size="sm" mb={onRetry ? "sm" : 0}>{message}</Text>
      {onRetry && <Button variant="default" size="xs" leftSection={<IconRefresh size={14} />} onClick={onRetry}>Retry</Button>}
    </Alert>
  );
}

export function AccessDenied({ message, needed }: { message?: string; needed?: string }) {
  // a static notice rendered with the page, not an event: role=note (alerts would interrupt on every page load)
  return (
    <Alert role="note" color="gray" variant="light" radius="lg" icon={<IconLock size={20} />} title={needed ? `Available to the ${needed} role` : "Not available for your role"} className="state">
      <Text size="sm">{message || "Your role cannot see this resource."}</Text>
    </Alert>
  );
}

export function NotFound({ what, id, back }: { what: string; id?: string; back?: { href: string; label: string } }) {
  return (
    <Paper withBorder p="xl" radius="lg" className="state">
      <Stack align="center" gap={6}>
        <ThemeIcon variant="light" color="gray" size="xl" radius="xl" aria-hidden="true"><IconMapPinOff size={22} /></ThemeIcon>
        <Text fw={600} ta="center">{what === "page" ? <>There is no page at <code>{id}</code></> : <>No {what} {id ? <>with id <code>{id}</code></> : "here"}</>}</Text>
        <Text size="sm" c="dimmed">It may have been removed, or the link is wrong.</Text>
        <Group gap="sm" mt="xs">
          {back && <Button component="a" href={back.href} variant="light" size="xs">{back.label}</Button>}
          <Button component="a" href="#/" variant="default" size="xs">Pipeline health</Button>
        </Group>
      </Stack>
    </Paper>
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
            <Alert role="status" color="yellow" variant="light" radius="lg" mb="md" icon={<IconRefresh size={18} />} title={`Showing data from ${fmtClock(load.updatedAt)}`}>
              <Group gap="sm" justify="space-between">
                <Text size="sm">The latest refresh failed: {load.refreshError}</Text>
                {onRetry && <Button size="xs" variant="default" onClick={onRetry}>Retry</Button>}
              </Group>
            </Alert>
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
        <Title order={1} tabIndex={-1} className="page-title">This page could not be displayed</Title>
        <Alert role="alert" color="red" variant="light" radius="lg" icon={<IconBan size={20} />} title="Something went wrong while showing this page">
          <Text size="sm" mb="sm">The rest of the app still works. Reload to try again, or go back.</Text>
          <Group gap="sm">
            <Button size="xs" onClick={() => location.reload()}>Reload page</Button>
            <Button size="xs" variant="default" onClick={() => history.back()}>Go back</Button>
          </Group>
          <details style={{ marginTop: 12 }}><summary>Technical details</summary><pre tabIndex={0}>{this.state.error.message}</pre></details>
        </Alert>
      </>
    );
  }
}

// ---------- tabs (Mantine: WAI-ARIA tabs with arrow keys / Home / End) ----------

export function Tabs({ label, tabs }: { label: string; tabs: { id: string; label: string; content: ReactNode }[] }) {
  return (
    <MTabs defaultValue={tabs[0]?.id} keepMounted={false} className="tabs" mb="lg">
      <MTabs.List aria-label={label} className="tab-list">
        {tabs.map((t) => <MTabs.Tab key={t.id} value={t.id}>{t.label}</MTabs.Tab>)}
      </MTabs.List>
      {tabs.map((t) => (
        <MTabs.Panel key={t.id} value={t.id} pt="md" tabIndex={0}>{t.content}</MTabs.Panel>
      ))}
    </MTabs>
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
