import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { NODES, EDGES, findNode, findEdge } from "@/lib/venue";
import { computeRoute } from "@/lib/routing";
import { getObstacles, setObstacle, getLeaderboardEntry, submitAttempt } from "@/lib/store";
import { ROUTE_MAP_WIDGET_URI, ROUTE_MAP_WIDGET_HTML } from "@/lib/widget";

function getBaseUrl() {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

function fmtSeconds(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}m ${sec}s`;
}

const ESTIMATE_DISCLAIMER =
  "Prototype estimate: distances/times come from a hand-authored demo graph, not a verified accessibility survey. Report anything wrong with report_obstacle.";

const handler = createMcpHandler((server) => {
  server.registerResource(
    "route-map-widget",
    ROUTE_MAP_WIDGET_URI,
    {},
    async () => ({
      contents: [
        {
          uri: ROUTE_MAP_WIDGET_URI,
          mimeType: "text/html+skybridge",
          text: ROUTE_MAP_WIDGET_HTML,
        },
      ],
    })
  );

  server.registerTool(
    "find_accessible_route",
    {
      title: "Find accessible route",
      description:
        "Finds a walking route between two points inside the Salzburg Messe (e.g. from an entrance to the TTF venue hall). In accessible mode (default) it avoids stairs and any currently reported obstacles for wheelchair/crutches users, and reports the time gap versus the fastest non-accessible route plus any leaderboard record to beat. This is a hackathon prototype estimate, not a verified accessibility survey.",
      inputSchema: z.object({
        from: z.string().describe("Starting point, e.g. 'Westeingang' or 'entrance_west'"),
        to: z.string().describe("Destination, e.g. 'Halle 2' or 'TTF venue'"),
        accessible: z
          .boolean()
          .default(true)
          .describe("Whether the route must avoid stairs and other non-wheelchair-accessible edges"),
      }),
      _meta: {
        ui: { resourceUri: ROUTE_MAP_WIDGET_URI },
        "openai/outputTemplate": ROUTE_MAP_WIDGET_URI,
        "openai/toolInvocation/invoking": "Finding your route…",
        "openai/toolInvocation/invoked": "Route found",
        "openai/widgetAccessible": true,
      },
    },
    async ({ from, to, accessible }) => {
      const fromNode = findNode(from);
      const toNode = findNode(to);
      if (!fromNode || !toNode) {
        return {
          content: [
            {
              type: "text",
              text: `Could not resolve one of the locations. Known locations: ${NODES.map((n) => n.name).join(", ")}`,
            },
          ],
          isError: true,
        };
      }

      const obstacles = await getObstacles();
      const route = computeRoute(fromNode.id, toNode.id, accessible, obstacles);
      if (!route) {
        return {
          content: [
            {
              type: "text",
              text: `No ${accessible ? "accessible " : ""}route found between ${fromNode.name} and ${toNode.name} right now — it may be fully blocked by reported obstacles.`,
            },
          ],
          isError: true,
        };
      }

      let gapText: string | undefined;
      let gapSeconds: number | undefined;
      let fastest: ReturnType<typeof computeRoute> | null = null;
      if (accessible) {
        fastest = computeRoute(fromNode.id, toNode.id, false, obstacles);
        if (fastest) {
          gapSeconds = Math.max(0, Math.round(route.totalSeconds - fastest.totalSeconds));
          gapText = `A non-accessible route would take ${fmtSeconds(fastest.totalSeconds)} — a gap of ${gapSeconds}s. Help close it by keeping obstacle reports up to date.`;
        }
      }

      let raceText: string | undefined;
      let leaderboardEntry: Awaited<ReturnType<typeof getLeaderboardEntry>> = null;
      if (accessible) {
        leaderboardEntry = await getLeaderboardEntry(fromNode.id, toNode.id);
        raceText = leaderboardEntry
          ? `Current accessible-route record for this path: ${fmtSeconds(leaderboardEntry.bestSeconds)} by ${leaderboardEntry.holder}. Think you can beat it? Log your attempt with log_attempt once you arrive.`
          : `No accessible-route record set for this path yet — be the first! Log your attempt with log_attempt once you arrive.`;
      }

      const mapUrl = `${getBaseUrl()}/map?route=${route.nodeIds.join(",")}&accessible=${accessible}`;

      const stepsText = route.steps
        .map((s) => `- ${s.fromName} → ${s.toName} (${s.edge.type}, ${fmtSeconds(s.seconds)})`)
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text:
              `${accessible ? "Accessible" : "Fastest"} route from ${fromNode.name} to ${toNode.name}: ` +
              `${fmtSeconds(route.totalSeconds)} over ${Math.round(route.totalMeters)}m.\n\n${stepsText}` +
              (gapText ? `\n\n${gapText}` : "") +
              (raceText ? `\n\n${raceText}` : "") +
              `\n\n${ESTIMATE_DISCLAIMER}` +
              `\n\nMap: ${mapUrl}`,
          },
        ],
        structuredContent: {
          from: fromNode.name,
          to: toNode.name,
          accessible,
          totalSeconds: route.totalSeconds,
          totalMeters: route.totalMeters,
          nodeIds: route.nodeIds,
          mapUrl,
          gapSeconds,
          leaderboard: leaderboardEntry,
          disclaimer: ESTIMATE_DISCLAIMER,
          // widget-ready payload (self-contained — no network call needed in the iframe)
          nodes: NODES,
          edges: EDGES,
          obstacles,
          routeNodeIds: route.nodeIds,
          fromName: fromNode.name,
          toName: toNode.name,
          totalTimeLabel: fmtSeconds(route.totalSeconds),
          gapLabel: gapText,
          raceLabel: raceText,
        },
      };
    }
  );

  server.registerTool(
    "report_obstacle",
    {
      title: "Report an obstacle",
      description:
        "Reports that a path segment (e.g. an elevator or ramp) is currently blocked or has been fixed. Updates live routing immediately for everyone using the accessible route finder. Use this to keep information current instead of relying on outdated venue signage.",
      inputSchema: z.object({
        location: z
          .string()
          .describe("Which segment, e.g. an edge id like 'e12', or a description like 'elevator near Halle 5'"),
        status: z.enum(["blocked", "clear"]).describe("Whether the segment is now blocked or has been cleared"),
        note: z.string().optional().describe("Optional short note, e.g. 'elevator out of service since 14:00'"),
      }),
    },
    async ({ location, status, note }) => {
      const edge = findEdge(location);
      if (!edge) {
        const choices = EDGES.map((candidate) => {
          const fromName = NODES.find((node) => node.id === candidate.from)?.name ?? candidate.from;
          const toName = NODES.find((node) => node.id === candidate.to)?.name ?? candidate.to;
          return `- ${candidate.id}: ${candidate.type} between ${fromName} and ${toName}`;
        }).join("\n");
        return {
          content: [{
            type: "text",
            text: `Could not uniquely identify "${location}". No obstacle was changed. Please specify one exact segment using its ID or endpoint names. Known segments:\n${choices}`,
          }],
          isError: true,
        };
      }
      const record = await setObstacle(edge.id, status, note);
      const fromName = NODES.find((n) => n.id === edge.from)?.name ?? edge.from;
      const toName = NODES.find((n) => n.id === edge.to)?.name ?? edge.to;
      return {
        content: [
          {
            type: "text",
            text: `Recorded: ${edge.type} between ${fromName} and ${toName} is now ${status}${note ? ` (${note})` : ""}. Routing updated.`,
          },
        ],
        structuredContent: { edgeId: edge.id, ...record },
      };
    }
  );

  server.registerTool(
    "list_obstacles",
    {
      title: "List current obstacles",
      description: "Lists all currently reported blocked path segments in the Salzburg Messe.",
      inputSchema: z.object({}),
    },
    async () => {
      const obstacles = await getObstacles();
      const blocked = Object.entries(obstacles).filter(([, r]) => r.status === "blocked");
      if (blocked.length === 0) {
        return { content: [{ type: "text", text: "No obstacles currently reported. All paths clear." }] };
      }
      const text = blocked
        .map(([edgeId, r]) => {
          const edge = findEdge(edgeId);
          const fromName = edge ? NODES.find((n) => n.id === edge.from)?.name : edgeId;
          const toName = edge ? NODES.find((n) => n.id === edge.to)?.name : "";
          return `- ${edgeId}: ${fromName} ↔ ${toName}${r.note ? ` — ${r.note}` : ""} (reported ${r.reportedAt})`;
        })
        .join("\n");
      return { content: [{ type: "text", text }], structuredContent: { obstacles } };
    }
  );

  server.registerTool(
    "get_leaderboard",
    {
      title: "Get accessible route leaderboard",
      description: "Gets the fastest recorded accessible-route time between two points, if any.",
      inputSchema: z.object({
        from: z.string(),
        to: z.string(),
      }),
    },
    async ({ from, to }) => {
      const fromNode = findNode(from);
      const toNode = findNode(to);
      if (!fromNode || !toNode) {
        return { content: [{ type: "text", text: "Could not resolve one of the locations." }], isError: true };
      }
      const best = await getLeaderboardEntry(fromNode.id, toNode.id);
      return {
        content: [
          {
            type: "text",
            text: best
              ? `Record: ${fmtSeconds(best.bestSeconds)} by ${best.holder} (${best.recordedAt})`
              : "No record set yet for this route.",
          },
        ],
        structuredContent: best ?? null,
      };
    }
  );

  server.registerTool(
    "log_attempt",
    {
      title: "Log an accessible-route attempt",
      description:
        "Submits a completed accessible-route time between two points for the leaderboard/race feature.",
      inputSchema: z.object({
        from: z.string(),
        to: z.string(),
        seconds: z.number().positive(),
        holder: z.string().describe("Name to credit the time to"),
      }),
    },
    async ({ from, to, seconds, holder }) => {
      const fromNode = findNode(from);
      const toNode = findNode(to);
      if (!fromNode || !toNode) {
        return { content: [{ type: "text", text: "Could not resolve one of the locations." }], isError: true };
      }
      const result = await submitAttempt(fromNode.id, toNode.id, seconds, holder);
      return {
        content: [
          {
            type: "text",
            text: result.isNewRecord
              ? `New record! ${holder}: ${fmtSeconds(seconds)} — previous best stands beaten.`
              : `Not a new record. Best remains ${fmtSeconds(result.best.bestSeconds)} by ${result.best.holder}.`,
          },
        ],
        structuredContent: result,
      };
    }
  );
});

export { handler as GET, handler as POST };
