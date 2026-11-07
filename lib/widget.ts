// Route map widget for ChatGPT (Apps SDK ui:// resource) and the /map page: an interactive 3D venue
// (widget/map3d.ts, bundled with three.js) plus a text panel. The static venue geometry is embedded once;
// each tool result only carries the route (WidgetData from lib/plan.ts).
import { VENUE, OG, EXHIBITORS_BY_SPACE, HOTSPOTS } from "./venue";
import { CONNECTORS, OG_AREAS, OG_TABLES, OG_ELEVATION, OG_ROOM_H } from "./og";
import { WIDGET_JS } from "./widget-bundle.generated";

export const ROUTE_MAP_WIDGET_URI = "ui://widget/route-map-3d-v2.html";

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
#ttf-root{--fg:#1f2328;--muted:#57606a;--card:#fff;--line:#d0d7de;--chip:#f6f8fa;--accent:#0969da;--ok:#1a7f37;--warn:#bf8700;font-family:system-ui,-apple-system,sans-serif;color:var(--fg);background:var(--card);border-radius:12px;padding:12px}
#ttf-root.dark{--fg:#e6edf3;--muted:#9da7b3;--card:#0d1117;--line:#30363d;--chip:#161b22;--accent:#58a6ff;--ok:#3fb950;--warn:#d29922}
#ttf-root.busy{cursor:progress}
#ttf-root.busy #ttf-wrap,#ttf-root.busy .card{opacity:.6;transition:opacity .2s}
#ttf-root [hidden]{display:none!important}
#ttf-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;margin-bottom:8px}
#ttf-root h2{font-size:15px;margin:0}
#ttf-root .sub{color:var(--muted);font-size:13px;margin:2px 0 0}
#ttf-profile{display:flex;gap:4px;background:var(--chip);border:1px solid var(--line);border-radius:10px;padding:3px}
#ttf-root #ttf-profile button{display:flex;align-items:center;gap:5px;border:0;background:none;color:var(--muted);font:600 12px system-ui,sans-serif;padding:5px 8px;border-radius:7px;cursor:pointer}
#ttf-root #ttf-profile button svg{width:18px;height:18px;fill:currentColor}
#ttf-root #ttf-profile button[aria-pressed=true]{background:var(--accent);color:#fff}
#ttf-wrap{position:relative;border:1px solid var(--line);border-radius:10px;overflow:hidden}
#ttf-3d{position:relative;width:100%;height:400px;touch-action:none}
#ttf-tools{position:absolute;right:8px;top:8px;display:flex;gap:6px;z-index:2}
#ttf-root button{font:600 12px system-ui,sans-serif;padding:6px 10px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer}
#ttf-root button:disabled{opacity:.5;cursor:default}
#ttf-root button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
#ttf-root button[aria-pressed=true]#ttf-heat{background:var(--chip);box-shadow:inset 0 0 0 1px var(--accent)}
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
.l3.obstacle{color:#fff;background:#d1242f;padding:2px 6px;border-radius:6px;text-shadow:none}
.l3.pin{width:22px;height:22px;line-height:22px;text-align:center;border-radius:50%;color:#fff;text-shadow:none;border:2px solid #fff;font-size:12px}
.l3.pin.a{background:#1a7f37}
.l3.pin.b{background:#cf222e}
#ttf-legend{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:var(--muted);margin:6px 0 0}
#ttf-legend i{display:inline-block;width:14px;height:4px;border-radius:2px;vertical-align:middle;margin-right:5px}
#ttf-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-top:10px}
#ttf-root .card{border:1px solid var(--line);border-radius:10px;background:var(--chip);padding:10px 12px;font-size:13px;line-height:1.45}
#ttf-root .card-title{font-weight:700;font-size:13px;margin-bottom:6px}
#ttf-root .muted{color:var(--muted);font-size:12px}
#ttf-root .small{font-size:11px}
.cmp-row{display:grid;grid-template-columns:70px 1fr 64px;gap:4px 8px;align-items:center;margin:4px 0}
.cmp-label{font-weight:600}
.cmp-bar{height:8px;background:var(--line);border-radius:4px;overflow:hidden}
.cmp-bar i{display:block;height:100%;border-radius:4px}
.cmp-bar i.fast{background:#d97706}
.cmp-bar i.free{background:#2563eb}
.cmp-time{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
.cmp-via{grid-column:2/4;color:var(--muted);font-size:11px;margin-top:-3px}
.gap{margin-top:6px;font-weight:600;color:var(--warn)}
.gap.zero{color:var(--ok)}
.check{font-size:12px;color:var(--muted);margin-top:4px}
.check::before{content:"○ ";color:var(--warn)}
.check.ok::before{content:"✓ ";color:var(--ok)}
.lb{margin:0 0 8px;padding-left:20px}
.lb li{display:flex;justify-content:space-between;gap:8px;font-variant-numeric:tabular-nums}
.lb li.first{font-weight:700}
.race-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px}
.race-row input:not([type=checkbox]){flex:1;min-width:120px;font:13px system-ui,sans-serif;padding:6px 8px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg)}
.timer{font:700 22px ui-monospace,monospace;font-variant-numeric:tabular-nums;margin-right:6px}
.fb-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:5px 0}
.fb-row span{flex:1;min-width:150px}
#ttf-root a.link{color:var(--accent);font-size:12px}
#ttf-root details summary{cursor:pointer;font-weight:600;font-size:13px}
#ttf-root details p{margin:6px 0 0}
#ttf-dir{margin-top:10px}
#ttf-steps{margin:6px 0 0;padding-left:20px;font-size:13px;line-height:1.55}
#ttf-foot{color:var(--muted);font-size:11px;line-height:1.5;margin-top:8px}
#ttf-foot p{margin:2px 0}
#ttf-report-row{margin-top:8px;text-align:right}
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
  <div id="ttf-legend">
    <span><i style="background:#1a7f37"></i>ground floor</span>
    <span><i style="background:#2563eb"></i>1. OG</span>
    <span id="ttf-legend-fast"><i style="background:#d97706"></i>fastest route (stairs)</span>
    <span><i style="background:#e4572e"></i>destination stand</span>
  </div>
  <div id="ttf-cards">
    <div class="card" id="ttf-compare"></div>
    <div class="card" id="ttf-race"></div>
    <div class="card" id="ttf-feedback" hidden></div>
    <div class="card" id="ttf-stand" hidden></div>
  </div>
  <div id="ttf-report-row"><button id="ttf-report" type="button">Report a lift or obstacle</button></div>
  <details id="ttf-dir"><summary id="ttf-dir-sum">Directions</summary><ol id="ttf-steps"></ol></details>
  <div id="ttf-foot"></div>
</div>
<script>window.__TTF_VENUE__=${JSON.stringify(venue3d).replace(/</g, "\\u003c")};</script>
<script>${WIDGET_JS}</script>`;
