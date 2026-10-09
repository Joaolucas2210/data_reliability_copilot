import { useEffect, useRef, useState, type ReactNode } from "react";
import { getRole, setRole, type Role } from "./api";
import { SkipLink } from "./components/ui";
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
  const firstRender = useRef(true);

  const match = ROUTES.map(([re, render, title]) => ({ m: path.match(re), render, title })).find((r) => r.m);

  useEffect(() => {
    document.title = `${match?.title ?? "Not found"} · Data Reliability Copilot`;
    // move focus to content on SPA navigation, but not on first load (keeps the skip link first in tab order)
    if (firstRender.current) firstRender.current = false;
    else mainRef.current?.focus();
  }, [path]); // title depends only on path

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
      <main id="main" ref={mainRef} tabIndex={-1}>
        {match ? match.render(match.m!) : <h1>Page not found</h1>}
      </main>
    </div>
  );
}
