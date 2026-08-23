import { writeFileSync } from "node:fs";

const USER = "donyelqt";
const YEAR = new Date().getFullYear();
const hw = 8; // tile half-width
const hh = 4.5; // tile half-height
const HSCALE = 0.9; // commits -> px height

const res = await fetch(`https://github-contributions-api.jogruber.de/v4/${USER}?y=${YEAR}`);
if (!res.ok) throw new Error("contributions fetch failed: " + res.status);
const data = await res.json();
const items = data.contributions; // [{date,count,level}]
const total = data.total[YEAR];

const base = Date.UTC(YEAR, 0, 1);
const jan1Dow = new Date(base).getUTCDay(); // 0=Sun

const cells = items
  .map((it) => {
    const d = new Date(it.date + "T00:00:00Z");
    const diff = Math.round((d.getTime() - base) / 86400000);
    const col = Math.floor((diff + jan1Dow) / 7);
    const row = d.getUTCDay();
    return { col, row, count: it.count, level: it.level };
  })
  .filter((c) => c.col >= 0 && c.col < 54);

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}

const L = ["#1b0b33", "#4c1d95", "#7c3aed", "#a855f7", "#d8b4fe"];

const polys = [];
let minX = Infinity,
  minY = Infinity,
  maxX = -Infinity,
  maxY = -Infinity;
const track = (x, y) => {
  if (x < minX) minX = x;
  if (y < minY) minY = y;
  if (x > maxX) maxX = x;
  if (y > maxY) maxY = y;
};

for (const { col, row, count, level } of cells) {
  const sx = (col - row) * hw;
  const sy = (col + row) * hh;
  const h = Math.min(count, 50) * HSCALE;
  const top = L[level];
  const left = shade(top, 0.7);
  const right = shade(top, 0.5);

  if (h <= 0) {
    const pts = `${sx},${sy - hh} ${sx + hw},${sy} ${sx},${sy + hh} ${sx - hw},${sy}`;
    polys.push({ depth: col + row, d: `<polygon points="${pts}" fill="${top}" stroke="#0a0118" stroke-width="0.4"/>` });
    track(sx - hw, sy - hh);
    track(sx + hw, sy + hh);
    continue;
  }

  const T = [sx, sy - hh - h], R = [sx + hw, sy - h], B = [sx, sy + hh - h], Lp = [sx - hw, sy - h];
  const Bb = [sx, sy + hh], Rb = [sx + hw, sy], Lb = [sx - hw, sy];

  const leftFace = `${Lp[0]},${Lp[1]} ${B[0]},${B[1]} ${Bb[0]},${Bb[1]} ${Lb[0]},${Lb[1]}`;
  const rightFace = `${B[0]},${B[1]} ${R[0]},${R[1]} ${Rb[0]},${Rb[1]} ${Bb[0]},${Bb[1]}`;
  const topFace = `${T[0]},${T[1]} ${R[0]},${R[1]} ${B[0]},${B[1]} ${Lp[0]},${Lp[1]}`;

  polys.push({
    depth: col + row,
    d:
      `<polygon points="${leftFace}" fill="${left}" stroke="#0a0118" stroke-width="0.3"/>` +
      `<polygon points="${rightFace}" fill="${right}" stroke="#0a0118" stroke-width="0.3"/>` +
      `<polygon points="${topFace}" fill="${top}" stroke="#0a0118" stroke-width="0.3"/>`,
  });
  track(sx - hw, sy - hh - h);
  track(sx + hw, sy + hh);
}

polys.sort((a, b) => a.depth - b.depth);

const pad = 24;
const vbX = minX - pad;
const vbY = minY - pad - 26; // room for caption
const vbW = maxX - minX + pad * 2;
const vbH = maxY - minY + pad * 2 + 26;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${Math.round(vbW)}" height="${Math.round(vbH)}" role="img" aria-label="3D commit graph ${YEAR}">
  <rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="#0a0118"/>
  <text x="${vbX + 2}" y="${vbY + 18}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13" font-weight="700" letter-spacing="2" fill="#c084fc">${YEAR} · ${total} COMMITS</text>
  ${polys.map((p) => p.d).join("\n  ")}
</svg>
`;

writeFileSync("assets/commits-3d.svg", svg);
console.log("wrote assets/commits-3d.svg", { total, cells: cells.length, vbW: Math.round(vbW), vbH: Math.round(vbH) });
