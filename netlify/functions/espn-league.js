// netlify/functions/espn-league.js
export async function handler() {
  try {
    const { LEAGUE_ID, SEASON_ID, ESPN_S2, SWID } = process.env;
    if (!LEAGUE_ID || !ESPN_S2 || !SWID) {
      return json({ error: "Missing env vars. Set LEAGUE_ID, SEASON_ID (optional), ESPN_S2, SWID." }, 500);
    }
    const envSeason = SEASON_ID ? Number(SEASON_ID) : null;
    const fallbacks = [2025, 2024, 2023, 2022];
    const seasons = envSeason && !fallbacks.includes(envSeason) ? [envSeason, ...fallbacks] : [envSeason || 2025, ...fallbacks];

    const headers = {
      "Cookie": `swid=${SWID}; espn_s2=${ESPN_S2}`,
      "x-fantasy-source": "kona",
      "x-fantasy-platform": "kona-PROD-bundle-web",
      "accept": "application/json, text/plain, */*"
    };

    let league, seasonUsed = null, lastErr = null;
    for (const s of seasons) {
      try {
        const base = `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${s}/segments/0/leagues/${LEAGUE_ID}`;
        const resp = await fetch(`${base}?view=mTeam&view=mSettings&view=mStandings&view=mMembers`, { headers });
        if (!resp.ok) { lastErr = `status ${resp.status}`; continue; }
        league = await resp.json();
        seasonUsed = s;
        break;
      } catch (e) {
        lastErr = e.message;
      }
    }
    if (!league) {
      return json({ error: "ESPN fetch failed", detail: lastErr || "Unknown", triedSeasons: seasons }, 500);
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
    return json({ error: err.message || String(err) }, 500);
  }
}
function json(body, statusCode){ return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }; }
