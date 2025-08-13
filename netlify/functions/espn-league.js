// netlify/functions/espn-league.js
export async function handler() {
  try {
    const { LEAGUE_ID, SEASON_ID, ESPN_S2, SWID } = process.env;
    if (!LEAGUE_ID || !ESPN_S2 || !SWID) {
      return json({ error: "Missing env vars. Set LEAGUE_ID, SEASON_ID (optional), ESPN_S2, SWID." }, 500);
    }

    const envSeason = SEASON_ID ? Number(SEASON_ID) : null;
    const fallbacks = [2025, 2024, 2023, 2022];
    const seasons = Array.from(new Set([envSeason || 2025, ...fallbacks]));

    // ESPN is picky about casing and headers
    const baseHeaders = {
      "Cookie": `SWID=${SWID}; espn_s2=${ESPN_S2}`,
      "accept": "application/json, text/plain, */*",
      "referer": "https://fantasy.espn.com/",
      "origin": "https://fantasy.espn.com",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "x-fantasy-source": "kona",
      "x-fantasy-platform": "kona-PROD-bundle-web"
    };

    let league = null;
    let seasonUsed = null;
    let lastDetail = null;

    for (const s of seasons) {
      try {
        const url = `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${s}/segments/0/leagues/${LEAGUE_ID}?view=mTeam&view=mMembers&view=mSettings`;

        // First, detect redirects (login, region, etc.)
        const headResp = await fetch(url, { headers: baseHeaders, redirect: "manual" });
        if (headResp.status >= 300 && headResp.status < 400) {
          const loc = headResp.headers.get("location") || "";
          lastDetail = `Redirected (${headResp.status}) to: ${loc.slice(0,180)}`;
          continue; // Try next season or report later
        }

        // Then fetch content (allow default redirects in case manual didn't trigger)
        const resp = await fetch(url, { headers: baseHeaders });
        const text = await resp.text();

        if (!resp.ok) {
          lastDetail = `HTTP ${resp.status}: ${text.slice(0,200)}`;
          continue;
        }
        try {
          league = JSON.parse(text);
          seasonUsed = s;
          break;
        } catch {
          lastDetail = `Non-JSON body (likely login/HTML): ${text.slice(0,200)}`;
          continue;
        }
      } catch (e) {
        lastDetail = e?.message || String(e);
      }
    }

    if (!league) {
      return json({ error: "ESPN fetch failed", detail: lastDetail, triedSeasons: seasons }, 500);
    }

    const members = Object.fromEntries(
      (league.members || []).map(m => [m.id, m.displayName || m.firstName || "Manager"])
    );

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
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  };
}
