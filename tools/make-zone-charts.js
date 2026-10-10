// Draw the zone-distribution charts for docs/WALKTHROUGH.md from the
// measurements tools/make-walkthrough.sh collected in Photoshop.
// Usage: node tools/make-zone-charts.js <measurements.json> <output dir>
//
// Each chart is one series: the share of the frame in each zone, as columns.
// Comparisons are small multiples on one shared scale. Under the columns sits
// the literal zone grey for each zone, as the scale legend.
const fs = require("fs");
const path = require("path");
const Z = require("../plugin/js/zones.js");

const [, , input, outDir] = process.argv;
if (!input || !outDir) {
  console.error("Usage: node tools/make-zone-charts.js <measurements.json> <output dir>");
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(input, "utf8"));
const V = data.variants;

const STYLE = `
  svg { --surface: #fcfcfb; --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781; --grid: #e1e0d9; --bar: #2a78d6; }
  @media (prefers-color-scheme: dark) {
    svg { --surface: #1a1a19; --ink: #ffffff; --ink-2: #c3c2b7; --muted: #898781; --grid: #2c2c2a; --bar: #3987e5; }
  }
  text { font-family: -apple-system, "Segoe UI", system-ui, sans-serif; fill: var(--ink-2); }
  .ink { fill: var(--ink); }
  .muted { fill: var(--muted); }
  .bar { fill: var(--bar); }
  .grid { stroke: var(--grid); stroke-width: 1; }
  .swatch { stroke: var(--muted); stroke-width: 0.75; }`;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const pct = (v) => (v * 100 < 9.95 ? (v * 100).toFixed(1) : Math.round(v * 100)) + "%";
const grey = (k) => {
  const g = Math.round(Z.encodeL(Z.lOfZone(k)) * 255).toString(16).padStart(2, "0");
  return "#" + g + g + g;
};
const summary = (v) => `${Math.round(v.dark * 100)}% dark · ${Z.RANGE_LABEL[v.range].toLowerCase()}`;

// A column with a 4px rounded top, square at the baseline.
function column(x, base, w, h) {
  if (h <= 0) return "";
  const r = Math.min(4, h, w / 2);
  const y = base - h;
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`;
}

// One row of eleven columns. Labels the tallest column only.
function row({ x, base, height, slot, barW, fractions, max, labelPeak }) {
  const parts = [];
  const peak = fractions.indexOf(Math.max(...fractions));
  fractions.forEach((f, k) => {
    const h = Math.round((f / max) * height * 10) / 10;
    const bx = x + k * slot + (slot - barW) / 2;
    parts.push(`<path class="bar" d="${column(bx, base, barW, h)}"><title>Zone ${Z.ROMAN[k]}: ${pct(f)}</title></path>`);
    if (labelPeak && k === peak) parts.push(`<text x="${bx + barW / 2}" y="${base - h - 5}" text-anchor="middle" font-size="11" class="ink">${pct(f)}</text>`);
  });
  parts.push(`<line class="grid" x1="${x}" x2="${x + 11 * slot}" y1="${base + 0.5}" y2="${base + 0.5}"/>`);
  return parts.join("");
}

function zoneScale(x, y, slot) {
  const parts = [];
  for (let k = 0; k <= 10; k++) {
    const cx = x + k * slot;
    parts.push(`<rect class="swatch" x="${cx + 1.5}" y="${y}" width="${slot - 3}" height="9" rx="1.5" fill="${grey(k)}"/>`);
    parts.push(`<text x="${cx + slot / 2}" y="${y + 23}" text-anchor="middle" font-size="11">${Z.ROMAN[k]}</text>`);
  }
  return parts.join("");
}

function svg(w, h, title, desc, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="t d">
<title id="t">${esc(title)}</title><desc id="d">${esc(desc)}</desc>
<style>${STYLE}</style>
<rect width="${w}" height="${h}" rx="8" fill="var(--surface)"/>
${body}
</svg>
`;
}

// The single distribution of the scene as metered, with a y-axis.
function single(key, file) {
  const v = V[key];
  const W = 640;
  const H = 264;
  const left = 56;
  const top = 64;
  const height = 150;
  const slot = (W - left - 28) / 11;
  const max = Math.ceil((Math.max(...v.fractions) * 100) / 10) * 10 / 100;
  const base = top + height;
  const ticks = [];
  for (let t = 0; t <= max + 1e-9; t += 0.1) {
    const y = base - (t / max) * height;
    ticks.push(`<line class="grid" x1="${left}" x2="${left + 11 * slot}" y1="${y + 0.5}" y2="${y + 0.5}"/><text x="${left - 8}" y="${y + 4}" text-anchor="end" font-size="11" class="muted">${Math.round(t * 100)}%</text>`);
  }
  const body = [
    `<text x="24" y="30" font-size="15" font-weight="600" class="ink">Share of the frame in each zone: ${esc(v.label.toLowerCase())}</text>`,
    `<text x="24" y="49" font-size="12">${esc(Z.KEY_LABEL[v.key])} · ${esc(summary(v))} · textured darks ${pct(v.texturedDark)} · textured lights ${pct(v.texturedLight)}</text>`,
    ticks.join(""),
    row({ x: left, base, height, slot, barW: Math.min(24, slot - 8), fractions: v.fractions, max, labelPeak: false }),
    zoneScale(left, base + 8, slot),
  ].join("\n");
  const desc = v.fractions.map((f, k) => `Zone ${Z.ROMAN[k]} ${pct(f)}`).join(", ");
  fs.writeFileSync(path.join(outDir, file), svg(W, H, `Zones of the photograph, ${v.label}`, desc, body));
}

// Small multiples: one row per variant, one shared scale.
// rows: [{ key, label, detail }]; each row reads label / detail / summary.
function multiples(spec, title, file) {
  const rows = spec.filter((s) => V[s.key]).map((s) => Object.assign({}, V[s.key], { label: s.label, detail: s.detail }));
  const W = 640;
  const labelW = 196;
  const rowH = 58;
  const gap = 12;
  const top = 56;
  const slot = (W - labelW - 24) / 11;
  const max = Math.max(...rows.flatMap((r) => r.fractions));
  const parts = [`<text x="24" y="30" font-size="15" font-weight="600" class="ink">${esc(title)}</text>`, `<text x="24" y="47" font-size="12" class="muted">Share of the frame in each zone. Every row shares one scale; the tallest column in each row is labelled.</text>`];
  rows.forEach((r, i) => {
    const y0 = top + i * (rowH + gap);
    const base = y0 + rowH;
    parts.push(`<text x="24" y="${y0 + 17}" font-size="13" font-weight="600" class="ink">${esc(r.label)}</text>`);
    if (r.detail) parts.push(`<text x="24" y="${y0 + 33}" font-size="11" class="muted">${esc(r.detail)}</text>`);
    parts.push(`<text x="24" y="${y0 + (r.detail ? 49 : 33)}" font-size="11">${esc(summary(r))}</text>`);
    parts.push(row({ x: labelW, base, height: rowH - 16, slot, barW: Math.min(18, slot - 8), fractions: r.fractions, max, labelPeak: true }));
  });
  const scaleY = top + rows.length * (rowH + gap) - gap + 8;
  parts.push(zoneScale(labelW, scaleY, slot));
  const H = scaleY + 36;
  const desc = rows.map((r) => `${r.label}: ${summary(r)}`).join("; ");
  fs.writeFileSync(path.join(outDir, file), svg(W, H, title, desc, parts.join("\n")));
}

single("colour", "zones-as-metered.svg");
const P = data.placements || {};
multiples(
  Z.FILTERS.map((f) => ({ key: "filter-" + f.id, label: f.label })),
  "Filters redistribute the same scene",
  "zones-filters.svg"
);
multiples(
  Object.keys(V)
    .filter((k) => k.startsWith("dev-"))
    .map((k) => {
      const n = Number(k.slice(4));
      return { key: k, label: Z.devLabel(n), detail: n === 0 ? "as metered" : n < 0 ? "highlights compressed" : "highlights expanded" };
    }),
  "Development: Zone III held, highlights moved",
  "zones-development.svg"
);
multiples(
  [{ key: "dev-0", label: "As metered", detail: "no placement" }]
    .concat(Object.keys(P).map((k) => ({ key: "place-" + k, label: P[k].label, detail: P[k].detail })))
    .concat([{ key: "burned", label: "Expanded, burned", detail: "edges and sky burned" }]),
  "Placement: one decision moves the whole scale",
  "zones-placement.svg"
);
console.log("Charts written to " + outDir);
