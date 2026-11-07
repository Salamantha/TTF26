// Simplified graph of the Salzburg Messe venue for the demo.
// x/y are plan coordinates (arbitrary units, not geo) used by the SVG map at /map.
// Swap this out for real floorplan-derived coordinates when available.

export type NodeId = string;

export interface VenueNode {
  id: NodeId;
  name: string;
  x: number;
  y: number;
}

export type EdgeType = "walk" | "elevator" | "stairs" | "ramp";

export interface VenueEdge {
  id: string;
  from: NodeId;
  to: NodeId;
  distanceMeters: number;
  type: EdgeType;
  // Edges that are not usable by a wheelchair/crutches user at all (e.g. a stairs-only shortcut).
  wheelchairOk: boolean;
}

export const NODES: VenueNode[] = [
  { id: "entrance_west", name: "Westeingang", x: 0, y: 200 },
  { id: "entrance_east", name: "Osteingang", x: 800, y: 200 },
  { id: "foyer", name: "Foyer", x: 200, y: 200 },
  { id: "halle1", name: "Halle 1", x: 350, y: 80 },
  { id: "halle2", name: "Halle 2 (TTF Venue)", x: 500, y: 80 },
  { id: "halle3", name: "Halle 3", x: 650, y: 80 },
  { id: "halle4", name: "Halle 4", x: 350, y: 320 },
  { id: "halle5", name: "Halle 5", x: 500, y: 320 },
  { id: "corridor_north", name: "Nordgang", x: 500, y: 150 },
  { id: "corridor_south", name: "Südgang", x: 500, y: 250 },
  { id: "stairs_landing", name: "Treppenpodest", x: 420, y: 150 },
];

export const EDGES: VenueEdge[] = [
  { id: "e1", from: "entrance_west", to: "foyer", distanceMeters: 30, type: "walk", wheelchairOk: true },
  { id: "e2", from: "foyer", to: "halle1", distanceMeters: 40, type: "walk", wheelchairOk: true },
  { id: "e3", from: "halle1", to: "corridor_north", distanceMeters: 35, type: "walk", wheelchairOk: true },
  { id: "e4", from: "corridor_north", to: "halle2", distanceMeters: 20, type: "walk", wheelchairOk: true },
  { id: "e5", from: "halle2", to: "halle3", distanceMeters: 40, type: "walk", wheelchairOk: true },
  { id: "e6", from: "halle3", to: "entrance_east", distanceMeters: 60, type: "walk", wheelchairOk: true },

  // Fast but inaccessible shortcut: stairs directly from foyer up to the north corridor.
  { id: "e7", from: "foyer", to: "stairs_landing", distanceMeters: 15, type: "walk", wheelchairOk: true },
  { id: "e8", from: "stairs_landing", to: "corridor_north", distanceMeters: 10, type: "stairs", wheelchairOk: false },

  // Accessible but normally longer route via elevator through the south corridor.
  { id: "e9", from: "foyer", to: "halle4", distanceMeters: 55, type: "walk", wheelchairOk: true },
  { id: "e10", from: "halle4", to: "corridor_south", distanceMeters: 35, type: "walk", wheelchairOk: true },
  { id: "e11", from: "corridor_south", to: "halle5", distanceMeters: 20, type: "walk", wheelchairOk: true },
  { id: "e12", from: "halle5", to: "halle2", distanceMeters: 30, type: "elevator", wheelchairOk: true },

  // Ramp alternative between the two corridors, usually slower than the stairs shortcut.
  { id: "e13", from: "corridor_south", to: "corridor_north", distanceMeters: 50, type: "ramp", wheelchairOk: true },

  { id: "e14", from: "halle4", to: "halle5", distanceMeters: 150, type: "walk", wheelchairOk: true },
];

export const AVG_WALK_SPEED_MPS = 1.3; // ~4.7 km/h, roughly average walking pace
export const AVG_WHEELCHAIR_SPEED_MPS = 1.0; // slightly slower average for a wheelchair/crutches user

export function findNode(idOrName: string): VenueNode | undefined {
  const q = idOrName.trim().toLowerCase();
  return NODES.find(
    (n) => n.id.toLowerCase() === q || n.name.toLowerCase() === q || n.name.toLowerCase().includes(q)
  );
}

// Resolve only exact IDs or descriptions that identify exactly one edge.
// Returning undefined for vague/ambiguous descriptions is intentional: obstacle
// reports must never silently affect an unrelated segment.
export function findEdge(query: string): VenueEdge | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;

  const byId = EDGES.find((e) => e.id.toLowerCase() === q);
  if (byId) return byId;

  const types: EdgeType[] = ["elevator", "stairs", "ramp", "walk"];
  const typeHit = types.find((type) => q.includes(type));
  const candidates = typeHit ? EDGES.filter((e) => e.type === typeHit) : EDGES;

  const stopWords = new Set(["the", "near", "at", "by", "from", "to", "between", "and", "on", "in", "path", "segment"]);
  const locationWords = q
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !types.includes(word as EdgeType) && !stopWords.has(word));

  // A type-only description is safe only when that type identifies one edge.
  if (locationWords.length === 0) return candidates.length === 1 ? candidates[0] : undefined;

  const matches = candidates.filter((edge) => {
    const endpointNames = [edge.from, edge.to]
      .map((id) => NODES.find((node) => node.id === id)?.name.toLowerCase() ?? "")
      .join(" ");
    return locationWords.every((word) => endpointNames.includes(word));
  });

  return matches.length === 1 ? matches[0] : undefined;
}
