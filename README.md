# TTF Accessible Route Finder — MCP server

An MCP server that plans step-free walking routes inside the Messezentrum Salzburg, shows
them on a map inside ChatGPT, compares them with the fastest route (stairs allowed) to
surface the time gap, lets anyone report obstacles live, and keeps a leaderboard so people
can "race" that gap toward zero. Route estimates are a hackathon prototype, not a verified
accessibility survey; every `find_accessible_route` response says so.

## Venue data

- **Ground floor (EG):** halls, booths, POIs and the walking graph (2,859 nodes) from the
  tly wayfinder export that team-05 prepared (`team-05/frontend-starter/public/data/app.json`),
  trimmed into `data/venue.json`. Regenerate it with
  `node scripts/import-team05.mjs [path/to/app.json]`.
- **1. OG of Foyer 10 (TTF Hackathon):** Tagungsräume 4-8, the 18 team tables, WCs, snack
  zone, and the stairs and lifts, ported from team-05's `levels.ts` (digitised from the
  organiser's event plan, checked against on-site photos). See `lib/og.ts`.
- Stairs count as ~20 m of walking, a lift (wait + ride) as ~48 m. The step-free route never
  uses stairs, which is where the gap comes from. "Lift Mitte" is left out because no photo
  confirms it; Lift Ost and Treppe Lounge Ost were seen but their positions are estimated.

Places the tools understand: halls and foyers, the TTF Hackathon / Tagungsraum 4-8 / Tisch 1-18,
stairs and lifts by name, exhibitor names, booth codes (e.g. `A-0212`), exhibitor categories
("ice cream" → the nearest "Eis" specialist, also wine, cheese, desserts, coffee machines…; English
words are mapped to the German categories in `CATEGORY_SYN`), and venue services: food, coffee,
toilet, accessible toilet, info, cloakroom, first aid, ATM, tickets, entrance. When the destination
is a stand, the answer and the widget show the exhibitor, categories, "why visit" text, website and
other stands in the same category.

## Code

- `app/api/mcp/route.ts` — the MCP server (tools below) and the `ui://widget/route-map-v2.html` widget resource
- `lib/venue.ts` — data loading, the combined EG + OG graph, place lookup (`findPlace`)
- `lib/og.ts` — the 1. OG floor and its stairs/lifts
- `lib/routing.ts` — Dijkstra router (ported from team-05) with blocked nodes for obstacles
- `lib/plan.ts` — plans a route and its stairs alternative, builds the widget data
- `widget/map3d.ts` — the interactive 3D map (three.js scene ported from team-05's `Map3D.tsx`): halls,
  booths, the 1. OG with steps and lift shafts, route tubes, click a booth to see its exhibitors
- `scripts/build-widget.mjs` — bundles `widget/map3d.ts` with three.js into `lib/widget-bundle.generated.ts`
  (gitignored; runs automatically before `npm run dev` and `npm run build`)
- `lib/widget.ts` — the widget HTML: venue geometry embedded once, plus the bundle and the text panel
- `lib/store.ts` — obstacles + leaderboard (in memory, or Upstash Redis when configured)
- `app/map/route.ts` — the same widget as a standalone page: `/map?from=entrance&to=TTF%20Hackathon&accessible=true`

## Tools

| Tool | Purpose |
|---|---|
| `find_accessible_route` | Route between two places, step-free (default) or fastest, with the stairs-vs-step-free gap and an inline map |
| `search_places` | Resolve an unclear place name and list close matches |
| `report_obstacle` | Mark a place blocked (for everyone, or only for wheelchair users, e.g. a broken lift) or clear again |
| `list_obstacles` | Everything currently reported blocked |
| `get_leaderboard` | Best recorded accessible-route time for a path |
| `log_attempt` | Submit a completed time for the leaderboard |

## Demo script

1. "Find an accessible route from the entrance to the TTF Hackathon" → step-free via Lift West, about 2m 19s; the stairs route via Treppe Nord takes about 1m 20s, a 59 s gap.
2. "Lift West is out of service" → `report_obstacle` (affects: wheelchair); asking again reroutes via Lift Ost.
3. "Lift West works again" → cleared.
4. "Timo made it in 2:30" → `log_attempt` sets the record the next person races.

## The inline ChatGPT widget

`find_accessible_route` sets `_meta["openai/outputTemplate"]` and `_meta.ui.resourceUri` to
`ui://widget/route-map-3d-v1.html`. The widget is one HTML document (~1 MB, mostly three.js) that
ChatGPT loads once per connector refresh; each tool result's `structuredContent` (a few KB) carries
only the route and stand info, so nothing is fetched from inside the widget iframe. Change the URI
whenever the widget changes, or ChatGPT keeps showing the cached old one. Because the delivery mechanism
is documented inconsistently, the widget reads `window.openai.toolOutput`, listens for
`openai:set_globals` and the `ui/notifications/tool-result` message, and polls briefly. If the
widget doesn't render, the text answer still includes a `/map` link.

## Run locally

```bash
npm install
npm run dev
# MCP endpoint: http://localhost:3000/api/mcp
# Inspect it:   npm run inspect
```

## Deploy

Pushing to `main` deploys on Vercel. Set `APP_BASE_URL=https://<your-domain>` so map links point
at production (otherwise it falls back to Vercel's production URL).

For obstacle reports and the leaderboard to survive serverless cold starts, create a free
[Upstash Redis](https://upstash.com) database and set `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN`.

## Connect it to ChatGPT

Add the connector with your `https://<your-domain>/api/mcp` URL. **After every deploy that
changes tools, press Refresh on the connector**: ChatGPT caches the tool list and widget
template when the connection is created, and calls tools that no longer exist (e.g.
`Tool find_walking_route not found`) until you refresh. Start a new chat afterwards, since old
chats remember old place names.

## Known shortcuts (hackathon scope)

- The 1. OG geometry and the stair/lift costs are estimates.
- Only the ground floor and the 1. OG of Foyer 10 are mapped.
- No auth on the MCP endpoint; add authentication before exposing write tools more widely.
- The venue data comes from the event's wayfinder; confirm the terms before any use beyond the hackathon.
