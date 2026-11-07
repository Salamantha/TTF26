// Route map widget for ChatGPT (Apps SDK ui:// resource) and the /map page: an interactive 3D venue
// (widget/map3d.ts, bundled with three.js) plus a text panel. The static venue geometry is embedded once;
// each tool result only carries the route (WidgetData from lib/plan.ts).
import { VENUE, OG, EXHIBITORS_BY_SPACE } from "./venue";
import { CONNECTORS, OG_AREAS, OG_TABLES, OG_ELEVATION, OG_ROOM_H } from "./og";
import { WIDGET_JS } from "./widget-bundle.generated";

export const ROUTE_MAP_WIDGET_URI = "ui://widget/route-map-3d-v1.html";

// Approximate outer hall heights in metres, from team-05's Map3D.
const HALL_HEIGHTS: Record<string, number> = {
  "Halle 1": 12, "Halle 2": 8.5, "Halle 3": 8.5, "Halle 4": 8, "Halle 5": 8.5, "Halle 6": 8.5, "Halle 7": 9,
  "Halle 8": 9, "Halle 9": 9, "Halle 10": 12.5, "Foyer 10": 10, "Foyer 1": 12, "Foyer 3": 7,
};

const venue3d = {
  halls: VENUE.halls
    .filter((h) => h.poly && h.poly.length > 2)
    .map((h) => ({ name: h.name, poly: h.poly, label: h.label, h: h.name ? HALL_HEIGHTS[h.name] ?? 8 : 10 })),
  booths: VENUE.spaces
    .filter((s) => s.poly && (s.kind === "booth" || s.kind === "stage"))
    .map((s) => ({
      id: s.id,
      poly: s.poly,
      code: s.code,
      kind: s.kind,
      color: s.color,
      label: s.label,
      ex: (EXHIBITORS_BY_SPACE.get(s.id) ?? []).map((e) => e.name).join(" · ") || s.name || "",
    })),
  blocks: VENUE.spaces.filter((s) => s.poly && s.kind === "obstacle").map((s) => s.poly),
  og: {
    elevation: OG_ELEVATION,
    roomH: OG_ROOM_H,
    outline: OG.outline,
    areas: OG_AREAS,
    tables: OG_TABLES,
    connectors: CONNECTORS.map(({ name, kind, poly, bottom, top, approx }) => ({ name, kind, poly, bottom, top, approx })),
  },
};

const STYLE = `
#ttf-root{--fg:#1f2328;--muted:#57606a;--card:#fff;--line:#d0d7de;--chip:#f6f8fa;font-family:system-ui,-apple-system,sans-serif;color:var(--fg);background:var(--card);border-radius:12px;padding:12px}
#ttf-root.dark{--fg:#e6edf3;--muted:#9da7b3;--card:#0d1117;--line:#30363d;--chip:#161b22}
#ttf-root h2{font-size:15px;margin:0 0 2px}
#ttf-root .sub{color:var(--muted);font-size:13px;margin:0 0 8px}
#ttf-wrap{position:relative;border:1px solid var(--line);border-radius:10px;overflow:hidden}
#ttf-3d{position:relative;width:100%;height:420px;touch-action:none}
#ttf-tools{position:absolute;right:8px;top:8px;display:flex;gap:6px;z-index:2}
#ttf-tools button{font:600 12px system-ui,sans-serif;padding:6px 9px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer}
#ttf-pick{position:absolute;left:8px;bottom:8px;max-width:70%;z-index:2;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px 9px;font-size:12px;line-height:1.4}
#ttf-pick[hidden],#ttf-stand[hidden],#ttf-legend-fast[hidden],#ttf-full[hidden]{display:none}
.l3{font:600 11px system-ui,sans-serif;color:var(--fg);white-space:nowrap;text-shadow:0 0 3px var(--card),0 0 3px var(--card)}
.l3.hall{font-size:14px;opacity:.75}
.l3.booth{font-size:9px;color:var(--muted)}
.l3.og{font-size:10px;color:#2563eb}
.dark .l3.og{color:#79b8ff}
.l3.table{font-size:9px}
.l3.stair{color:#b45309}
.l3.obstacle{color:#fff;background:#d1242f;padding:2px 6px;border-radius:6px;text-shadow:none}
.l3.pin{width:22px;height:22px;line-height:22px;text-align:center;border-radius:50%;color:#fff;text-shadow:none;border:2px solid #fff;font-size:12px}
.l3.pin.a{background:#1a7f37}
.l3.pin.b{background:#cf222e}
#ttf-legend{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:var(--muted);margin:8px 0 0}
#ttf-legend i{display:inline-block;width:14px;height:4px;border-radius:2px;vertical-align:middle;margin-right:5px}
#ttf-stand{margin-top:10px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--chip);font-size:13px;line-height:1.45}
#ttf-stand .stand-name{font-weight:700;font-size:14px}
#ttf-stand .stand-meta,#ttf-stand .stand-cats{color:var(--muted);font-size:12px}
#ttf-stand .stand-why{margin:6px 0}
#ttf-stand .stand-link{color:#0969da;font-size:12px}
.dark #ttf-stand .stand-link{color:#58a6ff}
#ttf-steps{margin:10px 0 0;padding-left:20px;font-size:13px;line-height:1.55}
#ttf-foot{color:var(--muted);font-size:12px;line-height:1.5;margin-top:8px}
#ttf-foot p{margin:3px 0}
`;

export const ROUTE_MAP_WIDGET_HTML = `<style>${STYLE}</style>
<div id="ttf-root">
  <h2 id="ttf-title">Salzburg Messe</h2>
  <p class="sub" id="ttf-sub">Loading route…</p>
  <div id="ttf-wrap">
    <div id="ttf-3d"></div>
    <div id="ttf-tools">
      <button id="ttf-reset" type="button" title="Show the whole route">Route</button>
      <button id="ttf-top" type="button" title="View from above">Top</button>
      <button id="ttf-full" type="button" title="Fullscreen">⤢</button>
    </div>
    <div id="ttf-pick" hidden></div>
  </div>
  <div id="ttf-legend">
    <span><i style="background:#1a7f37"></i>ground floor</span>
    <span><i style="background:#2563eb"></i>1. OG</span>
    <span id="ttf-legend-fast"><i style="background:#d97706"></i>faster route with stairs</span>
    <span><i style="background:#e4572e"></i>destination stand</span>
    <span>drag to rotate · scroll to zoom · click a booth</span>
  </div>
  <div id="ttf-stand" hidden></div>
  <ol id="ttf-steps"></ol>
  <div id="ttf-foot"></div>
</div>
<script>window.__TTF_VENUE__=${JSON.stringify(venue3d).replace(/</g, "\\u003c")};</script>
<script>${WIDGET_JS}</script>`;
