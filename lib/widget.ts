// Route map widget for ChatGPT (Apps SDK ui:// resource) and the /map page: an interactive 3D venue
// (widget/map3d.ts, bundled with three.js) plus a text panel. The static venue geometry is embedded once;
// each tool result only carries the route (WidgetData from lib/plan.ts).
import { VENUE, OG, EXHIBITORS_BY_SPACE, HOTSPOTS } from "./venue";
import { CONNECTORS, OG_AREAS, OG_TABLES, OG_ELEVATION, OG_ROOM_H } from "./og";
import { WIDGET_JS } from "./widget-bundle.generated";

export const ROUTE_MAP_WIDGET_URI = "ui://widget/route-map-3d-v3.html";

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
  hotspots: HOTSPOTS,
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
#ttf-root{--fg:#1f2328;--muted:#57606a;--card:#fff;--line:#d0d7de;--chip:#f6f8fa;--accent:#0969da;--ok:#1a7f37;--warn:#bf8700;--bad:#cf222e;--gold:#b08800;font-family:system-ui,-apple-system,sans-serif;color:var(--fg);background:var(--card);border-radius:12px;padding:12px}
#ttf-root.dark{--fg:#e6edf3;--muted:#9da7b3;--card:#0d1117;--line:#30363d;--chip:#161b22;--accent:#58a6ff;--ok:#3fb950;--warn:#d29922;--bad:#f85149;--gold:#e3b341}
#ttf-root.busy{cursor:progress}
#ttf-root.busy #ttf-wrap,#ttf-root.busy .card{opacity:.6;transition:opacity .2s}
#ttf-root [hidden]{display:none!important}
#ttf-head{display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:8px}
#ttf-root h2{font-size:14px;margin:0;line-height:1.3}
#ttf-root .sub{color:var(--muted);font-size:12px;margin:2px 0 0}
#ttf-profile{display:flex;gap:2px;background:var(--chip);border:1px solid var(--line);border-radius:10px;padding:3px;flex:none}
#ttf-root #ttf-profile button{display:flex;border:0;background:none;color:var(--muted);padding:5px 7px;border-radius:7px;cursor:pointer}
#ttf-root #ttf-profile button svg{width:20px;height:20px;fill:currentColor}
#ttf-root #ttf-profile button[aria-pressed=true]{background:var(--accent);color:#fff}
#ttf-wrap{position:relative;border:1px solid var(--line);border-radius:10px;overflow:hidden}
#ttf-3d{position:relative;width:100%;height:380px;touch-action:none}
#ttf-root.navigating #ttf-3d{height:300px}
#ttf-tools{position:absolute;right:8px;top:8px;display:flex;gap:6px;z-index:2}
#ttf-root button{font:600 12px system-ui,sans-serif;padding:6px 10px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer}
#ttf-root button:disabled{opacity:.5;cursor:default}
#ttf-root button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
#ttf-root button.big{font-size:15px;padding:10px 18px;border-radius:10px;width:100%;margin-top:10px}
#ttf-root button.ghost{border:0;background:none;padding:4px 6px}
#ttf-root button[aria-pressed=true]{box-shadow:inset 0 0 0 1px var(--accent);background:var(--chip)}
#ttf-crowd{position:absolute;left:8px;top:8px;z-index:2;font-size:12px;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:5px 8px}
#ttf-heat-legend{position:absolute;left:8px;bottom:8px;z-index:2;display:flex;gap:6px;align-items:center;font-size:11px;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:4px 8px;color:var(--muted)}
#ttf-heat-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:3px;vertical-align:-1px}
#ttf-pick{position:absolute;right:8px;bottom:8px;max-width:60%;z-index:2;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px 9px;font-size:12px;line-height:1.4}
#ttf-toast{position:absolute;left:50%;top:48px;transform:translateX(-50%);z-index:3;max-width:80%;background:var(--fg);color:var(--card);border-radius:8px;padding:7px 12px;font-size:12px;line-height:1.4}
.l3{font:600 11px system-ui,sans-serif;color:var(--fg);white-space:nowrap;text-shadow:0 0 3px var(--card),0 0 3px var(--card)}
.l3.hall{font-size:14px;opacity:.75}
.l3.booth{font-size:9px;color:var(--muted)}
.l3.og{font-size:10px;color:#2563eb}
.dark .l3.og{color:#79b8ff}
.l3.table{font-size:9px}
.l3.stair{color:#b45309}
.l3.obstacle{color:#fff;background:#ea580c;padding:2px 6px;border-radius:6px;text-shadow:none}
.l3.pin{width:22px;height:22px;line-height:22px;text-align:center;border-radius:50%;color:#fff;text-shadow:none;border:2px solid #fff;font-size:12px}
.l3.pin.a{background:#1a7f37}
.l3.pin.b{background:#cf222e}
#ttf-root .card{border:1px solid var(--line);border-radius:10px;background:var(--chip);padding:12px;margin-top:10px;font-size:13px;line-height:1.45}
#ttf-root .muted{color:var(--muted);font-size:12px}
#ttf-root .small{font-size:11px}
#ttf-root .row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:space-between;margin-top:8px}
#ttf-root input:not([type=checkbox]){flex:1;min-width:120px;box-sizing:border-box;font:13px system-ui,sans-serif;padding:7px 9px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg)}
#ttf-report>input{width:100%;margin-top:8px}
.gap-head{display:flex;align-items:baseline;gap:10px;margin-bottom:8px}
.gap-big{font:800 30px system-ui,sans-serif;color:var(--warn);font-variant-numeric:tabular-nums;line-height:1}
.gap-big.zero{color:var(--ok)}
.gap-q{font-weight:700;font-size:15px}
.bar-row{display:grid;grid-template-columns:96px 1fr 44px;gap:8px;align-items:center;margin:5px 0}
.bar-label{display:flex;align-items:center;gap:4px;font-size:12px;color:var(--muted)}
.bar-label svg{width:16px;height:16px;fill:currentColor}
.bar{height:10px;background:var(--line);border-radius:5px;overflow:hidden}
.bar i{display:block;height:100%;border-radius:5px}
.bar i.fast{background:#d97706}
.bar i.free{background:#2563eb}
.bar i.you{background:var(--ok)}
.bar-time{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
#ttf-more{display:flex;gap:8px;align-items:flex-start;justify-content:space-between;margin-top:8px}
#ttf-root details summary{cursor:pointer;font-weight:600;font-size:12px;color:var(--muted)}
#ttf-root details p{margin:6px 0 0}
.lb{margin:6px 0 0;padding-left:20px;font-size:13px}
.lb li{display:flex;justify-content:space-between;gap:12px;font-variant-numeric:tabular-nums}
#ttf-root a.link{color:var(--accent);font-size:12px}
#ttf-stand{margin-top:8px}
.nav-top{display:flex;align-items:center;justify-content:space-between}
#ttf-nav-total{font:800 30px ui-monospace,monospace;font-variant-numeric:tabular-nums}
.nav-cur{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-top:6px}
#ttf-nav-title{font-weight:800;font-size:17px}
.nav-split{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
#ttf-nav-split{font:700 18px ui-monospace,monospace}
.delta{font:700 13px ui-monospace,monospace;margin-left:6px}
.delta.fast,.s-delta.fast{color:var(--ok)}
.delta.slow,.s-delta.slow{color:var(--bad)}
.s-delta.gold{color:var(--gold)}
#ttf-q:not(:empty){display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px;padding:8px;border-radius:8px;background:var(--card);border:1px dashed var(--warn)}
#ttf-q span{flex:1}
#ttf-splits{list-style:none;margin:10px 0 0;padding:0;font-size:12px}
#ttf-splits li{display:grid;grid-template-columns:1fr 50px 52px;gap:6px;padding:3px 6px;border-radius:6px;color:var(--muted)}
#ttf-splits li.done{color:var(--fg)}
#ttf-splits li.current{background:var(--card);color:var(--fg);font-weight:700;box-shadow:inset 3px 0 0 #facc15}
.s-delta,.s-time{text-align:right;font-family:ui-monospace,monospace}
.floors{display:flex;gap:6px;margin-top:8px}
.map2d{display:block;width:100%;height:240px;margin-top:8px;border:1px solid var(--line);border-radius:8px;background:var(--card);cursor:crosshair}
.map2d .hall{fill:var(--chip);stroke:var(--line);stroke-width:.4}
.map2d .booth{fill:var(--line);opacity:.6}
.map2d .route{fill:none;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}
.map2d .route.eg{stroke:#1a7f37}
.map2d .route.og{stroke:#2563eb}
.map2d .route.current{stroke:#facc15;stroke-width:2.2}
.map2d .obst{fill:#f97316;fill-opacity:.45;stroke:#ea580c;stroke-width:.4}
.map2d .marker{fill:#f97316;fill-opacity:.7;stroke:#ea580c;stroke-width:.6;stroke-dasharray:1.2 .8}
`;

export const ROUTE_MAP_WIDGET_HTML = `<style>${STYLE}</style>
<div id="ttf-root">
  <div id="ttf-head">
    <div><h2 id="ttf-title">Salzburg Messe</h2><p class="sub" id="ttf-sub">Loading route…</p></div>
    <div id="ttf-profile" role="group" aria-label="How do you get around?"></div>
  </div>
  <div id="ttf-wrap">
    <div id="ttf-3d"></div>
    <label id="ttf-crowd"><input type="checkbox" id="ttf-avoid"> avoid crowds</label>
    <div id="ttf-tools">
      <button id="ttf-heat" type="button" aria-pressed="false" title="Show simulated visitor density">Heatmap</button>
      <button id="ttf-reset" type="button" title="Show the whole route">Route</button>
      <button id="ttf-top" type="button" title="View from above">Top</button>
      <button id="ttf-full" type="button" title="Fullscreen" aria-label="Fullscreen">⤢</button>
    </div>
    <div id="ttf-heat-legend" hidden></div>
    <div id="ttf-pick" hidden></div>
    <div id="ttf-toast" role="status" hidden></div>
  </div>
  <div id="ttf-overview">
    <div class="card" id="ttf-gap"></div>
    <div id="ttf-more">
      <details id="ttf-lb"></details>
      <button id="ttf-report-btn" type="button">⚠ Report obstacle</button>
    </div>
    <div id="ttf-stand" hidden></div>
  </div>
  <div class="card" id="ttf-nav" hidden>
    <div class="nav-top"><span class="muted" id="ttf-nav-step"></span><span id="ttf-nav-total">0:00.0</span><button class="ghost" id="ttf-nav-stop" type="button" aria-label="Stop">✕</button></div>
    <div class="nav-cur">
      <div><div id="ttf-nav-title"></div><div class="muted" id="ttf-nav-meta"></div></div>
      <div class="nav-split"><span id="ttf-nav-split">0:00.0</span><span class="delta" id="ttf-nav-delta"></span><div class="muted" id="ttf-nav-target"></div></div>
    </div>
    <button class="primary big" id="ttf-nav-next" type="button">Next ▸</button>
    <div id="ttf-q"></div>
    <div class="row"><span></span><button id="ttf-nav-obstacle" type="button">⚠ Obstacle here</button></div>
    <ol id="ttf-splits"></ol>
  </div>
  <div class="card" id="ttf-finish" hidden></div>
  <div class="card" id="ttf-report" hidden></div>
</div>
<script>window.__TTF_VENUE__=${JSON.stringify(venue3d).replace(/</g, "\\u003c")};</script>
<script>${WIDGET_JS}</script>`;
