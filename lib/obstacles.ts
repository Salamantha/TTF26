import { getObstacles, type ObstacleRecord } from "./store";

export interface ObstacleCard {
  id: string;
  title: string;
  where: string;
  affects: "everyone" | "wheelchair";
  reportedAt: string;
  p: [number, number];
  radius: number;
  level: 0 | 1;
  markedOnMap: boolean;
}

/** Splits "Lift Ost (lift to 1. OG)" into title and where; map-marked areas carry their area in the note. */
function toCard(o: ObstacleRecord): ObstacleCard {
  const markedOnMap = o.placeId.startsWith("area:");
  const m = o.label.match(/^(.*?)\s*\((.+)\)$/);
  const where = markedOnMap
    ? o.note?.replace(/^marked on the map in /, "") ?? ""
    : m
      ? m[2].charAt(0).toUpperCase() + m[2].slice(1)
      : o.note ?? "";
  return {
    id: o.placeId,
    title: markedOnMap || !m ? o.label : m[1],
    where,
    affects: o.affects,
    reportedAt: o.reportedAt,
    p: o.p,
    radius: o.radius ?? 4,
    level: o.level ?? (o.placeId.startsWith("og:") ? 1 : 0),
    markedOnMap,
  };
}

export async function obstacleList() {
  const all = Object.values(await getObstacles()).filter((o) => o.status === "blocked");
  all.sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
  return { obstacles: all.map(toCard) };
}
