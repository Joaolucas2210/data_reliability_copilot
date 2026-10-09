// Checks WCAG 2.2 contrast of token pairs in src/styles/tokens.css. Exits 1 on any failure.
// Usage: node scripts/contrast.mjs [--markdown]
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
const block = (re) => Object.fromEntries([...css.match(re)[1].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
const themes = { light: block(/:root \{([^}]*)\}/), dark: block(/:root\[data-mantine-color-scheme="dark"\] \{([^}]*)\}/) };

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const pairs = [
  ...["bg", "surface", "surface-2"].flatMap((bg) => [["text", bg, 4.5], ["text-muted", bg, 4.5], ["link", bg, 4.5], ["focus", bg, 3], ["border-strong", bg, 3]]),
  ...["pass", "warn", "fail", "info", "unknown", "fact", "hypothesis", "recommendation", "verified"].flatMap((k) => [[`${k}-fg`, `${k}-bg`, 4.5], [`${k}-fg`, "surface", 4.5]]),
];

let failed = 0;
const md = process.argv.includes("--markdown");
if (md) console.log("| pair | min | light | dark |\n|---|---|---|---|");
for (const [fg, bg, min] of pairs) {
  const r = Object.values(themes).map((t) => ratio(t[fg], t[bg]));
  const ok = r.every((v) => v >= min);
  failed += ok ? 0 : 1;
  console.log(md ? `| \`${fg}\` on \`${bg}\` | ${min}:1 | ${r[0].toFixed(2)} | ${r[1].toFixed(2)} |` : `${ok ? "ok  " : "FAIL"} ${fg} on ${bg}: ${r.map((v) => v.toFixed(2)).join(" / ")} (min ${min})`);
}
if (failed) { console.error(`${failed} pair(s) below AA`); process.exit(1); }
