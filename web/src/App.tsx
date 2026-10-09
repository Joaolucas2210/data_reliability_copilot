import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { getRole, setRole, type Role } from "./api";
import { ErrorBoundary, SkipLink } from "./components/ui";
import { Evaluations } from "./pages/Evaluations";
import { Gallery } from "./pages/Gallery";
import { Health } from "./pages/Health";
import { IncidentDetailPage, IncidentList } from "./pages/Incidents";
import { InvestigationPage } from "./pages/Investigation";
import { ValidationPage } from "./pages/Validation";

// ponytail: hash routing with a regex table — add a router lib when routes need loaders/nesting.
const ROUTES: [RegExp, (m: string[]) => ReactNode, string][] = [
  [/^\/$/, () => <Health />, "Pipeline health"],
  [/^\/incidents$/, () => <IncidentList />, "Incidents"],
  [/^\/incidents\/([\w-]+)$/, (m) => <IncidentDetailPage id={m[1]} />, "Incident"],
  [/^\/investigations\/([\w-]+)$/, (m) => <InvestigationPage id={m[1]} />, "Investigation"],
  [/^\/validation-runs\/([\w-]+)$/, (m) => <ValidationPage id={m[1]} />, "Recovery validation"],
  [/^\/evaluations$/, () => <Evaluations />, "Evaluation results"],
  [/^\/gallery$/, () => <Gallery />, "Component gallery"],
];

const NAV = [
  ["#/", "Pipeline health"],
  ["#/incidents", "Incidents"],
  ["#/evaluations", "Evaluations"],
  ["#/gallery", "Component gallery"],
];

type Theme = "system" | "light" | "dark";

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

export function App() {
  const path = useHashPath();
  const [role, setRoleState] = useState<Role>(getRole);
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme as Theme) || "system");
  const mainRef = useRef<HTMLElement>(null);
  const prevPath = useRef(path);

  const match = ROUTES.map(([re, render, title]) => ({ m: path.match(re), render, title })).find((r) => r.m);

  // generic title first (layout effect); pages refine it with the entity name in their own effects
  useLayoutEffect(() => {
    document.title = `${match?.title ?? "Page not found"} · Data Reliability Copilot`;
  }, [path]); // title depends only on path

  useEffect(() => {
    // focus the page heading on SPA navigation only — comparing paths (not a first-render flag) keeps this
    // correct under React StrictMode's double effects, so the skip link stays the first Tab stop on load
    if (prevPath.current === path) return;
    prevPath.current = path;
    const h1 = mainRef.current?.querySelector<HTMLElement>("h1");
    (h1 ?? mainRef.current)?.focus();
  }, [path]);

  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  const section = "#" + (path.startsWith("/incidents") || path.startsWith("/investigations") || path.startsWith("/validation-runs") ? "/incidents" : path);

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
                setRoleState(r);
                location.reload(); // simplest way to refetch every view with the new header
              }}
            >
              <option value="viewer">viewer</option>
              <option value="investigator">investigator</option>
              <option value="approver">approver</option>
            </select>
          </label>
        </div>
      </header>
      <nav aria-label="Primary">
        <ul>
          {NAV.map(([href, label]) => (
            <li key={href}>
              <a href={href} aria-current={section === href ? "page" : undefined}>{label}</a>
            </li>
          ))}
        </ul>
      </nav>
      <main id="main" ref={mainRef} tabIndex={-1} aria-label="Content">
        <ErrorBoundary resetKey={path}>
          {match ? (
            match.render(match.m!)
          ) : (
            <>
              <h1 tabIndex={-1}>Page not found</h1>
              <div className="state">
                <p className="state-title">There is no page at <code>#{path}</code>.</p>
                <p className="row"><a href="#/">Pipeline health</a><a href="#/incidents">All incidents</a></p>
              </div>
            </>
          )}
        </ErrorBoundary>
      </main>
      <div id="announcer" className="sr-only" aria-live="polite" aria-atomic="true" />
    </div>
  );
}
