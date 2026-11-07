// Self-contained HTML/JS for the ChatGPT Apps SDK widget that renders the route map
// inline in the chat. All data it needs travels in the tool's structuredContent —
// the widget never makes a network call, which avoids sandbox/CORS failure modes
// during a live demo.
//
// The exact mechanism ChatGPT uses to deliver tool output to a widget iframe is
// inconsistently documented across sources as of this writing, so this listens for
// all of them defensively: window.openai.toolOutput read directly, the
// "openai:set_globals" CustomEvent, the raw "ui/notifications/tool-result" postMessage,
// and a short poll as a last resort.

export const ROUTE_MAP_WIDGET_URI = "ui://widget/route-map.html";

export const ROUTE_MAP_WIDGET_HTML = `
<div id="root" style="font-family: system-ui, sans-serif; padding: 10px; max-width: 560px;">
  <div id="header" style="font-size: 14px; margin-bottom: 6px;"></div>
  <svg id="map" width="100%" style="background:#fafafa;border:1px solid #ddd;border-radius:8px;display:block;"></svg>
  <div id="footer" style="color:#888; font-size: 12px; margin-top: 8px; line-height: 1.5;"></div>
</div>
<script>
(function () {
  var svgNS = "http://www.w3.org/2000/svg";

  function render(data) {
    if (!data || !data.nodes) return;
    var header = document.getElementById("header");
    var footer = document.getElementById("footer");
    var svg = document.getElementById("map");

    var nodes = data.nodes || [];
    var edges = data.edges || [];
    var obstacles = data.obstacles || {};
    var routeNodeIds = data.routeNodeIds || [];
    var padding = 30;

    var maxX = 0, maxY = 0;
    nodes.forEach(function (n) {
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    });
    svg.setAttribute("viewBox", "0 0 " + (maxX + padding * 2) + " " + (maxY + padding * 2));

    var nodeById = {};
    nodes.forEach(function (n) { nodeById[n.id] = n; });

    var routeEdgeKeys = {};
    for (var i = 0; i < routeNodeIds.length - 1; i++) {
      routeEdgeKeys[routeNodeIds[i] + "|" + routeNodeIds[i + 1]] = true;
      routeEdgeKeys[routeNodeIds[i + 1] + "|" + routeNodeIds[i]] = true;
    }

    while (svg.firstChild) svg.removeChild(svg.firstChild);

    edges.forEach(function (e) {
      var a = nodeById[e.from], b = nodeById[e.to];
      if (!a || !b) return;
      var isOnRoute = !!routeEdgeKeys[e.from + "|" + e.to];
      var obstacle = obstacles[e.id];
      var isBlocked = obstacle && obstacle.status === "blocked";
      var line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", a.x + padding);
      line.setAttribute("y1", a.y + padding);
      line.setAttribute("x2", b.x + padding);
      line.setAttribute("y2", b.y + padding);
      line.setAttribute("stroke", isBlocked ? "#d33" : isOnRoute ? "#1a7f37" : "#bbb");
      line.setAttribute("stroke-width", isOnRoute ? 5 : 2);
      if (e.type === "stairs" || e.type === "elevator") line.setAttribute("stroke-dasharray", "6,4");
      svg.appendChild(line);
    });

    nodes.forEach(function (n) {
      var onRoute = routeNodeIds.indexOf(n.id) !== -1;
      var circle = document.createElementNS(svgNS, "circle");
      circle.setAttribute("cx", n.x + padding);
      circle.setAttribute("cy", n.y + padding);
      circle.setAttribute("r", onRoute ? 8 : 5);
      circle.setAttribute("fill", onRoute ? "#1a7f37" : "#555");
      svg.appendChild(circle);

      var text = document.createElementNS(svgNS, "text");
      text.setAttribute("x", n.x + padding + 8);
      text.setAttribute("y", n.y + padding + 4);
      text.setAttribute("font-size", "11");
      text.setAttribute("fill", "#222");
      text.textContent = n.name;
      svg.appendChild(text);
    });

    header.innerHTML =
      "<strong>" + (data.accessible ? "Accessible" : "Fastest") + " route:</strong> " +
      (data.fromName || "") + " \\u2192 " + (data.toName || "") +
      (data.totalTimeLabel ? " \\u2014 " + data.totalTimeLabel : "");

    var parts = [];
    if (data.gapLabel) parts.push(data.gapLabel);
    if (data.raceLabel) parts.push(data.raceLabel);
    if (data.disclaimer) parts.push(data.disclaimer);
    footer.innerHTML = parts.join("<br/>");
  }

  function current() {
    try {
      return window.openai && window.openai.toolOutput;
    } catch (e) {
      return null;
    }
  }

  render(current());

  window.addEventListener("openai:set_globals", function (event) {
    try {
      var globals = event && event.detail && event.detail.globals;
      if (globals && "toolOutput" in globals) render(globals.toolOutput);
      else render(current());
    } catch (e) {}
  });

  window.addEventListener("message", function (event) {
    var msg = event && event.data;
    if (!msg || msg.jsonrpc !== "2.0") return;
    if (msg.method !== "ui/notifications/tool-result") return;
    render(msg.params);
  });

  var tries = 0;
  var poll = setInterval(function () {
    tries++;
    var data = current();
    if (data) {
      render(data);
      clearInterval(poll);
    } else if (tries > 20) {
      clearInterval(poll);
    }
  }, 250);
})();
</script>
`;
