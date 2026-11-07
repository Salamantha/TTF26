# TTF Accessible Route Finder — MCP server

An MCP server that finds accessible (wheelchair/crutches-safe) walking routes inside
the Salzburg Messe, lets anyone report obstacles (broken elevator, blocked ramp) live,
and tracks a leaderboard of accessible-route times so people can "race" the obstacle gap
to zero.

## What's here

- `app/api/mcp/route.ts` — the MCP server (5 tools, see below)
- `lib/venue.ts` — the venue graph (nodes/edges). **Mocked for the demo** — swap in real
  floorplan coordinates/distances when you have them.
- `lib/routing.ts` — Dijkstra shortest path, with an accessible-mode filter
- `lib/store.ts` — obstacle state + leaderboard. In-memory by default; set the Upstash
  env vars below to persist across cold starts during the live demo.
- `app/map` + `app/api/venue-graph` — a plain SVG map page the tool links to, so you can
  click through and show the live route/obstacles on screen.

## Tools exposed

| Tool | Purpose |
|---|---|
| `find_accessible_route` | Route between two named points, accessible or fastest, with obstacle-aware rerouting, the accessible-vs-fastest time gap, and a map link |
| `report_obstacle` | Mark a segment (elevator/ramp/etc.) blocked or clear — rerouting updates immediately |
| `list_obstacles` | See everything currently reported blocked |
| `get_leaderboard` | Best recorded accessible-route time for a path |
| `log_attempt` | Submit a completed time for the leaderboard/"race" mechanic |

## Run locally

```bash
npm install
npm run dev
# MCP endpoint: http://localhost:3000/api/mcp
# Inspect it:   npm run inspect
```

## Deploy to Vercel

```bash
npx vercel deploy --prod
```

Then set an env var so the map links the tool returns point at the real deployment
instead of localhost:

```
APP_BASE_URL=https://<your-deployment>.vercel.app
```

(Vercel also sets `VERCEL_URL` automatically, which the server falls back to — but
setting `APP_BASE_URL` explicitly avoids surprises if you're on a preview URL.)

### Optional: persistent obstacles/leaderboard

Without this, obstacle reports and the leaderboard live in memory and reset on a
serverless cold start (fine for a quick local demo, risky for a multi-hour hackathon
booth). Create a free [Upstash Redis](https://upstash.com) database and set:

```
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

`lib/store.ts` picks these up automatically — no code changes needed.

## Connect it to ChatGPT

OpenAI retired the old "ChatGPT plugin" manifest format — ChatGPT now talks MCP
directly via **Developer Mode connectors**:

1. In ChatGPT: **Settings → Apps & Connectors → Advanced → Developer mode** (enable it).
2. **Settings → Connectors → Create** (or the "+" in a chat's tool picker).
3. Name it, paste your MCP endpoint: `https://<your-deployment>.vercel.app/api/mcp`.
4. ChatGPT discovers the 5 tools automatically — no OpenAPI schema needed.
5. In a new chat, enable the connector and ask something like *"find me an accessible
   route from the west entrance to Halle 2 at the Salzburg Messe"*.
6. If you redeploy, hit **Refresh** on the connector — tool metadata is cached at
   connection time.

Any other MCP-aware client (Claude, Cursor, etc.) works the same way by pointing at
the same `/api/mcp` URL.

## Known shortcuts (intentional, for hackathon scope)

- Venue graph is a small hand-authored mock, not real indoor GPS/floorplan data.
- The map is a self-drawn SVG (no tile/floorplan image dependency — safer for a live
  demo on conference wifi).
- No auth on the MCP endpoint — fine for a demo, add `withMcpAuth` from `mcp-handler`
  before using this for anything real.
