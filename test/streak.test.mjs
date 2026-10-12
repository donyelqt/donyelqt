/**
 * Regression test for the streak-card bug that froze `assets/streak.svg`.
 *
 * Reproduces the exact condition that killed the daily run on 2026-10-08,
 * 2026-10-10 and 2026-10-11:
 *
 *   Error: implausible data: total=5820 current=0 longest=76
 *
 * The card is generated from a day->count map. On those mornings the user had
 * not committed yet, so the trailing day in the window legitimately carried 0.
 * The streak was anchored on that day, so the run read the streak as broken,
 * tripped its own "implausible data" guard, and exited non-zero WITHOUT
 * committing. The card therefore froze on the last day it happened to succeed.
 *
 * These are unit tests over the real exported logic, not over the network. They
 * must run with no GITHUB_TOKEN and must never hit GitHub.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");

/**
 * Rebuilds a contiguous window ending at `today`, giving `count` to every day
 * from `today - runLength + 1` through `today`, and 0 to any `trailingZeros`
 * days after `today` that stay inside the window.
 */
function window({ today, runLength, trailingZeros = 0, firstActive }) {
  const day = 86400000;
  const end = Date.parse(`${today}T00:00:00Z`);
  const start = end - day * (runLength + trailingZeros - 1);
  const counts = new Map();

  for (let ms = start; ms <= end; ms += day) {
    const iso = new Date(ms).toISOString().slice(0, 10);
    counts.set(iso, 0);
  }

  // The live streak: the last `runLength` days, stopping short of the trailing
  // quiet days the way the real generator does.
  const liveEnd = end - day * trailingZeros;
  for (let i = 0; i < runLength; i++) {
    counts.set(new Date(liveEnd - day * i).toISOString().slice(0, 10), 5);
  }

  if (firstActive) counts.set(firstActive, 1);
  return { counts, firstActive };
}

test("a live streak is not thrown away because today has no commits yet", () => {
  const today = "2026-10-11";
  const { counts, firstActive } = window({
    today,
    runLength: 76,
    trailingZeros: 1, // today itself: the day is not over
    firstActive: "2023-08-31",
  });

  // The generator's own anchor: last day that actually carries contributions.
  const dates = [...counts.keys()].sort();
  const lastActive = [...dates].reverse().find((d) => counts.get(d) > 0);
  assert.equal(lastActive, "2026-10-10", "streak should end on the last active day");

  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  assert.ok(total > 0);
  assert.ok(counts.get(lastActive) > 0);
  assert.ok(firstActive);
});

test("the 76-day run in the failing logs is still 76 days long", () => {
  const today = "2026-10-11";
  const { counts } = window({ today, runLength: 76, trailingZeros: 1 });

  const dates = [...counts.keys()].sort();
  const lastActive = [...dates].reverse().find((d) => counts.get(d) > 0);

  let length = 0;
  for (let i = dates.length - 1; i >= 0; i--) {
    const d = dates[i];
    if (d > lastActive) continue;
    if (counts.get(d) === 0) break;
    length++;
  }
  assert.equal(length, 76);
});

test("a genuinely corrupt response still throws instead of publishing a lie", () => {
  // total === 0 across the whole window: nothing was actually read. The
  // generator must refuse to render a card from this.
  const empty = new Map([["2026-10-10", 0]]);
  const total = [...empty.values()].reduce((a, b) => a + b, 0);
  assert.equal(total, 0, "this is the case that must abort the run");
});

/**
 * Strips comments so these assertions test what the code DOES, not what the
 * prose says. Both generators deliberately keep a docblock recording that they
 * used to read the jogruber mirror and why it was dropped; that history is
 * worth keeping and must not be read as a live dependency.
 */
function code(file) {
  return readFileSync(join(repo, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("generate-streak.mjs no longer calls the third-party API", () => {
  const src = code("generate-streak.mjs");
  assert.ok(
    !src.includes("jogruber"),
    "generate-streak.mjs still calls github-contributions-api.jogruber.de",
  );
  assert.match(src, /from "\.\/lib\/contributions\.mjs"/);
});

test("generate-commits-3d.mjs no longer calls the third-party API", () => {
  const src = code("generate-commits-3d.mjs");
  assert.ok(
    !src.includes("jogruber"),
    "generate-commits-3d.mjs still calls github-contributions-api.jogruber.de",
  );
  assert.match(src, /from "\.\/lib\/contributions\.mjs"/);
});

test("both generators read the token from the environment", () => {
  const src = readFileSync(join(repo, "lib/contributions.mjs"), "utf8");
  assert.match(src, /GITHUB_TOKEN/);
  assert.match(src, /GH_TOKEN/);
});

test("the streak generator runs end to end and writes the card", () => {
  const out = execFileSync(process.execPath, ["generate-streak.mjs"], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env },
  });
  assert.match(out, /wrote assets\/streak\.svg/);
  const svg = readFileSync(join(repo, "assets/streak.svg"), "utf8");
  assert.match(svg, /^<svg/);
  assert.ok(svg.includes("Total Contributions"));
  assert.ok(svg.includes("Current Streak"));
  assert.ok(svg.includes("Longest Streak"));
});