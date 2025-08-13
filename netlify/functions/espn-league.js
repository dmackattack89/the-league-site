// netlify/functions/espn-league.js
export async function handler() {
  try {
    const { LEAGUE_ID, SEASON_ID, ESPN_S2, SWID } = process.env;
    if (!LEAGUE_ID || !ESPN_S2 || !SWID) {
      return json({ error: "Missing env vars. Set LEAGUE_ID, SEASON_ID (optional), ESPN_S2, SWID." }, 500);
    }

    const envSeason = SEASON_ID ? Number(SEASON_ID) : null;
    const seasons = Array.from(new Set([envSeason || 2025, 2024, 2023, 2022]));

    // ESPN is picky: SWID must be uppercase key, cookies exact, and browser-y headers help.
    const headers = {
      "Cookie": `SWID=${SWID}; espn_s2=${ESPN_S2}`,
      "accept": "application/json, text/plain, */*",
      "referer": "https://fantasy.espn.com/",
      "origin": "https://fantasy.espn.com",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "x-fantasy-source": "kona",
      "x-fantasy-platform": "kona-PROD-bundle-web"
    };

    // Try primary API host, then read-only host as a fallback if we see a redirect or non-JSON.
    const hosts = [
      "https://fantasy.espn.com",
      "https://lm-api-reads.fantasy.espn.com"   // often works when the main host redirects
    ];

    let league = null, seasonUsed = null, lastDetail = null;

    for (const s of seasons) {
      for (const host of hosts) {
        try {
          const url = `${host}/apis/v3/games/ffl/seasons/${s}/segments/0/leagues/${LEAGUE_ID}?view=mTeam&view=mMembers&view=mSettings`;

          // Check for redirect without following it, so we can see where it points
          const headResp = await fetch(url, { headers, redirect: "manual" });
          if (headResp.status >= 300 && headResp.status < 400) {
            lastDetail = `Redirected (${headResp.status}) from ${host} to: ${(headResp.headers.get("location") || "").slice(0, 180)}`;
            continue; // Try next host or season
          }

          const resp = await fetch(url, { headers });
          const text = await resp.text();

          if (!resp.ok) {
            lastDetail = `HTTP ${resp.status} from ${host}: ${text.slice(0, 200)}`;
            continue;
          }
          try {
            league = JSON.parse(text);
            seasonUsed = s;
            break;
          } catch {
            lastDetail = `Non-JSON body from ${host}: ${text.slice(0, 200)}`;
            continue;
          }
        } catch (e) {
          lastDetail = `Fetch error at host: ${e?.message || String(e)}`;
        }
      }
      if (league) break;
    }

    if (!league) {
      return json({ error: "ESPN fetch failed", detail: lastDetail, triedSeasons: seasons }, 500);
    }

    const members = Object.fromEntries((league.members || []).map(m => [m.id, m.displayName || m.firstName || "Manager"]));
    const teams = (league.teams || []).map(t => ({
      id: t.id,
      name: t.location && t.nickname ? `${t.location} ${t.nickname}` : (t.name || `Team ${t.id}`),
      logo: t.logo || null,
      owner: members[t.primaryOwner] || (t.owners && members[t.owners[0]]) || ""
    }));

    return json({ meta: { leagueName: league.settings?.name || "Fantasy League", season: seasonUsed }, teams }, 200);
  } catch (err) {
    return json({ error: err?.message || String(err) }, 500);
  }
}
function json(body, statusCode) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
