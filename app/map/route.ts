import { planRoute } from "@/lib/plan";
import { ROUTE_MAP_WIDGET_HTML } from "@/lib/widget";
import type { Mobility } from "@/lib/store";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const MOBILITIES: Mobility[] = ["walk", "cane", "wheelchair"];

// Outside ChatGPT there is no window.openai; this stand-in calls the same MCP tools over HTTP so the
// widget's profile switch, race timer and feedback buttons work on the plain web page too.
const CALL_TOOL_SHIM = `
window.openai = window.openai || {};
window.openai.callTool = async function (name, args) {
  var r = await fetch("/api/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name: name, arguments: args } }) });
  var t = await r.text(), line = t.split("\\n").find(function (l) { return l.indexOf("data: ") === 0; });
  var m = JSON.parse(line ? line.slice(6) : t);
  if (m.error) throw new Error(m.error.message);
  return m.result;
};`;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const m = q.get("mobility") as Mobility | null;
  const mobility: Mobility = m && MOBILITIES.includes(m) ? m : q.get("accessible") === "true" ? "wheelchair" : "walk";
  const plan = await planRoute({ from: q.get("from") ?? "entrance", to: q.get("to") ?? "TTF Hackathon", mobility, avoidCrowds: q.get("crowds") !== "off" });

  const body = plan.ok
    ? `<script>${CALL_TOOL_SHIM}window.openai.toolOutput=${JSON.stringify(plan.data).replace(/</g, "\\u003c")};</script>${ROUTE_MAP_WIDGET_HTML}`
    : `<p style="font-family:system-ui,sans-serif;max-width:640px;margin:0 auto">${esc(plan.error)}</p>`;

  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>TTF Accessible Route</title><style>body{margin:0;padding:16px;background:#f6f7f9}@media (prefers-color-scheme:dark){body{background:#010409}}#ttf-root{margin:0 auto;max-width:900px}#ttf-3d{height:60vh}</style>` +
      `</head><body>${body}</body></html>`,
    { status: plan.ok ? 200 : 404, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}
