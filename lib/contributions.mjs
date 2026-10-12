/**
 * Daily contribution counts, read from GitHub's own GraphQL API.
 *
 * This replaces https://github-contributions-api.jogruber.de, which both of the
 * card generators used to call. That service is a third-party cache in front of
 * the same data and it broke the streak card: it ignores the `from`/`to`
 * parameters it is given (it answers with every year it knows, in descending
 * date order, including future days), and the copy it serves lags GitHub's own
 * graph, so the current day is often still missing at the time the daily run
 * fires. `generate-streak.mjs` anchors the streak on today, so a lagging
 * "today" of 0 read as "streak broken" and the run aborted instead of updating
 * the card. The 3D graph was unaffected only because it asks for a whole year
 * and never looks at today.
 *
 * GraphQL caps `from`..`to` at one year, so the window is walked one calendar
 * year at a time and the days are merged.
 *
 * Requires a token that may read the user's contributions. In Actions that is
 * the automatically provided `GITHUB_TOKEN`; no PAT or repository secret is
 * needed.
 */

const ENDPOINT = "https://api.github.com/graphql";

const QUERY = `query ($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            date
            contributionCount
          }
        }
      }
    }
  }
}`;

function token() {
  const t = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!t) throw new Error("set GITHUB_TOKEN (or GH_TOKEN) to read contributions");
  return t;
}

async function window(login, from, to, auth) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `bearer ${auth}`,
      "Content-Type": "application/json",
      "User-Agent": "donyelqt-profile-cards",
    },
    body: JSON.stringify({
      query: QUERY,
      variables: { login, from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` },
    }),
  });

  if (!res.ok) throw new Error(`contributions fetch failed: ${res.status}`);

  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`contributions query failed: ${json.errors[0].message}`);
  }

  const cal = json.data?.user?.contributionsCollection?.contributionCalendar;
  if (!cal) throw new Error("contributions response missing contributionCalendar");

  const days = [];
  for (const week of cal.weeks) {
    for (const day of week.contributionDays) {
      days.push([day.date, day.contributionCount]);
    }
  }
  return days;
}

/**
 * Contribution counts per day across `since`..`to`, inclusive.
 *
 * @returns {Promise<Map<string, number>>} ISO day -> contribution count. Every
 *   day in the window is present, including the ones with no contributions.
 */
export async function fetchContributions(login, since, to) {
  const auth = token();

  // Clamp to whole days: the caller passes ISO dates, and the window is walked
  // in calendar years because that is the largest span GraphQL accepts.
  const firstYear = Number(since.slice(0, 4));
  const lastYear = Number(to.slice(0, 4));
  if (!firstYear || !lastYear) throw new Error(`bad window: ${since}..${to}`);

  const counts = new Map();
  for (let year = firstYear; year <= lastYear; year++) {
    const from = year === firstYear ? since : `${year}-01-01`;
    const end = year === lastYear ? to : `${year}-12-31`;
    if (from > end) continue;

    // A single request can be refused transiently; the daily run is unattended,
    // so a couple of quick retries keeps a blip from freezing the card.
    let days = null;
    let lastError = null;
    for (let attempt = 0; attempt < 3 && days === null; attempt++) {
      try {
        days = await window(login, from, end, auth);
      } catch (err) {
        lastError = err;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    if (days === null) throw lastError;

    for (const [date, count] of days) counts.set(date, count);
  }

  // GitHub pads the calendar to whole weeks, so the response can reach past
  // `to` and past `since`. Keep only the window that was asked for.
  for (const date of [...counts.keys()]) {
    if (date < since || date > to) counts.delete(date);
  }

  return counts;
}