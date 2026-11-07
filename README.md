# TTF Accessible Route Finder — MCP server

An MCP server that finds accessible (wheelchair/crutches-aware) walking routes inside
the Salzburg Messe, compares them against the fastest non-accessible route to surface
the time gap, lets anyone report obstacles live, and tracks a leaderboard so people can
"race" that gap toward zero. Route estimates are a hackathon prototype, not a verified
accessibility survey — see the disclaimer baked into every `find_accessible_route` response.

## What's here

- `app/api/mcp/route.ts` — the MCP server (5 tools, see below) plus the `ui://widget/route-map.html`
  resource used by the ChatGPT Apps SDK inline widget
- `lib/venue.ts` — the venue graph (nodes/edges) with fuzzy name matching (`findNode`/`findEdge`).
  **Mocked for the demo** — swap this out for validated floorplan-derived routing data when available.
- `lib/routing.ts` — Dijkstra shortest path, with an accessible-mode filter
- `lib/store.ts` — obstacle state + leaderboard. In-memory by default; set the Upstash
  env vars below to persist across cold starts during the live demo.
- `lib/widget.ts` — the self-contained HTML/JS for the inline ChatGPT widget (reads the
  whole route+graph from `structuredContent`, no network call from the iframe)
- `app/map` + `app/api/venue-graph` — a standalone map page (SVG route graph next to the
  real venue floor-plan reference) for clients that don't render the inline widget

## Venue floor-plan prototype

The map page now includes a simplified visual extracted from the supplied venue map
generation project: hall outlines and labels, rendered as a static SVG at
`public/venue-floorplan-prototype.svg`.

**Prototype limitations — do not treat this as live navigation yet:**

- The floor-plan image and the route graph are shown separately — the route graph is
  still hand-authored and not spatially aligned to the floor-plan geometry.
- Route times/distances are a hand-authored demo estimate, not a verified accessibility
  survey (see the disclaimer `find_accessible_route` returns on every call).
- The supplied source is a single-floor dataset. It is not sufficient for multi-floor
  navigation.
- Reuse is prototype-only and subject to the venue/data provider's terms. Confirm
  explicit permission for public redistribution and production use before promoting
  this asset beyond the prototype.

Next integration step: replace the hand-authored demo graph with the supplied floor-plan walking graph and align its coordinates to the SVG. Once the walking prototype is stable, mark and verify edge attributes for accessibility.

## Tools exposed

| Tool | Purpose |
|---|---|
| `find_accessible_route` | Route between two named points, accessible or fastest, with obstacle-aware rerouting, the accessible-vs-fastest time gap, a map link, and (in ChatGPT) an inline rendered map widget |
| `report_obstacle` | Mark a segment (elevator/ramp/etc.) blocked or clear — rerouting updates immediately |
| `list_obstacles` | See everything currently reported blocked |
| `get_leaderboard` | Best recorded accessible-route time for a path |
| `log_attempt` | Submit a completed time for the leaderboard/"race" mechanic |

## The inline ChatGPT widget

`find_accessible_route`'s tool descriptor sets `_meta["openai/outputTemplate"]` (and the
MCP-Apps-standard `_meta.ui.resourceUri`) to `ui://widget/route-map.html`, a resource
registered alongside the tools. In a ChatGPT client that supports the Apps SDK, this
renders the route directly inside the chat bubble instead of requiring a click-through
to `/map`. The widget is fully self-contained — the tool's `structuredContent` carries
the whole venue graph, the obstacle list, and the route, so the sandboxed widget iframe
never needs to fetch anything.

The exact mechanism ChatGPT uses to deliver tool output to the widget is inconsistently
documented across sources at the time of writing, so `lib/widget.ts` listens for all of
them defensively (`window.openai.toolOutput` read directly, the `openai:set_globals`
event, the raw `ui/notifications/tool-result` postMessage, and a short poll as a last
resort). If the widget doesn't render in your ChatGPT build, the tool's text response
still includes a `/map` link as a fallback — the demo doesn't depend on the widget working.

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
