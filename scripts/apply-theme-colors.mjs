#!/usr/bin/env node
/**
 * Replace hardcoded hex colors in CSS with --wl-* theme tokens.
 * Skips hexes that already appear inside var(...).
 * Run: node scripts/apply-theme-colors.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

const FILES = [
  "app/components/AdminPage.css",
  "app/components/DashboardHome.css",
  "app/components/DashboardHelp.css",
  "app/components/Reports.css",
  "app/components/AnalyticsMetrics.css",
  "app/components/BackInStockConfiguration.css",
  "app/components/BackInStockRequests.css",
  "app/components/Backinstockcustomizer.css",
  "app/components/ConfigurationFeaturesNavigation.css",
  "app/components/SmartSaveSettings.css",
  "app/components/analytics/ClassicAnalytics.css",
  "app/components/analytics/product-detail.css",
  "app/routes/_index/styles.module.css",
  "extensions/theme/assets/storefront-ui.css",
  "extensions/theme/assets/back-in-stock.css",
  "extensions/theme/assets/wishlist.css",
];

const MAP = new Map(
  [
    ["#334155", "var(--wl-primary)"],
    ["#1e293b", "var(--wl-primary-variant)"],
    ["#38bdf8", "var(--wl-secondary)"],
    ["#f1f5f9", "var(--wl-background)"],
    ["#0f172a", "var(--wl-text)"],
    ["#64748b", "var(--wl-text-secondary)"],
    ["#94a3b8", "var(--wl-text-disabled)"],
    ["#e2e8f0", "var(--wl-border)"],
    ["#cbd5e1", "var(--wl-border-strong)"],
    ["#15803d", "var(--wl-success)"],
    ["#b45309", "var(--wl-warning)"],
    ["#dc2626", "var(--wl-error)"],
    ["#2563eb", "var(--wl-info)"],
    ["#dcfce7", "var(--wl-success-soft)"],
    ["#ffedd5", "var(--wl-warning-soft)"],
    ["#fee2e2", "var(--wl-error-soft)"],
    ["#dbeafe", "var(--wl-info-soft)"],
    ["#e0f2fe", "var(--wl-accent-soft)"],
    ["#202223", "var(--wl-text)"],
    ["#1f2328", "var(--wl-text)"],
    ["#303030", "var(--wl-text)"],
    ["#303436", "var(--wl-text)"],
    ["#2f2f2f", "var(--wl-text)"],
    ["#2c2c2c", "var(--wl-text)"],
    ["#2d2d2d", "var(--wl-text)"],
    ["#34435a", "var(--wl-text)"],
    ["#202a38", "var(--wl-text)"],
    ["#111111", "var(--wl-text)"],
    ["#111", "var(--wl-text)"],
    ["#616161", "var(--wl-text-secondary)"],
    ["#667085", "var(--wl-text-secondary)"],
    ["#6d7175", "var(--wl-text-secondary)"],
    ["#6b6b6b", "var(--wl-text-secondary)"],
    ["#687078", "var(--wl-text-secondary)"],
    ["#626a72", "var(--wl-text-secondary)"],
    ["#6b7684", "var(--wl-text-secondary)"],
    ["#717171", "var(--wl-text-secondary)"],
    ["#737373", "var(--wl-text-secondary)"],
    ["#777777", "var(--wl-text-secondary)"],
    ["#777", "var(--wl-text-secondary)"],
    ["#4a4a4a", "var(--wl-text-secondary)"],
    ["#4a5568", "var(--wl-text-secondary)"],
    ["#444444", "var(--wl-text-secondary)"],
    ["#444", "var(--wl-text-secondary)"],
    ["#8a8a8a", "var(--wl-text-disabled)"],
    ["#8c9196", "var(--wl-text-disabled)"],
    ["#8d8d8d", "var(--wl-text-disabled)"],
    ["#8a8d91", "var(--wl-border-strong)"],
    ["#f1f2f4", "var(--wl-background)"],
    ["#f1f1f1", "var(--wl-background)"],
    ["#f3f3f3", "var(--wl-background)"],
    ["#f4f5f7", "var(--wl-background)"],
    ["#f4f4f4", "var(--wl-background)"],
    ["#f5f5f5", "var(--wl-background)"],
    ["#f6f6f7", "var(--wl-background)"],
    ["#f7f7f7", "var(--wl-background)"],
    ["#fafafa", "var(--wl-surface-muted)"],
    ["#fdfdfd", "var(--wl-surface)"],
    ["#fcfbff", "var(--wl-surface)"],
    ["#f8fafc", "var(--wl-surface-muted)"],
    ["#ebe7f4", "var(--wl-primary-soft)"],
    ["#dce8f5", "var(--wl-accent-soft)"],
    ["#f5f4fb", "var(--wl-primary-soft)"],
    ["#eef0f2", "var(--wl-primary-soft)"],
    ["#ffffff", "var(--wl-surface)"],
    ["#fff", "var(--wl-surface)"],
    ["#e1e3e5", "var(--wl-border)"],
    ["#e1e4e8", "var(--wl-border)"],
    ["#e1e1e1", "var(--wl-border)"],
    ["#e3e5e8", "var(--wl-border)"],
    ["#e3e3e3", "var(--wl-border)"],
    ["#e5e5e5", "var(--wl-border)"],
    ["#e5e7e9", "var(--wl-border)"],
    ["#e6e6e6", "var(--wl-border)"],
    ["#e7e7e7", "var(--wl-border)"],
    ["#e8eaed", "var(--wl-border)"],
    ["#ebebeb", "var(--wl-border)"],
    ["#ececec", "var(--wl-border)"],
    ["#eeeeee", "var(--wl-border)"],
    ["#eee", "var(--wl-border)"],
    ["#dedede", "var(--wl-border)"],
    ["#dddddd", "var(--wl-border)"],
    ["#ddd", "var(--wl-border)"],
    ["#d9d9d9", "var(--wl-border-strong)"],
    ["#d6d6d6", "var(--wl-border-strong)"],
    ["#d5d5d5", "var(--wl-border-strong)"],
    ["#cccccc", "var(--wl-border-strong)"],
    ["#ccc", "var(--wl-border-strong)"],
    ["#c9cccf", "var(--wl-border-strong)"],
    ["#c9cdd1", "var(--wl-border-strong)"],
    ["#cfcfcf", "var(--wl-border-strong)"],
    ["#bbbbbb", "var(--wl-border-strong)"],
    ["#bbb", "var(--wl-border-strong)"],
    ["#005bd3", "var(--wl-info)"],
    ["#0063d2", "var(--wl-info)"],
    ["#2c6ecb", "var(--wl-info)"],
    ["#2f6fd6", "var(--wl-info)"],
    ["#438fc4", "var(--wl-info)"],
    ["#80bce1", "var(--wl-accent)"],
    ["#e8f2ff", "var(--wl-info-soft)"],
    ["#eaf1fb", "var(--wl-info-soft)"],
    ["#d9e6f5", "var(--wl-info-soft)"],
    ["#bcd2f0", "var(--wl-info-soft)"],
    ["#0b7a5a", "var(--wl-primary)"],
    ["#0c7a5a", "var(--wl-primary)"],
    ["#007f5f", "var(--wl-primary)"],
    ["#006e52", "var(--wl-primary-variant)"],
    ["#014b40", "var(--wl-success)"],
    ["#0c5132", "var(--wl-success)"],
    ["#178a56", "var(--wl-success)"],
    ["#18794e", "var(--wl-success)"],
    ["#168a63", "var(--wl-success)"],
    ["#199c88", "var(--wl-secondary)"],
    ["#19b59a", "var(--wl-secondary)"],
    ["#25b69c", "var(--wl-secondary)"],
    ["#2fae74", "var(--wl-success)"],
    ["#2f8f5b", "var(--wl-success)"],
    ["#43bfa9", "var(--wl-secondary)"],
    ["#6bd5c0", "var(--wl-accent)"],
    ["#23683a", "var(--wl-success)"],
    ["#adf8cd", "var(--wl-success-soft)"],
    ["#e7f6ee", "var(--wl-success-soft)"],
    ["#e5f6f3", "var(--wl-accent-soft)"],
    ["#e6f4ef", "var(--wl-success-soft)"],
    ["#eaf5ed", "var(--wl-success-soft)"],
    ["#a9d6c7", "var(--wl-success-soft)"],
    ["#a86e00", "var(--wl-warning)"],
    ["#b06a00", "var(--wl-warning)"],
    ["#b26a00", "var(--wl-warning)"],
    ["#b98900", "var(--wl-warning)"],
    ["#825b00", "var(--wl-warning)"],
    ["#6a5b19", "var(--wl-warning)"],
    ["#e0900f", "var(--wl-warning)"],
    ["#d8a33d", "var(--wl-warning)"],
    ["#d9a441", "var(--wl-warning)"],
    ["#f0cc72", "var(--wl-warning-soft)"],
    ["#f4ebba", "var(--wl-warning-soft)"],
    ["#fdf1dc", "var(--wl-warning-soft)"],
    ["#fdf2e0", "var(--wl-warning-soft)"],
    ["#fff3d7", "var(--wl-warning-soft)"],
    ["#f0d49c", "var(--wl-warning-soft)"],
    ["#c4321c", "var(--wl-error)"],
    ["#c9372c", "var(--wl-error)"],
    ["#b42318", "var(--wl-error)"],
    ["#b83c25", "var(--wl-error)"],
    ["#a3312a", "var(--wl-error)"],
    ["#c4553f", "var(--wl-error)"],
    ["#d7755d", "var(--wl-error)"],
    ["#ff0000", "var(--wl-error)"],
    ["#f00", "var(--wl-error)"],
    ["#fdebea", "var(--wl-error-soft)"],
    ["#fbeae8", "var(--wl-error-soft)"],
    ["#fdf1ee", "var(--wl-error-soft)"],
    ["#f0c4bb", "var(--wl-error-soft)"],
    ["#efbcb7", "var(--wl-error-soft)"],
    ["#efa58e", "var(--wl-error-soft)"],
    ["#6b5ce7", "var(--wl-primary)"],
    ["#9b7cf6", "var(--wl-info)"],
    ["#f1edff", "var(--wl-info-soft)"],
    ["#0f2a3a", "var(--wl-primary-variant)"],
    ["#7f9a58", "var(--wl-chart-5)"],
    ["#b0b4b9", "var(--wl-border-strong)"],
    ["#b0c984", "var(--wl-chart-5)"],
    ["#d8dce2", "var(--wl-border)"],
    ["#000000", "var(--wl-text)"],
    ["#000", "var(--wl-text)"],
  ].map(([k, v]) => [k.toLowerCase(), v]),
);

function isInsideVar(css, index) {
  const before = css.slice(Math.max(0, index - 80), index);
  const open = before.lastIndexOf("var(");
  if (open === -1) return false;
  const close = before.indexOf(")", open);
  return close === -1; // still open
}

function isInsideRootDefinition(css, index) {
  // Avoid rewriting the token definitions inside :root { --wl-*: #hex }
  const before = css.slice(Math.max(0, index - 120), index);
  return /--[\w-]+\s*:\s*$/.test(before) || /--[\w-]+\s*:\s*#[0-9a-f]*$/i.test(before);
}

function replaceHex(css) {
  let changes = 0;
  const out = css.replace(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g, (match, _g, offset) => {
    if (isInsideVar(css, offset)) return match;
    if (isInsideRootDefinition(css, offset)) return match;
    const key = match.toLowerCase();
    const token = MAP.get(key);
    if (!token) return match;
    changes += 1;
    return token;
  });
  return { out, changes };
}

let total = 0;
for (const rel of FILES) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    console.warn("skip missing", rel);
    continue;
  }
  const raw = fs.readFileSync(file, "utf8");
  const { out, changes } = replaceHex(raw);
  if (changes > 0) {
    fs.writeFileSync(file, out);
    console.log(`${rel}: ${changes} replacements`);
    total += changes;
  } else {
    console.log(`${rel}: no changes`);
  }
}
console.log(`Done. ${total} total replacements.`);
