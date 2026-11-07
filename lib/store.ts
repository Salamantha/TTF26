// Live state: reported obstacles, "still working" confirmations and the route-race leaderboard.
// Backed by Upstash Redis when configured (Vercel's Upstash integration sets KV_REST_API_URL /
// KV_REST_API_TOKEN; plain Upstash uses UPSTASH_REDIS_REST_*). Without it everything lives in memory and
// resets whenever the serverless function cold-starts.
import { Redis } from "@upstash/redis";

export interface ObstacleRecord {
  placeId: string;
  label: string;
  p: [number, number];
  nodes: string[];
  /** "wheelchair" obstacles (broken lift, steps, narrow gap) only affect step-free routing. */
  affects: "everyone" | "wheelchair";
  status: "blocked" | "clear";
  note?: string;
  reportedAt: string;
}

export interface Attempt {
  holder: string;
  seconds: number;
  recordedAt: string;
}

export type Mobility = "walk" | "cane" | "wheelchair";

const OBSTACLES_KEY = "obstacles:v2";
const CONFIRM_KEY = "confirm:v1";
const lbKey = (fromId: string, toId: string, mobility: Mobility) => `lb:v2:${fromId}->${toId}:${mobility}`;

const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;
export const PERSISTENT = !!redis;

const mem = {
  obstacles: new Map<string, ObstacleRecord>(),
  confirm: new Map<string, string>(),
  lb: new Map<string, Attempt[]>(),
};

export async function getObstacles(): Promise<Record<string, ObstacleRecord>> {
  if (!redis) return Object.fromEntries(mem.obstacles);
  return (await redis.hgetall<Record<string, ObstacleRecord>>(OBSTACLES_KEY)) ?? {};
}

export async function setObstacle(record: Omit<ObstacleRecord, "reportedAt">) {
  const full: ObstacleRecord = { ...record, reportedAt: new Date().toISOString() };
  if (redis) await redis.hset(OBSTACLES_KEY, { [record.placeId]: full });
  else mem.obstacles.set(record.placeId, full);
  // A blocked report invalidates any earlier "it works" confirmation, a clear report counts as one.
  if (record.status === "blocked") await clearConfirmation(record.placeId);
  else await confirmWorking(record.placeId);
  return full;
}

/** placeId → ISO time someone last confirmed it works (e.g. "Lift West is running"). */
export async function getConfirmations(): Promise<Record<string, string>> {
  if (!redis) return Object.fromEntries(mem.confirm);
  return (await redis.hgetall<Record<string, string>>(CONFIRM_KEY)) ?? {};
}

async function confirmWorking(placeId: string) {
  const at = new Date().toISOString();
  if (redis) await redis.hset(CONFIRM_KEY, { [placeId]: at });
  else mem.confirm.set(placeId, at);
}

async function clearConfirmation(placeId: string) {
  if (redis) await redis.hdel(CONFIRM_KEY, placeId);
  else mem.confirm.delete(placeId);
}

const parse = (m: unknown): Omit<Attempt, "seconds"> => (typeof m === "string" ? JSON.parse(m) : (m as Omit<Attempt, "seconds">));

/** Fastest `n` attempts for a route and profile; the first one is the record. */
export async function getLeaderboard(fromId: string, toId: string, mobility: Mobility, n = 3): Promise<Attempt[]> {
  const key = lbKey(fromId, toId, mobility);
  if (!redis) return (mem.lb.get(key) ?? []).slice(0, n);
  const raw = await redis.zrange<unknown[]>(key, 0, n - 1, { withScores: true });
  const out: Attempt[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) out.push({ ...parse(raw[i]), seconds: Number(raw[i + 1]) });
  return out;
}

export async function submitAttempt(fromId: string, toId: string, mobility: Mobility, seconds: number, holder: string) {
  const key = lbKey(fromId, toId, mobility);
  const attempt: Attempt = { holder, seconds, recordedAt: new Date().toISOString() };
  const before = (await getLeaderboard(fromId, toId, mobility, 1))[0] ?? null;
  let rank: number;
  if (redis) {
    await redis.zadd(key, { score: seconds, member: JSON.stringify({ holder, recordedAt: attempt.recordedAt }) });
    rank = (await redis.zcount(key, "-inf", `(${seconds}`)) + 1;
  } else {
    const list = [...(mem.lb.get(key) ?? []), attempt].sort((a, b) => a.seconds - b.seconds);
    mem.lb.set(key, list);
    rank = list.filter((a) => a.seconds < seconds).length + 1;
  }
  return { isNewRecord: !before || seconds < before.seconds, previousRecord: before, rank, top: await getLeaderboard(fromId, toId, mobility) };
}
