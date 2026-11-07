"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

interface VenueNode {
  id: string;
  name: string;
  x: number;
  y: number;
}

interface VenueEdge {
  id: string;
  from: string;
  to: string;
  type: "walk" | "elevator" | "stairs" | "ramp";
  wheelchairOk: boolean;
}

interface ObstacleRecord {
  status: "blocked" | "clear";
  note?: string;
}

interface GraphData {
  nodes: VenueNode[];
  edges: VenueEdge[];
  obstacles: Record<string, ObstacleRecord>;
}

export default function MapView() {
  const params = useSearchParams();
  const routeParam = params.get("route");
  const accessible = params.get("accessible") !== "false";
  const routeNodeIds = routeParam ? routeParam.split(",") : [];

  const [data, setData] = useState<GraphData | null>(null);

  useEffect(() => {
    fetch("/api/venue-graph")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, []);

  if (!data) {
    return <p style={{ padding: 24, fontFamily: "sans-serif" }}>Loading map…</p>;
  }

  const { nodes, edges, obstacles } = data;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const routeEdgeKeys = new Set<string>();
  for (let i = 0; i < routeNodeIds.length - 1; i++) {
    routeEdgeKeys.add(`${routeNodeIds[i]}|${routeNodeIds[i + 1]}`);
    routeEdgeKeys.add(`${routeNodeIds[i + 1]}|${routeNodeIds[i]}`);
  }

  const padding = 40;
  const width = Math.max(...nodes.map((n) => n.x)) + padding * 2;
  const height = Math.max(...nodes.map((n) => n.y)) + padding * 2;

  return (
    <div style={{ fontFamily: "sans-serif", padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 4 }}>Salzburg Messe — venue map</h1>
      <p style={{ color: "#666", marginTop: 0 }}>
        Prototype preview using the supplied venue floor-plan geometry.
      </p>

      <section style={{ margin: "20px 0 28px" }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Venue floor plan</h2>
        <div style={{ background: "#f4f4f2", border: "1px solid #ddd", borderRadius: 10, overflow: "auto", textAlign: "center" }}>
          <img
            src="/venue-floorplan-prototype.svg"
            alt="Prototype floor plan of Salzburg Messe showing halls and selected points of interest"
            style={{ display: "block", width: "100%", maxWidth: 620, height: "auto", margin: "0 auto" }}
          />
        </div>
        <p style={{ color: "#777", fontSize: 12, lineHeight: 1.5 }}>
          Reference floor plan only. The route graph below is still the hand-authored demo graph
          and is not geographically aligned to this floor plan. Accessibility and step-free
          connections in the supplied source data have not yet been independently verified.
        </p>
      </section>

      <section>
        <h2 style={{ fontSize: 18, marginBottom: 4 }}>
          Demo routing graph — {accessible ? "Accessible mode" : "Fastest mode"}
        </h2>
        <p style={{ color: "#666", marginTop: 0 }}>
          {routeNodeIds.length > 0
            ? `${nodeById.get(routeNodeIds[0])?.name ?? routeNodeIds[0]} → ${
                nodeById.get(routeNodeIds[routeNodeIds.length - 1])?.name ?? routeNodeIds[routeNodeIds.length - 1]
              }`
            : "No route selected"}
        </p>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          style={{ maxWidth: 960, background: "#fafafa", border: "1px solid #ddd", borderRadius: 8 }}
        >
          {edges.map((e) => {
            const a = nodeById.get(e.from);
            const b = nodeById.get(e.to);
            if (!a || !b) return null;
            const isOnRoute = routeEdgeKeys.has(`${e.from}|${e.to}`);
            const isBlocked = obstacles[e.id]?.status === "blocked";
            const stroke = isBlocked ? "#d33" : isOnRoute ? "#1a7f37" : "#bbb";
            const strokeWidth = isOnRoute ? 5 : 2;
            const dash = e.type === "stairs" || e.type === "elevator" ? "6,4" : undefined;
            return (
              <g key={e.id}>
                <line
                  x1={a.x + padding}
                  y1={a.y + padding}
                  x2={b.x + padding}
                  y2={b.y + padding}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  strokeDasharray={dash}
                />
                {isBlocked && (
                  <text
                    x={(a.x + b.x) / 2 + padding}
                    y={(a.y + b.y) / 2 + padding - 8}
                    fontSize={11}
                    fill="#d33"
                    textAnchor="middle"
                  >
                    ⚠ blocked
                  </text>
                )}
              </g>
            );
          })}
          {nodes.map((n) => (
            <g key={n.id}>
              <circle
                cx={n.x + padding}
                cy={n.y + padding}
                r={routeNodeIds.includes(n.id) ? 9 : 6}
                fill={routeNodeIds.includes(n.id) ? "#1a7f37" : "#555"}
              />
              <text x={n.x + padding + 10} y={n.y + padding + 4} fontSize={12} fill="#222">
                {n.name}
              </text>
            </g>
          ))}
        </svg>
        <p style={{ color: "#888", fontSize: 13, marginTop: 12 }}>
          Dashed lines are stairs/elevator segments. Red = reported obstacle. Green = selected demo route.
        </p>
      </section>
    </div>
  );
}
