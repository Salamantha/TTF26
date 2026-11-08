// Live state: reported obstacles, "still working" confirmations and the route-race leaderboard.
// Stored in Postgres (Neon) when DATABASE_URL is set — Vercel's Neon integration sets it; the tables are
// created on first use. Without it everything lives in memory and resets on every cold start.
import { neon } from "@neondatabase/serverless";

export interface ObstacleRecord {
  placeId: string;
  label: string;
  p: [number, number];
  nodes: string[];
  /** "wheelchair" obstacles (broken lift, steps, narrow gap) only affect step-free routing. */
  affects: "everyone" | "wheelchair";
  status: "blocked" | "clear";
  note?: string;
  /** obstacle areas marked on the map: radius in metres and floor (0 = ground floor, 1 = 1. OG) */
  radius?: number;
  level?: 0 | 1;
  reportedAt: string;
}

export interface Attempt {
  holder: string;
  seconds: number;
  recordedAt: string;
}

export type Mobility = "walk" | "cane" | "wheelchair";

const keyFor = (fromId: string, toId: string, mobility: Mobility) => `${fromId}->${toId}:${mobility}`;
const routeKey = keyFor;

const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const sql = url ? neon(url) : null;
export const PERSISTENT = !!sql;

const SCHEMA = [
  `create table if not exists ttf_obstacles (place_id text primary key, record jsonb not null)`,
  `create table if not exists ttf_confirmations (place_id text primary key, confirmed_at timestamptz not null)`,
  `create table if not exists ttf_attempts (id bigserial primary key, route_key text not null, holder text not null, seconds integer not null, recorded_at timestamptz not null default now())`,
  `create index if not exists ttf_attempts_route_seconds on ttf_attempts (route_key, seconds)`,
  `alter table ttf_attempts add column if not exists splits jsonb`,
  `create table if not exists ttf_deviations (id bigserial primary key, route_key text not null, part_id text, part_title text, reason text not null, note text, p jsonb, level integer, created_at timestamptz not null default now())`,
];
let ready: Promise<void> | null = null;

async function db() {
  if (!sql) return null;
  ready ??= (async () => {
    for (const s of SCHEMA) await sql.query(s);
  })().catch((e) => {
    ready = null;
    throw e;
  });
  await ready;
  return sql;
}

const iso = (v: unknown) => new Date(v as string).toISOString();

const mem = {
  obstacles: new Map<string, ObstacleRecord>(),
  confirm: new Map<string, string>(),
  attempts: new Map<string, Attempt[]>(),
  splits: new Map<string, Record<string, number>[]>(),
  deviations: [] as Deviation[],
};

export async function getObstacles(): Promise<Record<string, ObstacleRecord>> {
  const q = await db();
  if (!q) return Object.fromEntries(mem.obstacles);
  const rows = await q.query(`select place_id, record from ttf_obstacles`);
  return Object.fromEntries(rows.map((r) => [r.place_id, r.record as ObstacleRecord]));
}

export async function setObstacle(record: Omit<ObstacleRecord, "reportedAt">) {
  const full: ObstacleRecord = { ...record, reportedAt: new Date().toISOString() };
  const q = await db();
  if (q) {
    await q.query(
      `insert into ttf_obstacles (place_id, record) values ($1, $2) on conflict (place_id) do update set record = excluded.record`,
      [record.placeId, JSON.stringify(full)]
    );
  } else mem.obstacles.set(record.placeId, full);
  // A blocked report invalidates any earlier "it works" confirmation; a clear report counts as one.
  if (record.status === "blocked") await clearConfirmation(record.placeId);
  else await confirmWorking(record.placeId);
  return full;
}

/** placeId → ISO time someone last confirmed it works (e.g. "Lift West is running"). */
export async function getConfirmations(): Promise<Record<string, string>> {
  const q = await db();
  if (!q) return Object.fromEntries(mem.confirm);
  const rows = await q.query(`select place_id, confirmed_at from ttf_confirmations`);
  return Object.fromEntries(rows.map((r) => [r.place_id, iso(r.confirmed_at)]));
}

async function confirmWorking(placeId: string) {
  const q = await db();
  if (q) {
    await q.query(
      `insert into ttf_confirmations (place_id, confirmed_at) values ($1, now()) on conflict (place_id) do update set confirmed_at = now()`,
      [placeId]
    );
  } else mem.confirm.set(placeId, new Date().toISOString());
}

async function clearConfirmation(placeId: string) {
  const q = await db();
  if (q) await q.query(`delete from ttf_confirmations where place_id = $1`, [placeId]);
  else mem.confirm.delete(placeId);
}

/** Fastest `n` attempts for a route and profile; the first one is the record. */
export async function getLeaderboard(fromId: string, toId: string, mobility: Mobility, n = 3): Promise<Attempt[]> {
  const key = routeKey(fromId, toId, mobility);
  const q = await db();
  if (!q) return (mem.attempts.get(key) ?? []).slice(0, n);
  const rows = await q.query(
    `select holder, seconds, recorded_at from ttf_attempts where route_key = $1 order by seconds, recorded_at limit $2`,
    [key, n]
  );
  return rows.map((r) => ({ holder: r.holder, seconds: Number(r.seconds), recordedAt: iso(r.recorded_at) }));
}

/** Best ("gold") split per route part id over all attempts, as in speedruns. */
export async function getBestSplits(fromId: string, toId: string, mobility: Mobility): Promise<Record<string, number>> {
  const key = routeKey(fromId, toId, mobility);
  const q = await db();
  const all: Record<string, number>[] = q
    ? (await q.query(`select splits from ttf_attempts where route_key = $1 and splits is not null`, [key])).map((r) => r.splits)
    : mem.splits.get(key) ?? [];
  const best: Record<string, number> = {};
  for (const s of all) for (const [id, sec] of Object.entries(s)) if (!(id in best) || sec < best[id]) best[id] = sec;
  return best;
}

export async function submitAttempt(fromId: string, toId: string, mobility: Mobility, seconds: number, holder: string, splits?: Record<string, number>) {
  const key = routeKey(fromId, toId, mobility);
  const goldBefore = splits ? await getBestSplits(fromId, toId, mobility) : {};
  const before = (await getLeaderboard(fromId, toId, mobility, 1))[0] ?? null;
  const q = await db();
  let rank: number;
  if (q) {
    await q.query(`insert into ttf_attempts (route_key, holder, seconds, splits) values ($1, $2, $3, $4)`, [key, holder, seconds, splits ? JSON.stringify(splits) : null]);
    const [{ n }] = await q.query(`select count(*)::int as n from ttf_attempts where route_key = $1 and seconds < $2`, [key, seconds]);
    rank = Number(n) + 1;
  } else {
    const list = [...(mem.attempts.get(key) ?? []), { holder, seconds, recordedAt: new Date().toISOString() }].sort((a, b) => a.seconds - b.seconds);
    mem.attempts.set(key, list);
    if (splits) mem.splits.set(key, [...(mem.splits.get(key) ?? []), splits]);
    rank = list.filter((a) => a.seconds < seconds).length + 1;
  }
  const goldSplits = splits ? Object.keys(splits).filter((id) => !(id in goldBefore) || splits[id] < goldBefore[id]) : [];
  return { isNewRecord: !before || seconds < before.seconds, previousRecord: before, rank, goldSplits, top: await getLeaderboard(fromId, toId, mobility) };
}

export interface Deviation {
  routeKey: string;
  partId: string | null;
  partTitle: string | null;
  reason: string;
  note: string | null;
  p: [number, number] | null;
  level: 0 | 1 | null;
  createdAt: string;
}

/** Someone left the planned route: where, and why. Shows organisers where the routing is wrong. */
export async function addDeviation(fromId: string, toId: string, mobility: Mobility, d: Omit<Deviation, "routeKey" | "createdAt">) {
  const routeKey = keyFor(fromId, toId, mobility);
  const q = await db();
  if (q) {
    await q.query(
      `insert into ttf_deviations (route_key, part_id, part_title, reason, note, p, level) values ($1, $2, $3, $4, $5, $6, $7)`,
      [routeKey, d.partId, d.partTitle, d.reason, d.note, d.p ? JSON.stringify(d.p) : null, d.level]
    );
  } else mem.deviations.push({ ...d, routeKey, createdAt: new Date().toISOString() });
}

export async function countDeviations(fromId: string, toId: string, mobility: Mobility): Promise<number> {
  const routeKey = keyFor(fromId, toId, mobility);
  const q = await db();
  if (!q) return mem.deviations.filter((d) => d.routeKey === routeKey).length;
  const [{ n }] = await q.query(`select count(*)::int as n from ttf_deviations where route_key = $1`, [routeKey]);
  return Number(n);
}
