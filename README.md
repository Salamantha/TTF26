# TTF Accessible Route Finder — MCP server

An MCP server prototype that finds ordinary walking routes inside the Salzburg Messe demo graph, lets users report blocked segments, and records route times. Accessibility is deliberately out of scope for this first running prototype.

## What's here

- `app/api/mcp/route.ts` — the MCP server (5 tools, see below)
- `lib/venue.ts` — the venue graph (nodes/edges). **Mocked for the demo** — swap this out
  for validated floorplan-derived routing data when available.
- `lib/routing.ts` — Dijkstra shortest path, using ordinary walking edges only
- `lib/store.ts` — obstacle state + leaderboard. In-memory by default; set the Upstash
  env vars below to persist across cold starts during the live demo.
- `app/map` + `app/api/venue-graph` — map page with a prototype venue-floorplan reference
  and the current demo routing graph.

## Venue floor-plan prototype

The map page now includes a simplified visual extracted from the supplied venue map
generation project: hall outlines and labels, rendered as a static SVG at
`public/venue-floorplan-prototype.svg`.

**Prototype limitations — do not treat this as live navigation yet:**

- The floor-plan image and the route graph are shown separately. The existing route
  graph is still hand-authored and is not spatially aligned to the floor-plan geometry.
- The current route graph is still a hand-authored demo graph and is not spatially aligned with the floor-plan reference. Accessibility has not been assessed and must not be inferred from route results.
- The supplied source is a single-floor dataset. It is not sufficient for multi-floor
  navigation.
- Reuse is prototype-only and subject to the venue/data provider's terms. Confirm
  explicit permission for public redistribution and production use before promoting
  this asset beyond the prototype.

Next integration step: replace the hand-authored demo graph with the supplied floor-plan walking graph and align its coordinates to the SVG. Once the walking prototype is stable, mark and verify edge attributes for accessibility.

## Tools exposed

| Tool | Purpose |
|---|---|
| `find_walking_route` | Route between two named points, ordinary walking, with obstacle-aware rerouting, the route time, and a map link |
| `report_obstacle` | Mark a segment (elevator/ramp/etc.) blocked or clear — rerouting updates immediately |
| `list_obstacles` | See everything currently reported blocked |
| `get_leaderboard` | Best recorded walking-route time for a path |
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

ChatGPT supports MCP connections through its app/connector workflows. Availability
and write-action support depend on plan and workspace settings; check the current
ChatGPT interface and OpenAI documentation before relying on a particular setup.

Any other MCP-aware client (Claude, Cursor, etc.) works the same way by pointing at
the same `/api/mcp` URL.

## Known shortcuts (intentional, for hackathon scope)

- The current routing graph is a small hand-authored mock, not real indoor routing data.
- The supplied floor-plan visual is prototype-only and not yet connected to route geometry.
- No auth on the MCP endpoint — fine for a controlled demo, but add authentication and
  appropriate write protections before exposing it to wider use.
- Confirm dataset attribution, redistribution rights, and production-use terms before
  any wider release.
