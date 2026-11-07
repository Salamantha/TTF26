// Route map widget for ChatGPT (Apps SDK, ui:// resource) and the /map page.
// The static venue plan is baked into the HTML once; each tool result only carries the route
// (WidgetData from lib/plan.ts), so nothing is fetched from inside the sandboxed iframe.
import { VENUE, OG } from "./venue";
import type { Pt } from "./routing";

export const ROUTE_MAP_WIDGET_URI = "ui://widget/route-map-v2.html";

const pts = (p: Pt[]) => p.map(([x, y]) => `${x},${y}`).join(" ");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function baseMapSvg() {
  const halls = VENUE.halls
    .filter((h) => h.poly)
    .map((h) => `<polygon points="${pts(h.poly!)}" class="hall"/>`)
    .join("");
  const booths = VENUE.spaces
    .filter((s) => s.poly && (s.kind === "booth" || s.kind === "stage"))
    .map((s) => `<polygon points="${pts(s.poly!)}"/>`)
    .join("");
  const labels = VENUE.halls
    .filter((h) => h.name && h.label)
    .map((h) => `<text x="${h.label![0]}" y="${h.label![1]}">${esc(h.name!)}</text>`)
    .join("");
  const og = [
    `<polygon points="${pts(OG.outline)}" class="og-outline"/>`,
    ...OG.rooms.map((r) => `<polygon points="${pts(r.poly)}" class="og-room"/>`),
  ].join("");
  return `<g class="halls">${halls}</g><g class="booths">${booths}</g><g class="og">${og}</g><g class="hall-labels">${labels}</g>`;
}

const STYLE = `
#ttf-root{font-family:system-ui,-apple-system,sans-serif;color:#1f2328;background:#fff;padding:12px;border-radius:12px;max-width:640px}
#ttf-root h2{font-size:15px;margin:0 0 2px}
#ttf-root .sub{color:#57606a;font-size:13px;margin:0 0 8px}
#ttf-map{width:100%;height:340px;display:block;background:#f6f7f9;border:1px solid #d0d7de;border-radius:8px}
#ttf-map .hall{fill:#fff;stroke:#b6bcc4;stroke-width:.4}
#ttf-map .booths polygon{fill:#e6ebf1}
#ttf-map .og-outline{fill:none;stroke:#2563eb;stroke-width:.5;stroke-dasharray:2 1.5;opacity:.7}
#ttf-map .og-room{fill:#2563eb;fill-opacity:.06;stroke:none}
#ttf-map .hall-labels text{font-size:5px;fill:#8c959f;text-anchor:middle;font-weight:600}
#ttf-root ol{margin:8px 0 0;padding-left:20px;font-size:13px;line-height:1.5}
#ttf-root .foot{color:#57606a;font-size:12px;line-height:1.5;margin-top:8px}
#ttf-root .foot p{margin:4px 0}
#ttf-root .legend{display:flex;flex-wrap:wrap;gap:10px;font-size:12px;color:#57606a;margin-top:6px}
#ttf-root .legend i{display:inline-block;width:14px;height:3px;vertical-align:middle;margin-right:4px}
`;

const SCRIPT = `
(function () {
  var NS = "http://www.w3.org/2000/svg";
  var svg = document.getElementById("ttf-map");
  var layer = document.getElementById("ttf-route");

  function sv(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    (parent || layer).appendChild(n);
    return n;
  }
  function el(tag, text, parent) {
    var n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  function line(points, attrs) {
    if (!points || points.length < 2) return;
    attrs.points = points.map(function (p) { return p[0] + "," + p[1]; }).join(" ");
    attrs.fill = "none";
    attrs["stroke-linecap"] = "round";
    attrs["stroke-linejoin"] = "round";
    sv("polyline", attrs);
  }

  function render(d) {
    if (!d || !d.segments) return;
    while (layer.firstChild) layer.removeChild(layer.firstChild);

    var all = [];
    d.segments.forEach(function (s) { all = all.concat(s.points); });
    (d.fastestSegments || []).forEach(function (s) { all = all.concat(s.points); });
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    all.forEach(function (p) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
    var pad = 18, w = Math.max(x1 - x0 + 2 * pad, 70), h = Math.max(y1 - y0 + 2 * pad, 50);
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    svg.setAttribute("viewBox", (cx - w / 2) + " " + (cy - h / 2) + " " + w + " " + h);
    var k = Math.max(w, h) / 120;

    (d.fastestSegments || []).forEach(function (s) {
      line(s.points, { stroke: "#d97706", "stroke-width": 0.9 * k, "stroke-dasharray": (2 * k) + " " + (1.5 * k), opacity: 0.9 });
    });
    d.segments.forEach(function (s) {
      line(s.points, { stroke: "#fff", "stroke-width": 2.6 * k });
      line(s.points, { stroke: s.level === "og" ? "#2563eb" : "#1a7f37", "stroke-width": 1.5 * k });
    });
    for (var i = 1; i < d.segments.length; i++) {
      var p = d.segments[i].points[0];
      sv("rect", { x: p[0] - 1.6 * k, y: p[1] - 1.6 * k, width: 3.2 * k, height: 3.2 * k, rx: 0.6 * k, fill: "#2563eb", stroke: "#fff", "stroke-width": 0.4 * k });
      var t = sv("text", { x: p[0] + 2.4 * k, y: p[1] + 1 * k, "font-size": 3.4 * k, fill: "#1e3a8a", "font-weight": 700 });
      t.textContent = d.via[i - 1] || "";
    }
    (d.obstacles || []).forEach(function (o) {
      var g = sv("g", {});
      sv("circle", { cx: o.p[0], cy: o.p[1], r: 2.2 * k, fill: "#d1242f", stroke: "#fff", "stroke-width": 0.5 * k }, g);
      var x = sv("text", { x: o.p[0], y: o.p[1] + 1.1 * k, "font-size": 3 * k, fill: "#fff", "text-anchor": "middle", "font-weight": 700 }, g);
      x.textContent = "!";
      var tt = document.createElementNS(NS, "title");
      tt.textContent = o.label + (o.affects === "wheelchair" ? " (blocks wheelchairs)" : " (blocked)");
      g.appendChild(tt);
    });
    function pin(p, label, color) {
      if (!p) return;
      sv("circle", { cx: p[0], cy: p[1], r: 2.4 * k, fill: color, stroke: "#fff", "stroke-width": 0.6 * k });
      var t = sv("text", { x: p[0], y: p[1] + 1.2 * k, "font-size": 3.2 * k, fill: "#fff", "text-anchor": "middle", "font-weight": 700 });
      t.textContent = label;
    }
    pin(d.start, "A", "#1a7f37");
    pin(d.end, "B", "#cf222e");

    document.getElementById("ttf-title").textContent =
      (d.accessible ? "Step-free route: " : "Fastest route: ") + d.fromName + " \\u2192 " + d.toName;
    document.getElementById("ttf-sub").textContent =
      d.totalTimeLabel + " \\u00b7 " + d.distanceLabel + (d.via && d.via.length ? " \\u00b7 via " + d.via.join(", ") : "");

    var ol = document.getElementById("ttf-steps");
    while (ol.firstChild) ol.removeChild(ol.firstChild);
    (d.steps || []).forEach(function (s) { el("li", s, ol); });

    var foot = document.getElementById("ttf-foot");
    while (foot.firstChild) foot.removeChild(foot.firstChild);
    [].concat(d.notes || [], [d.gapLabel, d.raceLabel, d.disclaimer]).forEach(function (s) { if (s) el("p", s, foot); });

    document.getElementById("ttf-legend-fast").style.display = d.fastestSegments ? "" : "none";
  }

  function current() {
    try { return window.openai && window.openai.toolOutput; } catch (e) { return null; }
  }
  render(current());
  window.addEventListener("openai:set_globals", function (e) {
    var g = e && e.detail && e.detail.globals;
    render(g && g.toolOutput ? g.toolOutput : current());
  });
  window.addEventListener("message", function (e) {
    var m = e && e.data;
    if (m && m.jsonrpc === "2.0" && m.method === "ui/notifications/tool-result" && m.params) {
      render(m.params.structuredContent || m.params);
    }
  });
  var tries = 0, poll = setInterval(function () {
    var d = current();
    if (d || ++tries > 20) { clearInterval(poll); if (d) render(d); }
  }, 250);
})();
`;

export const ROUTE_MAP_WIDGET_HTML = `<style>${STYLE}</style>
<div id="ttf-root">
  <h2 id="ttf-title">Loading route…</h2>
  <p class="sub" id="ttf-sub"></p>
  <svg id="ttf-map" viewBox="-150 -290 300 450" role="img" aria-label="Venue map with the route">
    ${baseMapSvg()}
    <g id="ttf-route"></g>
  </svg>
  <div class="legend">
    <span><i style="background:#1a7f37"></i>ground floor</span>
    <span><i style="background:#2563eb"></i>1. OG</span>
    <span id="ttf-legend-fast"><i style="background:#d97706"></i>faster route with stairs</span>
    <span><i style="background:#d1242f;height:8px;width:8px;border-radius:50%"></i>reported obstacle</span>
  </div>
  <ol id="ttf-steps"></ol>
  <div class="foot" id="ttf-foot"></div>
</div>
<script>${SCRIPT}</script>`;
