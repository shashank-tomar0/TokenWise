/**
 * TokenWise Architecture Diagram Generator
 *
 * Produces an Excalidraw-style hand-drawn architecture diagram:
 *   - docs/tokenwise-architecture.svg          (renders in README)
 *   - docs/tokenwise-architecture.excalidraw   (editable at excalidraw.com)
 *
 * The "hand-drawn" look comes from:
 *   - Virgil font (Excalidraw's handwriting font)
 *   - wobbly box outlines (seeded jitter on corner points)
 *   - hachure fills (jittered diagonal lines)
 *   - rough arrows with hand-drawn arrowheads
 *
 * Run: node docs/generate-diagram.mjs
 */

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ────────────────────────────────────────────────────────────
// Seeded PRNG — deterministic roughness (same output every run)
// ────────────────────────────────────────────────────────────
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(42);
const jitter = (mag = 2) => (rnd() - 0.5) * 2.2 * mag;
const f1 = (n) => n.toFixed(1);

// ────────────────────────────────────────────────────────────
// LAYOUT — the pipeline
// ────────────────────────────────────────────────────────────

const BOX_W = 185;
const BOX_H = 100;

const boxes = [
  { id: 'codebase',   label: 'Your Codebase',      sub: 'functions · classes · interfaces', x: 40,  y: 150, fill: '#b2f2bb' },
  { id: 'parse',      label: 'PARSE',              sub: 'tree-sitter AST\n+ regex fallback · 13 langs', x: 250, y: 150, fill: '#a5d8ff' },
  { id: 'graph',      label: 'GRAPH',              sub: 'call graph · imports\nPageRank centrality', x: 460, y: 150, fill: '#eebefa' },
  { id: 'rank',       label: 'RANK',               sub: 'task + model aware\nsemantic TF-IDF · budget', x: 670, y: 150, fill: '#ffd8a8' },
  { id: 'serialize',  label: 'SERIALIZE',          sub: 'greedy budget fill\nsignatures ⇄ bodies', x: 880, y: 150, fill: '#ffec99' },
];

const output = { id: 'output', label: 'Optimized Context', sub: 'adaptive · 67%\nmaximal · 88% · 97%', x: 460, y: 330, w: 480, h: 120, fill: '#b2f2bb' };
const note = { id: 'note', label: 'Ships everywhere', sub: 'MCP server · CLI\nGitHub Action', x: 40, y: 330, w: 250, h: 120, fill: '#ffc9c9' };

const W = 1130;
const H = 520;

// ────────────────────────────────────────────────────────────
// HAND-DRAWN SHAPE HELPERS
// ────────────────────────────────────────────────────────────

/** Wobbly box outline (8 jittered corner+mid points) */
function roughBoxPath(x, y, w, h, mag = 1.6) {
  const pts = [
    [x + jitter(mag), y + jitter(mag)],
    [x + w * 0.5 + jitter(mag * 1.3), y + jitter(mag)],
    [x + w + jitter(mag), y + jitter(mag)],
    [x + w + jitter(mag), y + h * 0.5 + jitter(mag * 1.3)],
    [x + w + jitter(mag), y + h + jitter(mag)],
    [x + w * 0.5 + jitter(mag * 1.3), y + h + jitter(mag)],
    [x + jitter(mag), y + h + jitter(mag)],
    [x + jitter(mag), y + h * 0.5 + jitter(mag * 1.3)],
  ];
  return 'M' + pts.map(p => p.map(f1).join(',')).join(' L') + ' Z';
}

/** Diagonal hachure fill lines inside a box */
function hachureLines(x, y, w, h, spacing = 10) {
  const lines = [];
  const n = Math.ceil((w + h) / spacing);
  for (let i = 0; i < n; i++) {
    const t = i * spacing;
    let x1, y1, x2, y2;
    if (t < w) { x1 = x + t; y1 = y; } else { x1 = x + w; y1 = y + (t - w); }
    if (t < h) { x2 = x; y2 = y + t; } else { x2 = x + (t - h); y2 = y + h; }
    lines.push([x1 + jitter(1.5), y1 + jitter(1.5), x2 + jitter(1.5), y2 + jitter(1.5)]);
  }
  return lines;
}

/** Rough curved arrow between two points */
function roughArrow(x1, y1, x2, y2) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2 + jitter(4);
  return {
    path: `M${f1(x1)},${f1(y1)} Q${f1(mx)},${f1(my)} ${f1(x2)},${f1(y2)}`,
    head: `M${f1(x2)},${f1(y2)} l${f1(-11)},${f1(-5)} m${f1(11)},${f1(5)} l${f1(-11)},${f1(5)}`,
  };
}

// ────────────────────────────────────────────────────────────
// SVG GENERATION
// ────────────────────────────────────────────────────────────

const svgParts = [];
svgParts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="TokenWise architecture — symbol-aware context distillation pipeline">
<style>
  @import url('https://excalidraw.com/Virgil.woff2');
  .hand { font-family: 'Virgil', 'Comic Sans MS', 'Segoe Print', 'Comic Sans', cursive; }
  .label { font-size: 21px; fill: #1e1e1e; text-anchor: middle; }
  .sub { font-size: 13px; fill: #343a40; text-anchor: middle; }
  .title { font-size: 34px; fill: #1e1e1e; text-anchor: middle; font-weight: bold; }
  .subtitle { font-size: 16px; fill: #495057; text-anchor: middle; }
</style>
<rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="14" fill="#faf9f6" stroke="#1e1e1e" stroke-width="2" opacity="0.85"/>
<text x="${W / 2}" y="52" class="hand title">TokenWise — Symbol-Aware Context Distillation</text>
<text x="${W / 2}" y="82" class="hand subtitle">parse → graph → rank → serialize</text>`);

// Boxes
for (const b of boxes) {
  const w = BOX_W, h = BOX_H;
  // hachure fill
  for (const [x1, y1, x2, y2] of hachureLines(b.x, b.y, w, h)) {
    svgParts.push(`<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="${b.fill}" stroke-width="9" opacity="0.5" stroke-linecap="round"/>`);
  }
  svgParts.push(`<path d="${roughBoxPath(b.x, b.y, w, h)}" fill="none" stroke="#1e1e1e" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>`);
  const subLines = b.sub.split('\n');
  svgParts.push(`<text x="${b.x + w / 2}" y="${b.y + 40}" class="hand label">${b.label}</text>`);
  subLines.forEach((line, i) => {
    svgParts.push(`<text x="${b.x + w / 2}" y="${b.y + 62 + i * 16}" class="hand sub">${line}</text>`);
  });
}

// Output + note boxes
for (const b of [output, note]) {
  for (const [x1, y1, x2, y2] of hachureLines(b.x, b.y, b.w, b.h)) {
    svgParts.push(`<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="${b.fill}" stroke-width="9" opacity="0.5" stroke-linecap="round"/>`);
  }
  svgParts.push(`<path d="${roughBoxPath(b.x, b.y, b.w, b.h)}" fill="none" stroke="#1e1e1e" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>`);
  svgParts.push(`<text x="${b.x + b.w / 2}" y="${b.y + 46}" class="hand label">${b.label}</text>`);
  b.sub.split('\n').forEach((line, i) => {
    svgParts.push(`<text x="${b.x + b.w / 2}" y="${b.y + 70 + i * 16}" class="hand sub">${line}</text>`);
  });
}

// Arrows between pipeline boxes
for (let i = 0; i < boxes.length - 1; i++) {
  const a = boxes[i], b = boxes[i + 1];
  const arrow = roughArrow(a.x + BOX_W + 4, a.y + BOX_H / 2, b.x - 4, b.y + BOX_H / 2);
  svgParts.push(`<path d="${arrow.path}" fill="none" stroke="#1e1e1e" stroke-width="2" stroke-linecap="round"/>`);
  svgParts.push(`<path d="${arrow.head}" fill="none" stroke="#1e1e1e" stroke-width="2" stroke-linecap="round"/>`);
}

// Arrow: serialize → output (down)
{
  const s = boxes[4];
  const arrow = roughArrow(s.x + BOX_W / 2, s.y + BOX_H + 4, output.x + output.w / 2 - 40, output.y - 4);
  svgParts.push(`<path d="${arrow.path}" fill="none" stroke="#1e1e1e" stroke-width="2" stroke-linecap="round"/>`);
  svgParts.push(`<path d="${arrow.head}" fill="none" stroke="#1e1e1e" stroke-width="2" stroke-linecap="round"/>`);
}

// Arrow: codebase → note (down)
{
  const c = boxes[0];
  const arrow = roughArrow(c.x + BOX_W / 2, c.y + BOX_H + 4, note.x + note.w / 2, note.y - 4);
  svgParts.push(`<path d="${arrow.path}" fill="none" stroke="#1e1e1e" stroke-width="2" stroke-linecap="round"/>`);
  svgParts.push(`<path d="${arrow.head}" fill="none" stroke="#1e1e1e" stroke-width="2" stroke-linecap="round"/>`);
}

svgParts.push(`</svg>`);
writeFileSync(join(__dirname, 'tokenwise-architecture.svg'), svgParts.join('\n'));

// ────────────────────────────────────────────────────────────
// EXCALIDRAW JSON GENERATION (v2 format, editable at excalidraw.com)
// ────────────────────────────────────────────────────────────

const elements = [];
let version = 1;

function el(partial) {
  elements.push({
    version: version++,
    versionNonce: Math.floor(rnd() * 1e9),
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    seed: Math.floor(rnd() * 1e9),
    ...partial,
  });
}

// Title (text only)
el({
  type: 'text', id: 'title',
  x: 120, y: 20, width: 890, height: 40,
  text: 'TokenWise — Symbol-Aware Context Distillation',
  fontSize: 32, fontFamily: 1, textAlign: 'center', verticalAlign: 'top',
  strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roughness: 1, opacity: 100, angle: 0,
});

// Pipeline boxes
const shapes = [
  ...boxes.map(b => ({ ...b, w: BOX_W, h: BOX_H })),
  output, note,
];

for (const b of shapes) {
  el({
    type: 'rectangle', id: b.id,
    x: b.x, y: b.y, width: b.w, height: b.h,
    strokeColor: '#1e1e1e', backgroundColor: b.fill,
    fillStyle: 'hachure', strokeWidth: 1, strokeStyle: 'solid',
    roughness: 1, opacity: 100, angle: 0,
    roundness: { type: 3 },
  });
  // Main label
  el({
    type: 'text', id: `${b.id}-label`,
    x: b.x + 10, y: b.y + 12, width: b.w - 20, height: 26,
    text: b.label,
    fontSize: 20, fontFamily: 1, textAlign: 'center', verticalAlign: 'middle',
    strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roughness: 1, opacity: 100, angle: 0,
    containerId: b.id,
  });
  // Sub-label (multi-line → separate text elements)
  const subLines = b.sub.split('\n');
  subLines.forEach((line, i) => {
    el({
      type: 'text', id: `${b.id}-sub${i}`,
      x: b.x + 10, y: b.y + 40 + i * 17, width: b.w - 20, height: 16,
      text: line,
      fontSize: 13, fontFamily: 1, textAlign: 'center', verticalAlign: 'middle',
      strokeColor: '#343a40', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roughness: 1, opacity: 100, angle: 0,
      containerId: b.id,
    });
  });
}

// Arrows between pipeline boxes
for (let i = 0; i < boxes.length - 1; i++) {
  const a = boxes[i], b = boxes[i + 1];
  const x1 = a.x + BOX_W, y1 = a.y + BOX_H / 2;
  const x2 = b.x, y2 = b.y + BOX_H / 2;
  el({
    type: 'arrow', id: `arrow-${a.id}-${b.id}`,
    x: x1, y: y1, width: x2 - x1, height: 0,
    points: [[0, 0], [x2 - x1, 0]],
    strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, angle: 0,
    startBinding: { elementId: a.id, focus: 0.5, gap: 4 },
    endBinding: { elementId: b.id, focus: 0.5, gap: 4 },
  });
}

// serialize → output (down)
{
  const s = boxes[4];
  const x1 = s.x + BOX_W / 2, y1 = s.y + BOX_H;
  const x2 = output.x + output.w / 2, y2 = output.y;
  el({
    type: 'arrow', id: 'arrow-serialize-output',
    x: x1, y: y1, width: x2 - x1, height: y2 - y1,
    points: [[0, 0], [x2 - x1, y2 - y1]],
    strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, angle: 0,
    startBinding: { elementId: s.id, focus: 0.5, gap: 4 },
    endBinding: { elementId: output.id, focus: 0.5, gap: 4 },
  });
}

// codebase → note (down)
{
  const c = boxes[0];
  const x1 = c.x + BOX_W / 2, y1 = c.y + BOX_H;
  const x2 = note.x + note.w / 2, y2 = note.y;
  el({
    type: 'arrow', id: 'arrow-codebase-note',
    x: x1, y: y1, width: x2 - x1, height: y2 - y1,
    points: [[0, 0], [x2 - x1, y2 - y1]],
    strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, angle: 0,
    startBinding: { elementId: c.id, focus: 0.5, gap: 4 },
    endBinding: { elementId: note.id, focus: 0.5, gap: 4 },
  });
}

const excalidraw = {
  type: 'excalidraw',
  version: 2,
  source: 'https://excalidraw.com',
  elements,
  appState: { viewBackgroundColor: '#faf9f6', gridSize: null },
  files: {},
};

writeFileSync(join(__dirname, 'tokenwise-architecture.excalidraw'), JSON.stringify(excalidraw, null, 2));
console.log('✅ Generated:');
console.log('  docs/tokenwise-architecture.svg');
console.log('  docs/tokenwise-architecture.excalidraw');
