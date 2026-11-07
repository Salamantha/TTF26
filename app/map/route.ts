import { planRoute, widgetData } from "@/lib/plan";
import { ROUTE_MAP_WIDGET_HTML } from "@/lib/widget";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const from = q.get("from") ?? "entrance";
  const to = q.get("to") ?? "TTF Hackathon";
  const accessible = q.get("accessible") !== "false";
  const plan = await planRoute(from, to, accessible);

  const body = plan.ok
    ? `<script>window.openai={toolOutput:${JSON.stringify(widgetData(plan)).replace(/</g, "\\u003c")}};</script>${ROUTE_MAP_WIDGET_HTML}`
    : `<p style="font-family:system-ui,sans-serif;max-width:640px;margin:0 auto">${esc(plan.error)}</p>`;

  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>TTF Accessible Route</title><style>body{margin:0;padding:16px;background:#f6f7f9}#ttf-root{margin:0 auto}#ttf-map{height:65vh}</style>` +
      `</head><body>${body}</body></html>`,
    { status: plan.ok ? 200 : 404, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}
