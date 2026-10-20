// WCAG 2.1 contrast of the design tokens in styles.css (relative luminance formula, SC 1.4.3 / 1.4.6).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const token = (name: string) => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!m) throw new Error(`token ${name} not found`);
  return m[1];
};
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

test("caregiver screens: text pairs meet AA (4.5:1)", () => {
  for (const [fg, bg] of [["ink", "bg"], ["ink-2", "bg"], ["brand", "surface"], ["brand-ink", "brand"], ["warn", "surface"], ["danger-ink", "danger"], ["ink", "surface-2"]]) {
    assert.ok(ratio(token(fg), token(bg)) >= 4.5, `${fg} on ${bg}: ${ratio(token(fg), token(bg)).toFixed(2)}`);
  }
});

test("elder mode: main text meets AAA (7:1); buttons meet AA", () => {
  assert.ok(ratio(token("elder-ink"), token("elder-bg")) >= 7);
  assert.ok(ratio("#ffffff", "#c4161f") >= 4.5);  // Help button
  assert.ok(ratio("#1f1a14", "#f3d36b") >= 7);    // Talk button
  assert.ok(ratio("#ffffff", "#1e6b2f") >= 4.5);  // Taken button
  assert.ok(ratio("#1f1a14", "#fdfaf3") >= 7);    // dose card
  assert.ok(ratio("#1f1a14", "#f3d36b") >= 7);    // demo pill
});

test("demo banner and the missing-helpline hint meet AA", () => {
  assert.ok(ratio("#fdf3df", "#2b2116") >= 7);
  assert.ok(ratio(token("warn"), token("warn-soft")) >= 4.5, ratio(token("warn"), token("warn-soft")).toFixed(2));
});
