import type { Pt, RouteResult } from "./routing";
import { simTime } from "./crowd";
import {
  ROUTER, STAIRS_NODES, CONNECTOR_BY_NAME, levelOf, connectorOf, crowdFactors, findPlace, suggestPlaces, standInfo,
  EXAMPLE_PLACES, type Place,
} from "./venue";
import { getObstacles, getConfirmations, getLeaderboard, PERSISTENT, type Mobility, type ObstacleRecord } from "./store";

/** Mobility profiles from team-05: walking speed, stairs cost factor, room needed in crowds. */
export const MOBILITY: Record<Mobility, { label: string; speed: number; stairs: number; space: number }> = {
  walk: { label: "Walking", speed: 1.34, stairs: 1, space: 1 },
  // stairs possible but 3x as costly: taken only if the next lift is a real detour
  cane: { label: "Cane / crutches", speed: 0.8, stairs: 3, space: 1.2 },
  // no stairs at all; needs more room, so crowds slow it down earlier
  wheelchair: { label: "Wheelchair", speed: 0.9, stairs: Infinity, space: 1.6 },
};

export const ESTIMATE_DISCLAIMER =
  "Prototype: ground floor from the venue wayfinder, 1. OG and its stairs/lifts mapped from the event plan and photos; visitor density is simulated.";

export interface Segment {
  level: "eg" | "og";
  points: Pt[];
}

interface Leg {
  fromName: string;
  toName: string;
  dest: Place["instances"][number] | null;
  meters: number;
  via: string[];
  steps: string[];
  segments: Segment[];
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export function fmtSeconds(s: number) {
  const total = Math.round(s);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return m ? `${m}:${String(sec).padStart(2, "0")} min` : `${sec} s`;
}

function describe(r: RouteResult, from: Place, to: Place): Leg {
  const segments: Segment[] = [];
  const steps: string[] = [];
  const via: string[] = [];
  let level = levelOf(r.nodeIds[0]);
  let cur: Pt[] = [r.points[0]];
  let walked = 0;
  const floor = (l: string) => (l === "og" ? "on the 1. OG" : "on the ground floor");

  for (let i = 1; i < r.nodeIds.length; i++) {
    const a = connectorOf(r.nodeIds[i - 1]);
    const b = connectorOf(r.nodeIds[i]);
    const next = levelOf(r.nodeIds[i]);
    if (a && b && a.id === b.id && next !== level) {
      if (walked > 1) steps.push(`Walk ~${Math.round(walked)} m ${floor(level)}`);
      segments.push({ level, points: cur });
      steps.push(`Take ${a.name} ${next === "og" ? "up to the 1. OG" : "down to the ground floor"}`);
      via.push(a.name);
      level = next;
      cur = [r.points[i]];
      walked = 0;
      continue;
    }
    const [x0, y0] = r.points[i - 1],
      [x1, y1] = r.points[i];
    walked += Math.hypot(x1 - x0, y1 - y0);
    cur.push(r.points[i]);
  }
  segments.push({ level, points: cur });

  const first = r.nodeIds[0],
    last = r.nodeIds[r.nodeIds.length - 1];
  const fromName = from.instances.find((i) => i.anchors.includes(first))?.name ?? from.name;
  const dest = to.instances.find((i) => i.anchors.includes(last)) ?? null;
  const toName = dest?.name ?? to.name;
  if (walked > 1) steps.push(`Walk ~${Math.round(walked)} m ${floor(level)} to ${toName}`);

  return {
    fromName,
    toName,
    dest,
    meters: Math.round(r.meters),
    via,
    steps,
    segments: segments.map((s) => ({ level: s.level, points: s.points.map(([x, y]) => [r1(x), r1(y)] as Pt) })),
  };
}

function unresolved(q: string) {
  const s = suggestPlaces(q);
  return `I couldn't find "${q}" in the venue data.${s.length ? ` Closest matches: ${s.join("; ")}.` : ""} Try for example: ${EXAMPLE_PLACES.join(", ")}.`;
}

function blockedFor(obstacles: ObstacleRecord[], stepFree: boolean) {
  const out = new Set<string>();
  for (const o of obstacles) if (o.affects === "everyone" || stepFree) for (const n of o.nodes) out.add(n);
  return out;
}

export interface PlanInput {
  from: string;
  to: string;
  mobility: Mobility;
  avoidCrowds: boolean;
}

export async function planRoute(input: PlanInput) {
  const { mobility, avoidCrowds } = input;
  const from = findPlace(input.from);
  if (!from) return { ok: false as const, error: unresolved(input.from) };
  const to = findPlace(input.to);
  if (!to) return { ok: false as const, error: unresolved(input.to) };

  const [obstacleMap, confirmations, top] = await Promise.all([getObstacles(), getConfirmations(), getLeaderboard(from.id, to.id, mobility)]);
  const obstacles = Object.values(obstacleMap).filter((o) => o.status === "blocked");
  const fa = from.instances.flatMap((i) => i.anchors),
    ta = to.instances.flatMap((i) => i.anchors);
  const t = simTime();
  const crowd = (space: number) => crowdFactors(t, space);
  const profile = MOBILITY[mobility];

  const run = (stairs: number, stepFree: boolean, space: number) =>
    ROUTER.route(fa, ta, { blocked: blockedFor(obstacles, stepFree), stairsNodes: STAIRS_NODES, stairsFactor: stairs, crowd: crowd(space), avoidCrowd: avoidCrowds });

  // The selected profile's route, plus fastest vs step-free at the same walking pace for the comparison,
  // so the gap is the detour (what better information can shrink), not the difference in speed.
  const main = run(profile.stairs, mobility !== "walk", profile.space);
  const fastest = run(1, false, 1);
  const stepFree = run(Infinity, true, 1);

  if (!main) {
    const blockers = obstacles.map((o) => `${o.label}${o.note ? ` (${o.note})` : ""}`).join("; ");
    return {
      ok: false as const,
      error:
        `No ${mobility === "walk" ? "" : "step-free "}route from ${from.name} to ${to.name} right now.` +
        (blockers ? ` Reported obstacles: ${blockers}.` : "") +
        (mobility !== "walk" && fastest ? " A route with stairs exists." : ""),
    };
  }

  const route = describe(main, from, to);
  const fastLeg = fastest ? describe(fastest, from, to) : null;
  const freeLeg = stepFree ? describe(stepFree, from, to) : null;
  const seconds = main.effMeters / profile.speed;
  const fastS = fastest ? fastest.effMeters / MOBILITY.walk.speed : null;
  const freeS = stepFree ? stepFree.effMeters / MOBILITY.walk.speed : null;
  const gapSeconds = fastS !== null && freeS !== null ? Math.max(0, Math.round(freeS - fastS)) : null;

  const checks = [...new Set([...route.via, ...(freeLeg?.via ?? [])])].map((name) => {
    const k = CONNECTOR_BY_NAME.get(name)!;
    return { name, kind: k.kind, placeId: k.id, confirmedAt: confirmations[k.id] ?? null, approx: k.approx };
  });
  const allPts = route.segments.flatMap((s) => s.points);
  const routeDiffers = fastLeg && fastLeg.via.join() !== route.via.join();

  return {
    ok: true as const,
    fromId: from.id,
    toId: to.id,
    data: {
      query: { from: input.from, to: input.to },
      mobility,
      mobilityLabel: profile.label,
      avoidCrowds,
      fromName: route.fromName,
      toName: route.toName,
      seconds: Math.round(seconds),
      timeLabel: fmtSeconds(seconds),
      distanceLabel: `${route.meters} m`,
      via: route.via,
      steps: route.steps,
      compare: {
        fastest: fastS !== null && fastLeg ? { seconds: Math.round(fastS), label: fmtSeconds(fastS), via: fastLeg.via } : null,
        stepFree: freeS !== null && freeLeg ? { seconds: Math.round(freeS), label: fmtSeconds(freeS), via: freeLeg.via } : null,
        gapSeconds,
      },
      leaderboard: top.map((a) => ({ holder: a.holder, seconds: a.seconds, label: fmtSeconds(a.seconds), recordedAt: a.recordedAt })),
      persistent: PERSISTENT,
      checks,
      notes: [from.note, to.note].filter((n): n is string => !!n),
      stand: route.dest ? standInfo(route.dest) : null,
      otherStands:
        to.instances.length > 1 && route.dest?.exhibitorId
          ? [...new Set(to.instances.filter((i) => i.exhibitorId !== route.dest!.exhibitorId).map((i) => i.name))].slice(0, 5)
          : [],
      destSpaceId: route.dest?.spaceId ?? null,
      disclaimer: ESTIMATE_DISCLAIMER,
      segments: route.segments,
      fastestSegments: routeDiffers ? fastLeg!.segments : null,
      start: allPts[0],
      end: allPts[allPts.length - 1],
      obstacles: obstacles.map((o) => ({ p: o.p, label: o.label, affects: o.affects })),
    },
  };
}

export type RouteData = Extract<Awaited<ReturnType<typeof planRoute>>, { ok: true }>["data"];
