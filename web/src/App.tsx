import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { announce, getRole, setRole, type Role } from "./api";
import { ErrorBoundary, SkipLink } from "./components/ui";
import { Evaluations } from "./pages/Evaluations";
import { Gallery } from "./pages/Gallery";
import { Health } from "./pages/Health";
import { Help } from "./pages/Help";
import { IncidentDetailPage, IncidentList } from "./pages/Incidents";
import { InvestigationPage } from "./pages/Investigation";
import { ValidationPage } from "./pages/Validation";

// ponytail: hash routing with a regex table — add a router lib when routes need loaders/nesting.
const ROUTES: [RegExp, (m: string[], q: URLSearchParams) => ReactNode, string][] = [
  [/^\/$/, () => <Health />, "Pipeline health"],
  [/^\/incidents$/, (_m, q) => <IncidentList initialStatus={q.get("status") ?? ""} />, "Incidents"],
  [/^\/incidents\/([\w-]+)$/, (m) => <IncidentDetailPage id={m[1]} />, "Incident"],
  [/^\/investigations\/([\w-]+)$/, (m) => <InvestigationPage id={m[1]} />, "Investigation"],
  [/^\/validation-runs\/([\w-]+)$/, (m) => <ValidationPage id={m[1]} />, "Recovery validation"],
  [/^\/evaluations$/, () => <Evaluations />, "Evaluation results"],
  [/^\/help$/, () => <Help />, "Help & glossary"],
  [/^\/design-system$/, () => <Gallery />, "Design system"],
  [/^\/gallery$/, () => <Gallery />, "Design system"],
];

const NAV = [
  ["#/", "Pipeline health"],
  ["#/incidents", "Incidents"],
  ["#/evaluations", "Evaluations"],
  ["#/help", "Help & glossary"],
];

type Theme = "system" | "light" | "dark";
const THEME_KEY = "drc.theme";

function useHashPath() {
  const read = () => location.hash.replace(/^#/, "") || "/";
  const [path, setPath] = useState(read);
  useEffect(() => {
    const on = () => setPath(read());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return path;
}

function readTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function App() {
  const full = useHashPath();
  const [pathname, query = ""] = full.split("?");
  const params = new URLSearchParams(query);
  const [role, setRoleState] = useState<Role>(getRole);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const mainRef = useRef<HTMLElement>(null);
  const prevPath = useRef(pathname);

  const match = ROUTES.map(([re, render, title]) => ({ m: pathname.match(re), render, title })).find((r) => r.m);

  // generic title first (layout effect); pages refine it with the entity name in their own effects
  useLayoutEffect(() => {
    document.title = `${match?.title ?? "Page not found"} · Data Reliability Copilot`;
  }, [pathname]); // title depends only on the route

  useEffect(() => {
    // focus the page heading on SPA navigation only — comparing paths (not a first-render flag) keeps this
    // correct under React StrictMode's double effects, so the skip link stays the first Tab stop on load.
    // Query-only changes (e.g. a list filter) are not navigation and keep focus where it is.
    if (prevPath.current === pathname) return;
    prevPath.current = pathname;
    const h1 = mainRef.current?.querySelector<HTMLElement>("h1");
    (h1 ?? mainRef.current)?.focus();
  }, [pathname]);

  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage blocked: theme lasts for this page only */
    }
  }, [theme]);

  const section =
    "#" + (pathname.startsWith("/incidents") || pathname.startsWith("/investigations") || pathname.startsWith("/validation-runs") ? "/incidents" : pathname === "/gallery" ? "/design-system" : pathname);

  return (
    <div className="shell">
      <SkipLink />
      <header className="topbar">
        <span className="brand">Data Reliability Copilot</span>
        <div className="controls">
          <label>
            Theme{" "}
            <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label>
            Role (dev){" "}
            <select
              value={role}
              onChange={(e) => {
                const r = e.target.value as Role;
                setRole(r);
                setRoleState(r); // remounts the page below: data is refetched with the new role, no full reload
                announce(`Role changed to ${r}. The page was refreshed for this role.`);
              }}
            >
              <option value="viewer">viewer</option>
              <option value="investigator">investigator</option>
              <option value="approver">approver</option>
            </select>
          </label>
        </div>
      </header>
      <nav aria-label="Primary" className="primary-nav">
        <ul>
          {NAV.map(([href, label]) => (
            <li key={href}>
              <a href={href} aria-current={section === href ? "page" : undefined}>{label}</a>
            </li>
          ))}
        </ul>
        <p className="nav-foot">
          <a href="#/design-system" aria-current={section === "#/design-system" ? "page" : undefined}>Design system</a>
          <span className="muted"> · for developers</span>
        </p>
      </nav>
      <main id="main" ref={mainRef} tabIndex={-1} aria-label="Content">
        <ErrorBoundary resetKey={pathname}>
          <div key={role} className="route">
            {match ? (
              match.render(match.m!, params)
            ) : (
              <>
                <h1 tabIndex={-1}>Page not found</h1>
                <div className="state">
                  <p className="state-title">There is no page at <code>#{full}</code>.</p>
                  <p className="row"><a href="#/">Pipeline health</a><a href="#/incidents">All incidents</a><a href="#/help">Help & glossary</a></p>
                </div>
              </>
            )}
          </div>
        </ErrorBoundary>
      </main>
      <div id="announcer" className="sr-only" aria-live="polite" aria-atomic="true" />
    </div>
  );
}
