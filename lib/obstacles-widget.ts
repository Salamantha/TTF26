// Obstacle list widget for ChatGPT: the same card layout every time (instead of ChatGPT formatting free text),
// a small 2D map with the obstacle areas, and a "Cleared" button per obstacle.
import { VENUE, OG } from "./venue";
import { NEWT_PNG, THEME_VARS, THEME_VARS_DARK, BRAND_CSS } from "./brand";

export const OBSTACLES_WIDGET_URI = "ui://widget/obstacles-v2.html";

const base = {
  halls: VENUE.halls.filter((h) => h.poly && h.poly.length > 2).map((h) => h.poly),
  og: OG.outline,
};

const STYLE = `
#ob-root{${THEME_VARS}--wc:#A3480B;--wcbg:#FDEBDD;--all:#B3261E;--allbg:#FBE4E1;font-family:system-ui,-apple-system,sans-serif;color:var(--fg);background:var(--card);border-radius:12px;padding:12px}
#ob-root.dark{${THEME_VARS_DARK}--wc:#F59A55;--wcbg:#3A2210;--all:#FF7B72;--allbg:#3C1512}
${BRAND_CSS}
#ob-root [hidden]{display:none!important}
#ob-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
#ob-head h2{font-size:15px;margin:0}
.pill{font:600 12px system-ui,sans-serif;padding:2px 8px;border-radius:999px}
.pill.count{background:var(--wcbg);color:var(--wc)}
.pill.count.zero{background:var(--chip);color:var(--ok)}
.pill.wc{background:var(--wcbg);color:var(--wc)}
.pill.all{background:var(--allbg);color:var(--all)}
#ob-map{display:block;width:100%;height:190px;border:1px solid var(--line);border-radius:10px;background:var(--chip);margin-bottom:10px}
#ob-map .hall{fill:var(--card);stroke:var(--line);stroke-width:.6}
#ob-map .og{fill:none;stroke:#2563eb;stroke-width:.6;stroke-dasharray:2 1.5}
#ob-map .area{fill:#f97316;fill-opacity:.5;stroke:#ea580c;stroke-width:.6}
#ob-map .area.og{stroke-dasharray:1.5 1}
#ob-map .area.sel{fill-opacity:.85;stroke-width:1.2}
#ob-map text{font-family:system-ui,sans-serif;font-weight:700;fill:#fff;text-anchor:middle;pointer-events:none}
#ob-list{border:1px solid var(--line);border-radius:10px;overflow:hidden}
.ob{padding:12px;border-top:1px solid var(--line);cursor:pointer}
.ob:first-child{border-top:0}
.ob.sel{background:var(--chip)}
.ob-top{display:flex;justify-content:space-between;align-items:center;gap:8px}
.ob-title{font-weight:700;font-size:15px}
.ob-where{font-weight:600;font-size:13px;margin-top:6px}
.ob ul{margin:6px 0 0;padding-left:18px;font-size:13px;line-height:1.6}
.ob-actions{margin-top:8px;text-align:right}
#ob-root button{font:600 12px system-ui,sans-serif;padding:5px 10px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer}
#ob-root button:disabled{opacity:.5;cursor:default}
#ob-empty{padding:16px;text-align:center;color:var(--muted);font-size:13px}
#ob-toast{margin-top:8px;font-size:12px;color:var(--muted)}
`;

const SCRIPT = `
(function () {
  var NS = "http://www.w3.org/2000/svg";
  var BASE = window.__OB_BASE__;
  var root = document.getElementById("ob-root");
  var dark = window.openai && window.openai.theme ? window.openai.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.classList.toggle("dark", dark);
  var canCall = !!(window.openai && window.openai.callTool);
  var data = null, lastJson = "", selected = null;

  function el(tag, cls, text, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  function sv(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    parent.appendChild(n);
    return n;
  }
  var pts = function (p) { return p.map(function (q) { return q[0] + "," + q[1]; }).join(" "); };
  function when(iso) {
    var d = new Date(iso), s = (Date.now() - d) / 1000;
    var rel = s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? Math.round(s / 3600) + " h ago" : null;
    var abs = d.toLocaleString("en-GB", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
    return rel ? rel + " (" + abs + ")" : abs;
  }

  function drawMap(list) {
    var svg = document.getElementById("ob-map");
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.toggleAttribute("hidden", !list.length);
    if (!list.length) return;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    list.forEach(function (o) { x0 = Math.min(x0, o.p[0]); y0 = Math.min(y0, o.p[1]); x1 = Math.max(x1, o.p[0]); y1 = Math.max(y1, o.p[1]); });
    var w = Math.max(x1 - x0 + 40, 100), h = Math.max(y1 - y0 + 40, 60);
    // Match the element's shape, otherwise a tall spread gets squeezed into the wide, short map.
    var box = svg.getBoundingClientRect(), aspect = box.width && box.height ? box.width / box.height : 3;
    if (w / h < aspect) w = h * aspect; else h = w / aspect;
    svg.setAttribute("viewBox", ((x0 + x1) / 2 - w / 2) + " " + ((y0 + y1) / 2 - h / 2) + " " + w + " " + h);
    BASE.halls.forEach(function (p) { sv("polygon", { points: pts(p), "class": "hall" }, svg); });
    sv("polygon", { points: pts(BASE.og), "class": "og" }, svg);
    // At least ~6% of the visible height, so a 4 m area is still visible when obstacles are far apart.
    var r0 = h * 0.06;
    list.forEach(function (o, i) {
      var r = Math.max(o.radius, r0);
      var c = sv("circle", { cx: o.p[0], cy: o.p[1], r: r, "class": "area" + (o.level ? " og" : "") + (o.id === selected ? " sel" : "") }, svg);
      c.addEventListener("click", function () { select(o.id); });
      var t = sv("text", { x: o.p[0], y: o.p[1] + r * 0.4, "font-size": r * 1.1 }, svg);
      t.textContent = String(i + 1);
    });
  }

  function select(id) {
    selected = selected === id ? null : id;
    render(true);
  }

  function render(keepScroll) {
    var list = (data && data.obstacles) || [];
    var count = document.getElementById("ob-count");
    count.textContent = list.length ? list.length + " active" : "all clear";
    count.className = "pill count" + (list.length ? "" : " zero");
    drawMap(list);
    var box = document.getElementById("ob-list");
    while (box.firstChild) box.removeChild(box.firstChild);
    document.getElementById("ob-empty").hidden = !!list.length;
    box.hidden = !list.length;
    list.forEach(function (o, i) {
      var card = el("div", "ob" + (o.id === selected ? " sel" : ""), null, box);
      card.addEventListener("click", function (e) { if (e.target.tagName !== "BUTTON") select(o.id); });
      var top = el("div", "ob-top", null, card);
      el("span", "ob-title", (i + 1) + ". " + o.title, top);
      el("span", "pill " + (o.affects === "wheelchair" ? "wc" : "all"), o.affects === "wheelchair" ? "Accessibility" : "Blocks everyone", top);
      if (o.where) el("div", "ob-where", (o.markedOnMap ? "\\u26a0 " : "") + o.where + (o.level && o.where.indexOf("1. OG") < 0 ? " \\u00b7 1. OG" : ""), card);
      var ul = el("ul", "", null, card);
      el("li", "", "Affects: " + (o.affects === "wheelchair" ? "wheelchair users" : "everyone"), ul);
      el("li", "", "Status: " + (o.markedOnMap ? "marked as an obstacle on the map" : "reported as blocked"), ul);
      el("li", "", "Reported: " + when(o.reportedAt), ul);
      var act = el("div", "ob-actions", null, card);
      var b = el("button", "", "Cleared", act);
      b.type = "button";
      b.disabled = !canCall;
      b.title = "Mark as resolved";
      b.addEventListener("click", function () { clear(o, b); });
    });
  }

  function clear(o, b) {
    b.disabled = true;
    window.openai.callTool("clear_obstacle", { id: o.id }).then(function (r) {
      var sc = r && r.structuredContent;
      if (sc && sc.obstacles) show(sc, true);
      var t = r && r.content && r.content[0] && r.content[0].text;
      document.getElementById("ob-toast").textContent = t || "";
    }).catch(function () {
      b.disabled = false;
      document.getElementById("ob-toast").textContent = "Couldn't clear it, please try again.";
    });
  }

  function show(d, force) {
    if (!d || !d.obstacles) return;
    var json = JSON.stringify(d);
    if (json === lastJson && !force) return;
    lastJson = json;
    data = d;
    render();
  }
  var current = function () { try { return window.openai && window.openai.toolOutput; } catch (e) { return null; } };
  show(current());
  window.addEventListener("openai:set_globals", function (e) {
    var g = e && e.detail && e.detail.globals;
    show(g && g.toolOutput ? g.toolOutput : current());
  });
  window.addEventListener("message", function (e) {
    var m = e.data;
    if (m && m.jsonrpc === "2.0" && m.method === "ui/notifications/tool-result" && m.params) show(m.params.structuredContent || m.params);
  });
  var tries = 0, poll = setInterval(function () {
    var d = current();
    if (d || ++tries > 40) { clearInterval(poll); show(d); }
  }, 250);
})();
`;

export const OBSTACLES_WIDGET_HTML = `<style>${STYLE}</style>
<div id="ob-root">
  <div id="ob-head"><div class="brand"><img class="newt-logo" src="${NEWT_PNG}" alt="TacticalNewt"><div><p class="brand-name">Mind the Gap</p><h2>Current obstacles</h2></div></div><span class="pill count" id="ob-count">…</span></div>
  <svg id="ob-map" role="img" aria-label="Map of the reported obstacles" hidden></svg>
  <div id="ob-list"></div>
  <div id="ob-empty" hidden>No obstacles reported. All routes are clear.</div>
  <div id="ob-toast" role="status"></div>
</div>
<script>window.__OB_BASE__=${JSON.stringify(base).replace(/</g, "\\u003c")};</script>
<script>${SCRIPT}</script>`;
