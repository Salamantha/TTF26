import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { NODES, EDGES, findNode, findEdge } from "@/lib/venue";
import { computeRoute } from "@/lib/routing";
import { getObstacles, setObstacle, getLeaderboardEntry, submitAttempt } from "@/lib/store";

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

const handler = createMcpHandler((server) => {
  server.registerTool(
    "find_walking_route",
    {
      title: "Find walking route",
      description: "Finds an ordinary walking route between two points inside the Salzburg Messe demo graph, avoiding currently reported blocked segments. Accessibility has not been assessed.",
      inputSchema: z.object({
        from: z.string().describe("Starting point, e.g. 'Westeingang' or 'entrance_west'"),
        to: z.string().describe("Destination, e.g. 'Halle 2' or 'TTF venue'"),
      }),
    },
    async ({ from, to }) => {
      const fromNode = findNode(from);
      const toNode = findNode(to);
      if (!fromNode || !toNode) {
        return {
          content: [{
            type: "text",
            text: `Could not resolve one of the locations. Known locations: ${NODES.map((n) => n.name).join(", ")}.`,
          }],
          isError: true,
        };
      }

      const obstacles = await getObstacles();
      const route = computeRoute(fromNode.id, toNode.id, false, obstacles);
      if (!route) {
        return {
          content: [{
            type: "text",
            text: `No walking route found between ${fromNode.name} and ${toNode.name} right now — it may be fully blocked by reported obstacles.`,
          }],
          isError: true,
        };
      }

      const mapUrl = `${getBaseUrl()}/map?route=${route.nodeIds.join(",")}`;
      const stepsText = route.steps
        .map((s) => `- ${s.fromName} → ${s.toName} (${s.edge.type}, ${fmtSeconds(s.seconds)})`)
        .join("\n");

      return {
        content: [{
          type: "text",
          text: `Walking route from ${fromNode.name} to ${toNode.name}: ${fmtSeconds(route.totalSeconds)} over ${Math.round(route.totalMeters)}m.\n\n${stepsText}\n\nAccessibility has not been verified for this route.\n\nMap: ${mapUrl}`,
        }],
        structuredContent: {
          from: fromNode.name,
          to: toNode.name,
          routeType: "ordinary-walking",
          accessibilityVerified: false,
          totalSeconds: route.totalSeconds,
          totalMeters: route.totalMeters,
          nodeIds: route.nodeIds,
          mapUrl,
        },
      };
    }
  );

  server.registerTool(
    "report_obstacle",
    {
      title: "Report an obstacle",
      description:
        "Reports that a path segment (e.g. an elevator or ramp) is currently blocked or has been fixed. Updates live routing immediately for everyone using the walking route finder. Use this to keep information current instead of relying on outdated venue signage.",
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
      title: "Get walking-route leaderboard",
      description: "Gets the fastest recorded walking-route time between two points, if any.",
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
      title: "Log a walking-route attempt",
      description:
        "Submits a completed walking-route time between two points for the leaderboard/race feature.",
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
