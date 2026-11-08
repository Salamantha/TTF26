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
- Stairs count as ~20 m of walking, a lift (wait + ride) as ~48 m. "Lift Mitte" is left out because
  no photo confirms it; Lift Ost and Treppe Lounge Ost were seen but their positions are estimated.
- **Mobility profiles** (from team-05): walking 1.34 m/s · cane/crutches 0.8 m/s, stairs 3× as costly ·
  wheelchair 0.9 m/s, no stairs, needs more room in crowds.
- **Visitor density is simulated** (team-05's crowd model in `lib/crowd.ts`: hotspots at entrances,
  stages, food, WCs, the hackathon buffet…). Routes avoid dense spots by default; the widget can show
  the heatmap. Server and widget share one clock (2 s real = 20 s simulated), so both show the same state.

Places the tools understand: halls and foyers, the TTF Hackathon / Tagungsraum 4-8 / Tisch 1-18,
stairs and lifts by name, exhibitor names, booth codes (e.g. `A-0212`), exhibitor categories
("ice cream" → the nearest "Eis" specialist, also wine, cheese, desserts, coffee machines…; English
words are mapped to the German categories in `CATEGORY_SYN`), and venue services: food, coffee,
toilet, accessible toilet, info, cloakroom, first aid, ATM, tickets, entrance. When the destination
is a stand, the answer and the widget show the exhibitor, categories, "why visit" text, website and
other stands in the same category.

## Code

- `app/api/mcp/route.ts` — the MCP server (tools below) and the `ui://widget/route-map-3d-v7.html` widget resource
- `lib/venue.ts` — data loading, the combined EG + OG graph, place lookup (`findPlace`)
- `lib/og.ts` — the 1. OG floor and its stairs/lifts
- `lib/routing.ts` — Dijkstra router (ported from team-05): blocked nodes, stairs factor per profile, crowd factor
- `lib/crowd.ts` — simulated visitor density, shared by server and widget
- `lib/plan.ts` — plans the profile's route plus fastest vs step-free for the comparison, adds record and lift confirmations
- `widget/map3d.ts` — the interactive 3D map (three.js scene ported from team-05's `Map3D.tsx`): halls,
  booths, the 1. OG with steps and lift shafts, route tubes, click a booth to see its exhibitors
- `scripts/build-widget.mjs` — bundles `widget/map3d.ts` with three.js into `lib/widget-bundle.generated.ts`
  (gitignored; runs automatically before `npm run dev` and `npm run build`)
- `lib/widget.ts` — the widget HTML: venue geometry embedded once, plus the bundle and the text panel
- `lib/brand.ts` — TacticalNewt look shared by both widgets: black/yellow light and dark theme tokens, the newt logo
  (inlined from `assets/newt-192.png`, a downscaled `tactical_newt.png`) and the footprint icon
- `lib/store.ts` — obstacles, "confirmed working" times and leaderboards (Neon Postgres, or memory when not configured)
- `app/map/route.ts` — the same widget as a standalone page, buttons included: `/map?from=entrance&to=TTF%20Hackathon&mobility=wheelchair` (add `&heat` to start with the heatmap on)

## Tools

| Tool | Purpose |
|---|---|
| `find_accessible_route` | Route (optionally from a map point, `fromPoint`, used for detours) for a mobility profile (`walk` default, `cane`, `wheelchair`), optionally avoiding crowds, with fastest vs step-free comparison, record and the 3D widget |
| `search_places` | Resolve an unclear place name and list close matches |
| `report_obstacle` | Mark a place blocked (for everyone, or only wheelchair users, e.g. a broken lift), or `clear` = works / confirmed working |
| `list_obstacles` | All current obstacles as fixed cards (who it affects, where, when) with a map, in its own widget (`ui://widget/obstacles-v3.html`, also at `/obstacles`) |
| `report_deviation` | Someone left the planned route: which part, why (shorter / blocked / more accessible / lost), where they are; stored in `ttf_deviations` for organisers |
| `clear_obstacle` | Mark an obstacle (by id, incl. map-marked areas) as resolved; the "Cleared" button in the obstacles widget |
| `get_leaderboard` | Fastest times for a route and profile |
| `log_attempt` | Submit a race time with optional per-part splits; faster ones replace the record (no minimum time) |
| `mark_obstacle_area` | Save an obstacle at a point on the map (orange area, radius in m, floor) that routing avoids |

## Demo script

1. "Timo is on crutches, how does he get from the entrance to the TTF Hackathon?" → ChatGPT sums up the gap in a
   sentence; the widget shows the route in 3D and "+57 s · Can you close the gap?" with stairs vs step-free bars.
2. **Start** turns the widget into step-by-step navigation: the camera follows the current part (Foyer 1 → Foyer 10 →
   Lift → 1. OG corridor → Tagungsraum), **Next** records a split per part like a speedrun (best splits are kept).
3. Right after the lift: "Was Lift West working?" (one tap). On any part: **Obstacle here** → describe it, tap the spot
   on the 2D map → saved as an orange area that routes avoid.
4. At the end: your time vs the stairs route, save it to the leaderboard (collapsed under the gap card).

## The widget

`find_accessible_route` sets `_meta["openai/outputTemplate"]` and `_meta.ui.resourceUri` to
`ui://widget/route-map-3d-v7.html`. Overview: mobility switch, 3D map (heatmap, avoid crowds), the gap card with
**Start**, a collapsed leaderboard and **Report obstacle**. Navigation: total timer, current part with live split vs
best/planned, **Next**, targeted questions, split list. Buttons call the tools through `window.openai.callTool` (on
`/map` a small stand-in calls `/api/mcp`); a running navigation survives reloads via `setWidgetState`. The tool's text
answer gives ChatGPT the facts and asks it to summarize the gap in one or two sentences, so the widget can stay
almost text-free.

The widget is one HTML document (~1 MB, mostly three.js) that ChatGPT loads once per connector refresh; each result
carries only the route data (a few KB). Change the URI whenever the widget changes, or ChatGPT keeps showing the
cached old one.

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

**Database (needed for records and reports to survive cold starts):** Neon Postgres, added through
Vercel → Storage → Neon and connected to this project. The integration sets `DATABASE_URL`, which
`lib/store.ts` reads (`POSTGRES_URL` works too); the tables `ttf_obstacles`, `ttf_confirmations` and
`ttf_attempts` are created on first use. Redeploy after connecting so the function sees the variable.
Without it everything is kept in memory and the widget's record card says so.

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
