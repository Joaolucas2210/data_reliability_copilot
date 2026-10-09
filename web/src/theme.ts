import { createTheme, type MantineColorsTuple } from "@mantine/core";

// Dark palette aligned with the validated surfaces in tokens.css (body #0f1115, cards #171a21) — not Mantine's grey.
const dark: MantineColorsTuple = ["#e6e8ec", "#c5c9d2", "#a3aab6", "#7d8594", "#3a404b", "#2a2f39", "#171a21", "#0f1115", "#0b0d11", "#07080b"];

export const theme = createTheme({
  primaryColor: "indigo",
  primaryShade: { light: 8, dark: 8 }, // white text on the primary fill stays >= 4.5:1 in both schemes
  colors: { dark },
  fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  fontFamilyMonospace: "ui-monospace, 'SFMono-Regular', 'JetBrains Mono', Menlo, Consolas, monospace",
  headings: { fontWeight: "650" },
  defaultRadius: "md",
  cursorType: "pointer",
  focusRing: "auto",
  components: {
    Card: { defaultProps: { withBorder: true, radius: "lg", padding: "lg", shadow: "xs" } },
    Paper: { defaultProps: { radius: "lg" } },
    Button: { defaultProps: { radius: "md" } },
    Tooltip: { defaultProps: { withArrow: true, openDelay: 300 } },
    Modal: { defaultProps: { centered: true, radius: "lg", overlayProps: { backgroundOpacity: 0.55, blur: 2 } } },
  },
});
