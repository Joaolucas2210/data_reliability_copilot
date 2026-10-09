import {
  ActionIcon, AppShell, Burger, Group, Kbd, Menu, NavLink, Select, Text, Tooltip, UnstyledButton, useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import { useDisclosure, useHotkeys, useMediaQuery } from "@mantine/hooks";
import { Spotlight, spotlight, type SpotlightActionData } from "@mantine/spotlight";
import {
  IconActivityHeartbeat, IconAlertTriangle, IconBook2, IconChartBar, IconDeviceDesktop, IconMoon, IconPalette, IconSearch,
  IconShieldCheck, IconSun,
} from "@tabler/icons-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { announce, api, getRole, setRole, type Role } from "./api";
import { ErrorBoundary, fmtTime, NotFound, PageTitle, SkipLink } from "./components/ui";
import { Evaluations } from "./pages/Evaluations";
import { Gallery } from "./pages/Gallery";
import { Health } from "./pages/Health";
import { Help, TERMS } from "./pages/Help";
import { IncidentDetailPage, IncidentList } from "./pages/Incidents";
import { InvestigationPage } from "./pages/Investigation";
import { ValidationPage } from "./pages/Validation";
import type { Incident } from "./types";

// ponytail: hash routing with a regex table — add a router lib when routes need loaders/nesting.
const ROUTES: [RegExp, (m: string[], q: URLSearchParams) => ReactNode, string][] = [
  [/^\/$/, () => <Health />, "Pipeline health"],
  [/^\/incidents$/, (_m, q) => <IncidentList key={q.toString()} initialQuery={q.get("q") ?? ""} initialSort={q.get("sort") ?? "newest"} initialStatus={q.get("status") ?? ""} />, "Incidents"],
  [/^\/incidents\/([\w-]+)$/, (m) => <IncidentDetailPage id={m[1]} />, "Incident"],
  [/^\/investigations\/([\w-]+)$/, (m) => <InvestigationPage id={m[1]} />, "Investigation"],
  [/^\/validation-runs\/([\w-]+)$/, (m) => <ValidationPage id={m[1]} />, "Recovery validation"],
  [/^\/evaluations$/, () => <Evaluations />, "Evaluation results"],
  [/^\/help$/, (_m, q) => <Help term={q.get("term") ?? undefined} />, "Help & glossary"],
  [/^\/design-system$/, () => <Gallery />, "Design system"],
  [/^\/gallery$/, () => <Gallery />, "Design system"],
];

const NAV = [
  { href: "#/", label: "Pipeline health", icon: IconActivityHeartbeat },
  { href: "#/incidents", label: "Incidents", icon: IconAlertTriangle },
  { href: "#/evaluations", label: "Evaluations", icon: IconChartBar },
  { href: "#/help", label: "Help & glossary", icon: IconBook2 },
];

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

function ThemeMenu() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme("light");
  const [menuOpen, setMenuOpen] = useState(false);
  const Icon = computed === "dark" ? IconMoon : IconSun;
  const options = [
    { value: "light", label: "Light", icon: IconSun },
    { value: "dark", label: "Dark", icon: IconMoon },
    { value: "auto", label: "System", icon: IconDeviceDesktop },
  ] as const;
  return (
    <Menu position="bottom-end" withinPortal opened={menuOpen} onChange={setMenuOpen}>
      <Menu.Target>
        <Tooltip label="Theme" disabled={menuOpen}>
          <ActionIcon variant="default" size="lg" aria-label={`Theme: ${options.find((o) => o.value === colorScheme)?.label}. Change theme`}>
            <Icon size={18} stroke={1.8} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Theme</Menu.Label>
        {options.map((o) => (
          <Menu.Item
            key={o.value}
            leftSection={<o.icon size={16} />}
            onClick={() => setColorScheme(o.value)}
            fw={colorScheme === o.value ? 700 : undefined}
          >
            {o.label}
            {colorScheme === o.value && <span className="sr-only"> (current)</span>}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

function useSpotlightActions(): SpotlightActionData[] {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  useEffect(() => {
    api<Incident[]>("/incidents?status=unresolved&limit=50").then(setIncidents, () => setIncidents([]));
  }, []);
  const go = (h: string) => () => (location.hash = h);
  return [
    ...NAV.map((n) => ({ id: `nav-${n.href}`, label: n.label, description: "Go to page", onClick: go(n.href), leftSection: <n.icon size={18} />, group: "Pages" })),
    { id: "nav-ds", label: "Design system", description: "Components and states", onClick: go("#/design-system"), leftSection: <IconPalette size={18} />, group: "Pages" },
    ...incidents.map((i) => ({ id: i.id, label: i.title, description: `${i.id} · ${i.dataset_id ?? "no dataset"} · opened ${fmtTime(i.opened_at)} · ${i.status.replace("_", " ")}`, onClick: go(`#/incidents/${i.id}`), leftSection: <IconAlertTriangle size={18} />, group: "Unresolved incidents" })),
    ...TERMS.map(([id, term]) => ({ id: `term-${id}`, label: term, description: "Glossary", onClick: go(`#/help?term=${id}`), leftSection: <IconBook2 size={18} />, group: "Glossary" })),
  ];
}

export function App() {
  const full = useHashPath();
  const [pathname, query = ""] = full.split("?");
  const params = new URLSearchParams(query);
  const [role, setRoleState] = useState<Role>(getRole);
  const [opened, { toggle, close }] = useDisclosure();
  const mainRef = useRef<HTMLElement>(null);
  const prevPath = useRef(pathname);
  const actions = useSpotlightActions();
  useHotkeys([["/", () => spotlight.open()]]); // ignored while typing in inputs
  const desktop = useMediaQuery("(min-width: 62em)") ?? true; // AppShell navbar breakpoint "md"
  const burgerRef = useRef<HTMLButtonElement>(null);
  // collapsed drawer is off-screen: keep it out of the tab order; Escape closes it and returns focus to the burger
  useEffect(() => {
    if (!opened) return;
    if (!desktop) requestAnimationFrame(() => document.querySelector<HTMLElement>("#primary-nav a")?.focus()); // drawer opened: start in the nav
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { close(); burgerRef.current?.focus(); } };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [opened, close, desktop]);
  const wide = useMediaQuery("(min-width: 36em)") ?? true; // room for the "Role" prefix and the longest role name

  const match = ROUTES.map(([re, render, title]) => ({ m: pathname.match(re), render, title })).find((r) => r.m);

  useLayoutEffect(() => {
    document.title = `${match?.title ?? "Page not found"} · Data Reliability Copilot`;
  }, [pathname]); // title depends only on the route

  useEffect(() => {
    // Focus the page heading on SPA navigation only (path comparison is StrictMode-safe; query-only changes keep
    // focus). Pages keep their <h1> mounted through loading → loaded, so focus is not lost when data arrives.
    if (prevPath.current === pathname) return;
    prevPath.current = pathname;
    close();
    const h1 = mainRef.current?.querySelector<HTMLElement>("h1");
    (h1 ?? mainRef.current)?.focus();
  }, [pathname, close]);

  const section =
    "#" + (pathname.startsWith("/incidents") || pathname.startsWith("/investigations") || pathname.startsWith("/validation-runs") ? "/incidents" : pathname === "/gallery" ? "/design-system" : pathname);

  return (
    <>
      <SkipLink />
      <AppShell header={{ height: 60 }} navbar={{ width: 240, breakpoint: "md", collapsed: { mobile: !opened } }} padding="lg">
        <AppShell.Header className="app-header">
          <Group h="100%" px={{ base: "xs", sm: "md" }} justify="space-between" wrap="nowrap">
            <Group gap="xs" wrap="nowrap">
              <Burger ref={burgerRef} opened={opened} onClick={toggle} hiddenFrom="md" size="sm" aria-expanded={opened} aria-controls="primary-nav" aria-label={opened ? "Close navigation" : "Open navigation"} />
              <a href="#/" className="brand" aria-label="Data Reliability Copilot — pipeline health">
                <span className="brand-mark" aria-hidden="true"><IconShieldCheck size={20} stroke={2} /></span>
                <span className="brand-name">Data Reliability Copilot</span>
              </a>
            </Group>
            <Group gap={6} wrap="nowrap">
              <UnstyledButton className="search-trigger" onClick={() => spotlight.open()} aria-label="Search pages, incidents and terms (Control+K)">
                <IconSearch size={16} />
                <Text span size="sm" c="dimmed" visibleFrom="sm">Search…</Text>
                <Kbd size="xs" visibleFrom="sm">Ctrl K</Kbd>
              </UnstyledButton>
              <Select
                aria-label="Role (development only)"
                w={wide ? 184 : 136}
                size={wide ? "sm" : "xs"}
                value={role}
                allowDeselect={false}
                comboboxProps={{ withinPortal: true }}
                leftSection={wide ? <Text span size="xs" c="dimmed" aria-hidden="true">Role</Text> : undefined}
                leftSectionWidth={wide ? 44 : undefined}
                data={[{ value: "viewer", label: "viewer" }, { value: "investigator", label: "investigator" }, { value: "approver", label: "approver" }]}
                onChange={(v) => {
                  if (!v) return;
                  setRole(v as Role);
                  setRoleState(v as Role); // remounts the page below: refetch with the new role, no full reload
                  announce(`Role changed to ${v}. The page was refreshed for this role.`);
                }}
              />
              <ThemeMenu />
            </Group>
          </Group>
        </AppShell.Header>

        <AppShell.Navbar p="sm" aria-label="Primary" id="primary-nav" inert={!desktop && !opened}>
          <div className="primary-nav">
            {NAV.map((n) => (
              <NavLink
                key={n.href}
                href={n.href}
                label={n.label}
                leftSection={<n.icon size={18} stroke={1.8} />}
                active={section === n.href}
                aria-current={section === n.href ? "page" : undefined}
                variant="light"
              />
            ))}
          </div>
          <div className="nav-foot">
            <NavLink
              href="#/design-system"
              label="Design system"
              description="for developers"
              leftSection={<IconPalette size={18} stroke={1.8} />}
              active={section === "#/design-system"}
              aria-current={section === "#/design-system" ? "page" : undefined}
              variant="subtle"
            />
          </div>
        </AppShell.Navbar>

        <AppShell.Main id="main" ref={mainRef} tabIndex={-1} aria-label="Content" className="main-content">
            <ErrorBoundary resetKey={pathname}>
              <div key={role} className="route">
                {match ? (
                  match.render(match.m!, params)
                ) : (
                  <>
                    <PageTitle>Page not found</PageTitle>
                    <NotFound what="page" id={`#${full}`} back={{ href: "#/incidents", label: "All incidents" }} />
                  </>
                )}
              </div>
            </ErrorBoundary>
        </AppShell.Main>
      </AppShell>
      <Spotlight
        actions={actions}
        nothingFound="Nothing found"
        highlightQuery
        shortcut="mod + K"
        tagsToIgnore={[]} // Ctrl/⌘+K works from inside text fields too; "/" (below) does not
        limit={12}
        searchProps={{ leftSection: <IconSearch size={18} />, placeholder: "Search pages, unresolved incidents and glossary terms…", "aria-label": "Search" }}
      />
      <div id="announcer" className="sr-only" aria-live="polite" aria-atomic="true" />
    </>
  );
}
