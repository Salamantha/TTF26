import { planRoute } from "@/lib/plan";
import { ROUTE_MAP_WIDGET_HTML } from "@/lib/widget";
import type { Mobility } from "@/lib/store";
import { CALL_TOOL_SHIM } from "@/lib/call-tool-shim";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const MOBILITIES: Mobility[] = ["walk", "cane", "wheelchair"];

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
