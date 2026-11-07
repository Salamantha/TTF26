import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { ROUTER, findPlace, suggestPlaces, EXAMPLE_PLACES } from "@/lib/venue";
import { planRoute, widgetData, fmtSeconds, ESTIMATE_DISCLAIMER } from "@/lib/plan";
import { getObstacles, setObstacle, getLeaderboardEntry, submitAttempt } from "@/lib/store";
import { ROUTE_MAP_WIDGET_URI, ROUTE_MAP_WIDGET_HTML } from "@/lib/widget";

function getBaseUrl() {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

const text = (t: string) => ({ type: "text" as const, text: t });
const OBSTACLE_RADIUS_M = 4;

const handler = createMcpHandler((server) => {
  server.registerResource("route-map-widget", ROUTE_MAP_WIDGET_URI, {}, async () => ({
    contents: [{ uri: ROUTE_MAP_WIDGET_URI, mimeType: "text/html+skybridge", text: ROUTE_MAP_WIDGET_HTML }],
  }));

  server.registerTool(
    "find_accessible_route",
    {
      title: "Find accessible route",
      description:
        "Plans a walking route inside the Messezentrum Salzburg and shows it on a map. Places can be halls (Halle 1-10, Foyer 1/10), the TTF Hackathon (Tagungsraum 5-7 on the 1. OG of Foyer 10), its tables (Tisch 1-18) and stage (Tagungsraum 4), stairs/lifts, exhibitors or booth codes, or categories like food, coffee, toilet, accessible toilet, info, entrance. In accessible mode (default) the route is step-free (lifts, no stairs) and avoids reported obstacles; it also reports how much faster the route with stairs would be. Use search_places first if a name is unclear.",
      inputSchema: z.object({
        from: z.string().describe("Start, e.g. 'entrance', 'Eingang Foyer 1', 'Halle 2'"),
        to: z.string().describe("Destination, e.g. 'TTF Hackathon', 'Tisch 12', 'nearest toilet', an exhibitor name"),
        accessible: z.boolean().default(true).describe("true = step-free (wheelchair, crutches, stroller); false = fastest, stairs allowed"),
      }),
      annotations: { readOnlyHint: true },
      _meta: {
        ui: { resourceUri: ROUTE_MAP_WIDGET_URI },
        "openai/outputTemplate": ROUTE_MAP_WIDGET_URI,
        "openai/toolInvocation/invoking": "Planning your route…",
        "openai/toolInvocation/invoked": "Route ready",
        "openai/widgetAccessible": true,
      },
    },
    async ({ from, to, accessible }) => {
      const plan = await planRoute(from, to, accessible);
      if (!plan.ok) return { content: [text(plan.error)], isError: true };

      const data = widgetData(plan);
      const mapUrl = `${getBaseUrl()}/map?${new URLSearchParams({ from, to, accessible: String(accessible) })}`;
      const lines = [
        `${accessible ? "Step-free" : "Fastest"} route from ${data.fromName} to ${data.toName}: ${data.totalTimeLabel}, ${data.distanceLabel}${data.via.length ? `, via ${data.via.join(", ")}` : ""}.`,
        ...data.steps.map((s, i) => `${i + 1}. ${s}`),
        ...data.notes,
        data.stand &&
          [
            `Stand: ${data.stand.exhibitor ?? "?"}${data.stand.code ? `, Stand ${data.stand.code}` : ""}${data.stand.hall ? `, ${data.stand.hall}` : ""}.`,
            data.stand.categories.length ? `Categories: ${data.stand.categories.join(", ")}.` : "",
            data.stand.whyVisit ? `Why visit: ${data.stand.whyVisit}` : "",
            data.stand.alsoHere.length ? `Also at this stand: ${data.stand.alsoHere.join(", ")}.` : "",
            data.stand.website ? `Website: ${data.stand.website}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        data.otherStands.length ? `Other stands in this category: ${data.otherStands.join("; ")}.` : "",
        data.gapLabel,
        data.raceLabel,
        ESTIMATE_DISCLAIMER,
        `Map: ${mapUrl}`,
      ].filter(Boolean);
      return { content: [text(lines.join("\n"))], structuredContent: { ...data, mapUrl } };
    }
  );

  server.registerTool(
    "search_places",
    {
      title: "Search venue places",
      description: "Looks up which venue place a name refers to (halls, TTF Hackathon rooms and tables, stairs/lifts, exhibitors, booth codes, food/toilet/info categories). Use it when a place name in the user's request is unclear.",
      inputSchema: z.object({ query: z.string() }),
      annotations: { readOnlyHint: true },
    },
    async ({ query }) => {
      const hit = findPlace(query);
      const others = suggestPlaces(query).filter((n) => n !== hit?.name);
      const lines = [
        hit ? `Best match: ${hit.name}${hit.instances.length > 1 ? ` (${hit.instances.length} locations, the nearest is chosen when routing)` : ""}.` : `No direct match for "${query}".`,
        others.length ? `Other matches: ${others.join("; ")}.` : "",
        hit ? "" : `Examples of valid places: ${EXAMPLE_PLACES.join(", ")}.`,
      ].filter(Boolean);
      return { content: [text(lines.join("\n"))], structuredContent: { match: hit?.name ?? null, others } };
    }
  );

  server.registerTool(
    "report_obstacle",
    {
      title: "Report an obstacle",
      description:
        "Reports that a place is blocked (e.g. 'Lift West out of service', 'boxes blocking the passage at Halle 2') or cleared again. Routing for everyone updates immediately. Use affects='wheelchair' for barriers only wheelchair/crutches users can't pass (broken lift, a step, a narrow gap), 'everyone' for full blockages.",
      inputSchema: z.object({
        location: z.string().describe("A specific place, e.g. 'Lift West', 'Treppe Nord', 'Eingang Foyer 1', 'Halle 2'"),
        status: z.enum(["blocked", "clear"]),
        affects: z.enum(["everyone", "wheelchair"]).default("everyone"),
        note: z.string().optional().describe("Short note, e.g. 'out of service since 14:00'"),
      }),
    },
    async ({ location, status, affects, note }) => {
      const place = findPlace(location);
      if (!place) {
        const s = suggestPlaces(location);
        return { content: [text(`Couldn't find "${location}". Nothing was changed.${s.length ? ` Did you mean: ${s.join("; ")}?` : ""}`)], isError: true };
      }
      if (place.instances.length !== 1) {
        return {
          content: [text(`"${location}" matches ${place.instances.length} places (${place.name}). Nothing was changed. Please name the exact one, e.g. ${place.instances.slice(0, 3).map((i) => i.name).join(", ")}.`)],
          isError: true,
        };
      }
      const inst = place.instances[0];
      const nodes = place.blockNodes ?? [...new Set([...inst.anchors, ...ROUTER.nodesWithin(inst.p, OBSTACLE_RADIUS_M)])];
      const record = await setObstacle({ placeId: place.id, label: place.name, p: inst.p, nodes, affects, status, note });
      return {
        content: [text(`Recorded: ${place.name} is now ${status === "blocked" ? `blocked${affects === "wheelchair" ? " for wheelchair users" : ""}` : "clear"}${note ? ` (${note})` : ""}. Routes update immediately.`)],
        structuredContent: { placeId: record.placeId, label: record.label, status: record.status, affects: record.affects, reportedAt: record.reportedAt },
      };
    }
  );

  server.registerTool(
    "list_obstacles",
    {
      title: "List current obstacles",
      description: "Lists all currently reported obstacles in the venue.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const blocked = Object.values(await getObstacles()).filter((o) => o.status === "blocked");
      if (!blocked.length) return { content: [text("No obstacles reported right now.")], structuredContent: { obstacles: [] } };
      const lines = blocked.map((o) => `- ${o.label}: blocked${o.affects === "wheelchair" ? " for wheelchair users" : ""}${o.note ? ` (${o.note})` : ""}, reported ${o.reportedAt}`);
      return {
        content: [text(lines.join("\n"))],
        structuredContent: { obstacles: blocked.map(({ placeId, label, affects, note, reportedAt }) => ({ placeId, label, affects, note, reportedAt })) },
      };
    }
  );

  server.registerTool(
    "get_leaderboard",
    {
      title: "Get accessible route leaderboard",
      description: "Gets the fastest recorded accessible-route time between two places, if any.",
      inputSchema: z.object({ from: z.string(), to: z.string() }),
      annotations: { readOnlyHint: true },
    },
    async ({ from, to }) => {
      const a = findPlace(from),
        b = findPlace(to);
      if (!a || !b) return { content: [text("Couldn't resolve one of the places. Try search_places.")], isError: true };
      const best = await getLeaderboardEntry(a.id, b.id);
      return {
        content: [text(best ? `Record ${a.name} → ${b.name}: ${fmtSeconds(best.bestSeconds)} by ${best.holder} (${best.recordedAt}).` : `No record yet for ${a.name} → ${b.name}.`)],
        structuredContent: { record: best },
      };
    }
  );

  server.registerTool(
    "log_attempt",
    {
      title: "Log an accessible-route attempt",
      description: "Submits a completed accessible-route time between two places for the leaderboard.",
      inputSchema: z.object({
        from: z.string(),
        to: z.string(),
        seconds: z.number().positive(),
        holder: z.string().describe("Name to credit the time to"),
      }),
    },
    async ({ from, to, seconds, holder }) => {
      const a = findPlace(from),
        b = findPlace(to);
      if (!a || !b) return { content: [text("Couldn't resolve one of the places. Try search_places.")], isError: true };
      const result = await submitAttempt(a.id, b.id, seconds, holder);
      return {
        content: [
          text(
            result.isNewRecord
              ? `New record for ${a.name} → ${b.name}: ${holder} in ${fmtSeconds(seconds)}!`
              : `Not a new record. Best is still ${fmtSeconds(result.best.bestSeconds)} by ${result.best.holder}.`
          ),
        ],
        structuredContent: result,
      };
    }
  );
});

export { handler as GET, handler as POST };
