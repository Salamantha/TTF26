import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { ROUTER, findPlace, suggestPlaces, EXAMPLE_PLACES } from "@/lib/venue";
import { planRoute, fmtSeconds, MOBILITY } from "@/lib/plan";
import { getObstacles, setObstacle, getLeaderboard, submitAttempt, PERSISTENT } from "@/lib/store";
import { ROUTE_MAP_WIDGET_URI, ROUTE_MAP_WIDGET_HTML } from "@/lib/widget";

function getBaseUrl() {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

const text = (t: string) => ({ type: "text" as const, text: t });
const OBSTACLE_RADIUS_M = 4;
const MIN_PLAUSIBLE_SHARE = 0.4;
const mobilitySchema = z.enum(["walk", "cane", "wheelchair"]);
const WIDGET_NOTE =
  "The map widget shows the route, directions, the fastest vs step-free comparison, the record and feedback buttons. Reply in at most two short sentences and don't repeat the directions or numbers.";

const handler = createMcpHandler((server) => {
  server.registerResource(
    "route-map-widget",
    ROUTE_MAP_WIDGET_URI,
    {
      _meta: {
        "openai/widgetDescription":
          "Interactive 3D venue map with the route, a fastest vs step-free comparison, the route record with a race timer, feedback questions about lifts and obstacles, stand details and collapsible directions. Everything important is already visible; keep the chat reply short.",
      },
    },
    async () => ({
      contents: [
        {
          uri: ROUTE_MAP_WIDGET_URI,
          mimeType: "text/html+skybridge",
          text: ROUTE_MAP_WIDGET_HTML,
          _meta: { "openai/widgetPrefersBorder": true },
        },
      ],
    })
  );

  server.registerTool(
    "find_accessible_route",
    {
      title: "Find accessible route",
      description:
        "Plans a walking route inside the Messezentrum Salzburg and shows it on an interactive 3D map. Places: halls (Halle 1-10, Foyer 1/10), the TTF Hackathon (Tagungsraum 5-7, 1. OG Foyer 10), its tables (Tisch 1-18) and stage (Tagungsraum 4), stairs/lifts, exhibitors, booth codes, product categories (ice cream, wine…) and services (food, coffee, toilet, accessible toilet, info, entrance). " +
        "Pick mobility from the conversation: 'wheelchair' (also strollers, rollators), 'cane' (crutches, a broken leg, walking slowly), otherwise 'walk'. The result always compares the fastest route with the step-free one. Use search_places first if a name is unclear.",
      inputSchema: z.object({
        from: z.string().describe("Start, e.g. 'entrance', 'Eingang Foyer 1', 'Halle 2'"),
        to: z.string().describe("Destination, e.g. 'TTF Hackathon', 'Tisch 12', 'ice cream', an exhibitor name"),
        mobility: mobilitySchema.default("walk").describe("walk | cane (crutches, slow) | wheelchair (no stairs)"),
        avoidCrowds: z.boolean().default(true).describe("Route around (simulated) crowded spots"),
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
    async ({ from, to, mobility, avoidCrowds }) => {
      const plan = await planRoute({ from, to, mobility, avoidCrowds });
      if (!plan.ok) return { content: [text(plan.error)], isError: true };
      const d = plan.data;
      const mapUrl = `${getBaseUrl()}/map?${new URLSearchParams({ from, to, mobility })}`;
      const c = d.compare;
      const summary = [
        `${d.mobilityLabel} route ${d.fromName} → ${d.toName}: ${d.timeLabel}, ${d.distanceLabel}${d.via.length ? `, via ${d.via.join(", ")}` : ""}.`,
        c.fastest && c.stepFree
          ? `Fastest (stairs ok) ${c.fastest.label} vs step-free ${c.stepFree.label}${c.gapSeconds ? `: the step-free detour costs ${c.gapSeconds} s` : ": no detour"}.`
          : "",
        d.leaderboard[0] ? `Record: ${d.leaderboard[0].label} by ${d.leaderboard[0].holder}.` : "No record yet for this route.",
        d.stand ? `Destination stand: ${d.stand.exhibitor ?? ""} ${d.stand.code ? `(Stand ${d.stand.code}, ${d.stand.hall})` : ""}.` : "",
        ...d.notes,
        WIDGET_NOTE,
        `Map link: ${mapUrl}`,
      ].filter(Boolean);
      return { content: [text(summary.join("\n"))], structuredContent: { ...d, mapUrl } };
    }
  );

  server.registerTool(
    "search_places",
    {
      title: "Search venue places",
      description: "Looks up which venue place a name refers to (halls, TTF Hackathon rooms and tables, stairs/lifts, exhibitors, booth codes, product categories, services). Use it when a place name is unclear.",
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
      title: "Report an obstacle or confirm a place works",
      description:
        "Reports that a place is blocked (e.g. 'Lift West out of service', 'boxes blocking the passage at Halle 2'), or with status 'clear' that it works again / was just confirmed working. Routing for everyone updates immediately. Use affects='wheelchair' for barriers only people who can't take steps are stopped by (broken lift, a step, a narrow gap), 'everyone' for full blockages.",
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
        content: [
          text(
            status === "blocked"
              ? `Thanks! ${place.name} is now marked blocked${affects === "wheelchair" ? " for wheelchair users" : ""}${note ? ` (${note})` : ""}. Routes update immediately.`
              : `Thanks! ${place.name} is confirmed working. Others will see that it was checked just now.`
          ),
        ],
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
      title: "Get route leaderboard",
      description: "Gets the fastest recorded times between two places for a mobility profile.",
      inputSchema: z.object({ from: z.string(), to: z.string(), mobility: mobilitySchema.default("walk") }),
      annotations: { readOnlyHint: true },
    },
    async ({ from, to, mobility }) => {
      const a = findPlace(from),
        b = findPlace(to);
      if (!a || !b) return { content: [text("Couldn't resolve one of the places. Try search_places.")], isError: true };
      const top = await getLeaderboard(a.id, b.id, mobility, 5);
      const lines = top.length
        ? top.map((t, i) => `${i + 1}. ${t.holder}: ${fmtSeconds(t.seconds)}`)
        : [`No times yet for ${a.name} → ${b.name} (${MOBILITY[mobility].label}).`];
      return { content: [text(lines.join("\n"))], structuredContent: { top, persistent: PERSISTENT } };
    }
  );

  server.registerTool(
    "log_attempt",
    {
      title: "Log a route race time",
      description: "Submits a completed route time between two places for the leaderboard of a mobility profile. A faster time replaces the record.",
      inputSchema: z.object({
        from: z.string(),
        to: z.string(),
        mobility: mobilitySchema.default("walk"),
        seconds: z.number().positive(),
        holder: z.string().min(1).max(40).describe("Name to credit the time to"),
      }),
    },
    async ({ from, to, mobility, seconds, holder }) => {
      const a = findPlace(from),
        b = findPlace(to);
      if (!a || !b) return { content: [text("Couldn't resolve one of the places. Try search_places.")], isError: true };
      // Reject times nobody can walk (e.g. Start and Arrived tapped right after each other).
      const plan = await planRoute({ from, to, mobility: "walk", avoidCrowds: false });
      const planned = plan.ok ? plan.data.compare.fastest?.seconds ?? null : null;
      if (planned && seconds < planned * MIN_PLAUSIBLE_SHARE) {
        return {
          content: [text(`${fmtSeconds(seconds)} is faster than anyone can walk this route (planned ${fmtSeconds(planned)} at normal pace), so it wasn't saved.`)],
          isError: true,
        };
      }
      const r = await submitAttempt(a.id, b.id, mobility, Math.round(seconds), holder.trim());
      const msg = r.isNewRecord
        ? `New record for ${a.name} → ${b.name} (${MOBILITY[mobility].label}): ${holder} in ${fmtSeconds(seconds)}!`
        : `${holder}: ${fmtSeconds(seconds)}, rank ${r.rank}. Record is ${fmtSeconds(r.previousRecord!.seconds)} by ${r.previousRecord!.holder} (${Math.round(seconds - r.previousRecord!.seconds)} s faster).`;
      return { content: [text(msg)], structuredContent: { ...r, persistent: PERSISTENT } };
    }
  );
});

export { handler as GET, handler as POST };
