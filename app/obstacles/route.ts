import { obstacleList } from "@/lib/obstacles";
import { OBSTACLES_WIDGET_HTML } from "@/lib/obstacles-widget";
import { CALL_TOOL_SHIM } from "@/lib/call-tool-shim";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await obstacleList();
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>Current obstacles</title><style>body{margin:0;padding:16px;background:#f6f7f9}@media (prefers-color-scheme:dark){body{background:#010409}}#ob-root{margin:0 auto;max-width:700px}</style>` +
      `</head><body><script>${CALL_TOOL_SHIM}window.openai.toolOutput=${JSON.stringify(data).replace(/</g, "\\u003c")};</script>${OBSTACLES_WIDGET_HTML}</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } }
  );
}
