import { writeFileSync } from "node:fs";

/**
 * Renders the profile's streak card to assets/streak.svg.
 *
 * This replaces the remote `streak-stats.demolab.com` image in the README.
 * That service serves its own SVG with `Cache-Control: max-age=86400` and
 * caches the contribution data it reads from GitHub behind an internal TTL
 * that cannot be cleared from the client. Measured: it kept reporting a 70-day
 * longest streak and a 1-day current streak after GitHub's own graph had
 * already moved on, and adding `cache_seconds=0` did not help because that
 * parameter governs the generated image, not the underlying fetch.
 *
 * Generating the file here means the card refreshes on this workflow's
 * schedule and nothing else sits between the data and the README.
 *
 * Data source matches generate-commits-3d.mjs. It reports today, which
 * GitHub's public contributions grid does not: on the day this was written the
 * grid's newest cell was still Oct 5 while this API already had Oct 6, a
 * difference of one full day on the current streak.
 */

const USER = "donyelqt";
const SINCE = "2023-08-31"; // first day the profile shows contributions
const API = "https://github-contributions-api.jogruber.de/v4";

// Same colours as the streak-stats card this replaces, so the README keeps
// its look. See the `theme=dark` parameters on the old URL.
const BG = "#0a0118";
const ACCENT = "#a855f7";

// The card answers "how long is my streak right now", so the day boundary has
// to be the user's local one. Using the UTC date instead silently drops
// today for 8 hours a day: measured at 2026-10-05T21:20Z this reported a 71
// day streak while the user's local day was already Oct 6, making it 72.
const TZ = "Asia/Manila";
const NUM = "#e9d5ff";
const SIDE = "#a78bda";

const W = 495;
const H = 195;
const COL_X = [82.5, 247.5, 412.5];

function todayISO() {
  // en-CA formats as YYYY-MM-DD, the shape the API and this file both use.
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

function parse(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Longest run of consecutive non-zero days anywhere in the window. */
function longestRun(counts) {
  const dates = [...counts.keys()].sort();
  let best = { length: 0, start: null, end: null };
  let run = 0;
  let prev = null;

  for (const date of dates) {
    const day = parse(date);
    if (counts.get(date) > 0) {
      // +1 day, in ms, so the comparison is date arithmetic not calendar days.
      run = prev !== null && day - prev === 86400000 ? run + 1 : 1;
      if (run > best.length) {
        best = { length: run, start: fromUTC(day - (run - 1) * 86400000), end: date };
      }
    } else {
      run = 0;
    }
    prev = day;
  }
  return best;
}

/**
 * Consecutive non-zero days ending today.
 *
 * Anchored on today rather than on "the last day that happened to have a
 * contribution": if today has none, the streak is broken and this returns 0,
 * which is the honest reading rather than silently reporting yesterday's run
 * as if it were still alive.
 */
function currentRun(counts, today) {
  let length = 0;
  let day = parse(today);
  while (length < 4000) {
    const key = fromUTC(day);
    if (!counts.has(key) || counts.get(key) === 0) break;
    length++;
    day -= 86400000;
  }
  return { length, start: fromUTC(day + 86400000), end: today };
}

const today = todayISO();
const url = `${API}/${USER}?from=${SINCE}&to=${today}`;
const res = await fetch(url);
if (!res.ok) throw new Error("contributions fetch failed: " + res.status);

const data = await res.json();
const counts = new Map();
for (const item of data.contributions) {
  // The API returns whole days including ones after `to`; drop them so they
  // cannot be mistaken for real activity.
  if (item.date <= today) counts.set(item.date, item.count);
}

const total = [...counts.values()].reduce((a, b) => a + b, 0);
const current = currentRun(counts, today);

// The range under the total is the span the card covers, which starts at the
// first day with any contribution rather than at the window edge.
const active = [...counts.entries()].filter(([, n]) => n > 0).map(([d]) => d).sort();
const firstActive = active[0];
if (!firstActive) throw new Error("no contributions found in window");
const longest = longestRun(counts);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (iso) => {
  const d = new Date(parse(iso));
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};
const fmtShort = (iso) => {
  const d = new Date(parse(iso));
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
};
const commas = (n) => n.toLocaleString("en-US");

// Fail loudly rather than publishing a card that claims a streak we could not
// read. A stale "0" is worse than a failed run the workflow will retry.
if (current.length === 0 || longest.length === 0 || total === 0) {
  throw new Error(
    `implausible data: total=${total} current=${current.length} longest=${longest.length}`
  );
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const text = (x, y, str, { size, fill, weight = 400 }) =>
  `<text x='${x}' y='${y}' text-anchor='middle' font-family='"Segoe UI", Ubuntu, sans-serif' ` +
  `font-size='${size}px' font-weight='${weight}' fill='${fill}'>${esc(str)}</text>`;

// A flame, not the real icon, so the card has no external asset dependency.
// Drawn inside the ring that streaks normally wears at the top centre.
const fire = `<g transform='translate(${COL_X[1]}, 32)'>
    <path d='M0 -13 C 6 -6, 9 -3, 9 2 A 9 9 0 0 1 -9 2 C -9 -3, -5 -6, 0 -13 Z' fill='${ACCENT}'/>
    <path d='M0 -4 C 3 -1, 4 1, 4 4 A 4 4 0 0 1 -4 4 C -4 1, -3 -1, 0 -4 Z' fill='#1a0b2e'/>
  </g>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Contribution streak: ${commas(total)} total contributions, current streak ${current.length} days ending ${fmt(current.end)}, longest streak ${longest.length} days">
  <rect stroke='${ACCENT}' fill='${BG}' rx='4.5' x='0.5' y='0.5' width='${W - 1}' height='${H - 1}'/>
  <line x1='165' y1='52' x2='165' y2='143' stroke='${ACCENT}' stroke-width='1' opacity='0.35'/>
  <line x1='330' y1='52' x2='330' y2='143' stroke='${ACCENT}' stroke-width='1' opacity='0.35'/>
  ${text(COL_X[0], 84, commas(total), { size: 28, fill: NUM, weight: 700 })}
  ${text(COL_X[0], 116, "Total Contributions", { size: 14, fill: SIDE })}
  ${text(COL_X[0], 146, `${fmt(firstActive)} - Present`, { size: 12, fill: SIDE })}
  <circle cx='${COL_X[1]}' cy='32' r='21' fill='none' stroke='${ACCENT}' stroke-width='2.5'/>
  ${fire}
  ${text(COL_X[1], 84, "Current Streak", { size: 14, fill: ACCENT })}
  ${text(COL_X[1], 128, current.length, { size: 28, fill: NUM, weight: 700 })}
  ${text(COL_X[1], 158, fmtShort(current.end), { size: 12, fill: SIDE })}
  ${text(COL_X[2], 84, longest.length, { size: 28, fill: NUM, weight: 700 })}
  ${text(COL_X[2], 116, "Longest Streak", { size: 14, fill: SIDE })}
  ${text(COL_X[2], 146, `${fmtShort(longest.start)} - ${fmtShort(longest.end)}`, { size: 12, fill: SIDE })}
</svg>
`;

writeFileSync("assets/streak.svg", svg);
console.log("wrote assets/streak.svg", {
  total,
  current: current.length,
  currentRange: `${current.start} -> ${current.end}`,
  longest: longest.length,
  longestRange: `${longest.start} -> ${longest.end}`,
});
