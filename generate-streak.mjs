import { writeFileSync } from "node:fs";

/**
 * Renders the profile's streak card to assets/streak.svg.
 *
 * This replaces the remote `streak-stats.demolab.com` image in the README.
 * That service serves its own SVG with `Cache-Control: max-age=86400` and
 * caches the contribution data it reads from GitHub behind an internal TTL
 * that cannot be cleared from the client. Measured: it kept reporting a 1-day
 * current streak and a 70-day longest streak after GitHub's own graph had
 * already moved on, and `cache_seconds=0` did not help because that parameter
 * governs the generated image, not the underlying fetch.
 *
 * Only the nine numbers are computed here. Every coordinate, colour, path and
 * animation below is copied verbatim from the card this replaces, so switching
 * over is not a redesign: the rendered result is the same design with fresh
 * values. Do not "tidy" the geometry.
 */

const USER = "donyelqt";
const SINCE = "2023-08-31"; // first day the profile shows contributions
const API = "https://github-contributions-api.jogruber.de/v4";

// Same colours as the streak-stats card this replaces, so the README keeps
// its look. See the `theme=dark` parameters on the old URL.
const BG = "#0a0118";
const ACCENT = "#a855f7";
const NUM = "#e9d5ff";
const SIDE = "#a78bda";

// The card answers "how long is my streak right now", so the day boundary has
// to be the user's local one. Using the UTC date instead silently drops
// today for 8 hours a day: measured at 2026-10-05T21:20Z this reported a 71
// day streak while the user's local day was already Oct 6, making it 72.
const TZ = "Asia/Manila";

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
const longest = longestRun(counts);

// The range under the total is the span the card covers, which starts at the
// first day with any contribution rather than at the window edge.
const active = [...counts.entries()].filter(([, n]) => n > 0).map(([d]) => d).sort();
const firstActive = active[0];

// Fail loudly rather than publishing a card that claims a streak we could not
// read. A stale "0" is worse than a failed run the workflow will retry.
if (!firstActive || current.length === 0 || longest.length === 0 || total === 0) {
  throw new Error(
    `implausible data: total=${total} current=${current.length} longest=${longest.length}`
  );
}

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

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Text block, matching the original's attributes exactly: the group carries the
// position, the text carries the baseline offset.
const block = (x, y, str, { size, fill, weight = 400, ty = 32, anim }) => {
  const style =
    anim === "currstreak"
      ? "animation: currstreak 0.6s linear forwards"
      : `opacity: 0; animation: fadein 0.5s linear forwards ${anim}s`;
  return (
    `<g transform='translate(${x}, ${y})'>\n` +
    `                    <text x='0' y='${ty}' stroke-width='0' text-anchor='middle' fill='${fill}' stroke='none' ` +
    `font-family='"Segoe UI", Ubuntu, sans-serif' font-weight='${weight}' font-size='${size}px' ` +
    `font-style='normal' style='${style}'>\n` +
    `                        ${esc(str)}\n` +
    `                    </text>\n` +
    `                </g>`
  );
};

// The flame, verbatim from the original card.
const FIRE =
  `<g transform='translate(247.5, 19.5)' stroke-opacity='0' style='opacity: 0; animation: fadein 0.5s linear forwards 0.6s'>\n` +
  `                    <path d='M -12 -0.5 L 15 -0.5 L 15 23.5 L -12 23.5 L -12 -0.5 Z' fill='none'/>\n` +
  `                    <path d='M 1.5 0.67 C 1.5 0.67 2.24 3.32 2.24 5.47 C 2.24 7.53 0.89 9.2 -1.17 9.2 ` +
  `C -3.23 9.2 -4.79 7.53 -4.79 5.47 L -4.76 5.11 C -6.78 7.51 -8 10.62 -8 13.99 C -8 18.41 -4.42 22 0 22 ` +
  `C 4.42 22 8 18.41 8 13.99 C 8 8.6 5.41 3.79 1.5 0.67 Z M -0.29 19 C -2.07 19 -3.51 17.6 -3.51 15.86 ` +
  `C -3.51 14.24 -2.46 13.1 -0.7 12.74 C 1.07 12.38 2.9 11.53 3.92 10.16 C 4.31 11.45 4.51 12.81 4.51 14.2 ` +
  `C 4.51 16.85 2.36 19 -0.29 19 Z' fill='${ACCENT}' stroke-opacity='0'/>\n` +
  `                </g>`;

const svg = `<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'
                style='isolation: isolate' viewBox='0 0 ${W} ${H}' width='${W}px' height='${H}px' direction='ltr'>
        <style>
            @keyframes currstreak {
                0% { font-size: 3px; opacity: 0.2; }
                80% { font-size: 34px; opacity: 1; }
                100% { font-size: 28px; opacity: 1; }
            }
            @keyframes fadein {
                0% { opacity: 0; }
                100% { opacity: 1; }
            }
        </style>
        <defs>
            <clipPath id='outer_rectangle'>
                <rect width='${W}' height='${H}' rx='4.5'/>
            </clipPath>
            <mask id='mask_out_ring_behind_fire'>
                <rect width='${W}' height='${H}' fill='white'/>
                <ellipse id='mask-ellipse' cx='247.5' cy='32' rx='13' ry='18' fill='black'/>
            </mask>
        </defs>
        <g clip-path='url(#outer_rectangle)'>
            <g style='isolation: isolate'>
                <rect stroke='${ACCENT}' fill='${BG}' rx='4.5' x='0.5' y='0.5' width='${W - 1}' height='${H - 1}'/>
            </g>
            <g style='isolation: isolate'>
                <line x1='165' y1='28' x2='165' y2='170' vector-effect='non-scaling-stroke' stroke-width='1' stroke='${ACCENT}' stroke-linejoin='miter' stroke-linecap='square' stroke-miterlimit='3'/>
                <line x1='330' y1='28' x2='330' y2='170' vector-effect='non-scaling-stroke' stroke-width='1' stroke='${ACCENT}' stroke-linejoin='miter' stroke-linecap='square' stroke-miterlimit='3'/>
            </g>
            <g style='isolation: isolate'>
                <!-- Total Contributions big number -->
                ${block(COL_X[0], 48, commas(total), { size: 28, fill: NUM, weight: 700, anim: 0.6 })}
                <!-- Total Contributions label -->
                ${block(COL_X[0], 84, "Total Contributions", { size: 14, fill: SIDE, anim: 0.7 })}
                <!-- Total Contributions range -->
                ${block(COL_X[0], 114, `${fmt(firstActive)} - Present`, { size: 12, fill: SIDE, anim: 0.8 })}
            </g>
            <g style='isolation: isolate'>
                <!-- Current Streak label -->
                ${block(COL_X[1], 108, "Current Streak", { size: 14, fill: ACCENT, weight: 700, anim: 0.9 })}
                <!-- Current Streak range -->
                ${block(COL_X[1], 145, fmtShort(current.end), { size: 12, fill: SIDE, ty: 21, anim: 0.9 })}
                <!-- Ring around number -->
                <g mask='url(#mask_out_ring_behind_fire)'>
                    <circle cx='247.5' cy='71' r='40' fill='none' stroke='${ACCENT}' stroke-width='5' style='opacity: 0; animation: fadein 0.5s linear forwards 0.4s'></circle>
                </g>
                <!-- Fire icon -->
                ${FIRE}
                <!-- Current Streak big number -->
                ${block(COL_X[1], 48, current.length, { size: 28, fill: NUM, weight: 700, anim: "currstreak" })}
            </g>
            <g style='isolation: isolate'>
                <!-- Longest Streak big number -->
                ${block(COL_X[2], 48, longest.length, { size: 28, fill: NUM, weight: 700, anim: 1.2 })}
                <!-- Longest Streak label -->
                ${block(COL_X[2], 84, "Longest Streak", { size: 14, fill: SIDE, anim: 1.3 })}
                <!-- Longest Streak range -->
                ${block(COL_X[2], 114, `${fmtShort(longest.start)} - ${fmtShort(longest.end)}`, { size: 12, fill: SIDE, anim: 1.4 })}
            </g>

        </g>
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
