import {
  EDGES,
  NODES,
  NodeId,
  VenueEdge,
  AVG_WALK_SPEED_MPS,
  AVG_WHEELCHAIR_SPEED_MPS,
} from "./venue";
import { ObstacleRecord } from "./store";

export interface RouteStep {
  edge: VenueEdge;
  fromName: string;
  toName: string;
  seconds: number;
}

export interface RouteResult {
  nodeIds: NodeId[];
  steps: RouteStep[];
  totalMeters: number;
  totalSeconds: number;
}

interface AdjEntry {
  to: NodeId;
  edge: VenueEdge;
  seconds: number;
}

function buildAdjacency(
  accessible: boolean,
  obstacles: Record<string, ObstacleRecord>
): Map<NodeId, AdjEntry[]> {
  const speed = accessible ? AVG_WHEELCHAIR_SPEED_MPS : AVG_WALK_SPEED_MPS;
  const adj = new Map<NodeId, AdjEntry[]>();
  const addEdge = (from: NodeId, to: NodeId, edge: VenueEdge) => {
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from)!.push({ to, edge, seconds: edge.distanceMeters / speed });
  };

  for (const edge of EDGES) {
    if (accessible && !edge.wheelchairOk) continue;
    const obstacle = obstacles[edge.id];
    if (obstacle?.status === "blocked") continue;
    // Venue corridors are walkable both directions.
    addEdge(edge.from, edge.to, edge);
    addEdge(edge.to, edge.from, edge);
  }
  return adj;
}

export function computeRoute(
  fromId: NodeId,
  toId: NodeId,
  accessible: boolean,
  obstacles: Record<string, ObstacleRecord>
): RouteResult | null {
  const adj = buildAdjacency(accessible, obstacles);
  const dist = new Map<NodeId, number>();
  const prevEdge = new Map<NodeId, { from: NodeId; edge: VenueEdge }>();
  const visited = new Set<NodeId>();

  for (const n of NODES) dist.set(n.id, Infinity);
  dist.set(fromId, 0);

  // Simple O(V^2) Dijkstra — the venue graph is tiny, no need for a heap.
  while (visited.size < NODES.length) {
    let current: NodeId | null = null;
    let currentDist = Infinity;
    for (const n of NODES) {
      if (visited.has(n.id)) continue;
      const d = dist.get(n.id)!;
      if (d < currentDist) {
        currentDist = d;
        current = n.id;
      }
    }
    if (current === null) break;
    visited.add(current);
    if (current === toId) break;

    for (const entry of adj.get(current) ?? []) {
      const alt = currentDist + entry.seconds;
      if (alt < (dist.get(entry.to) ?? Infinity)) {
        dist.set(entry.to, alt);
        prevEdge.set(entry.to, { from: current, edge: entry.edge });
      }
    }
  }

  if ((dist.get(toId) ?? Infinity) === Infinity) return null;

  const nodeIds: NodeId[] = [toId];
  const steps: RouteStep[] = [];
  let cursor = toId;
  const nameOf = (id: NodeId) => NODES.find((n) => n.id === id)?.name ?? id;
  const speed = accessible ? AVG_WHEELCHAIR_SPEED_MPS : AVG_WALK_SPEED_MPS;

  while (cursor !== fromId) {
    const step = prevEdge.get(cursor);
    if (!step) break; // shouldn't happen if dist was finite
    steps.push({
      edge: step.edge,
      fromName: nameOf(step.from),
      toName: nameOf(cursor),
      seconds: step.edge.distanceMeters / speed,
    });
    nodeIds.push(step.from);
    cursor = step.from;
  }

  nodeIds.reverse();
  steps.reverse();

  const totalMeters = steps.reduce((sum, s) => sum + s.edge.distanceMeters, 0);
  const totalSeconds = dist.get(toId)!;

  return { nodeIds, steps, totalMeters, totalSeconds };
}
