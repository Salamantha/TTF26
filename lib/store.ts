// Live state: reported obstacles + the accessible-route leaderboard.
//
// Backed by Upstash Redis when UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
// are set (persists across serverless invocations — set these up before the demo
// if you want obstacle reports / leaderboard to survive a cold start).
// Falls back to an in-memory Map otherwise, which is fine for local dev but
// resets whenever the serverless function cold-starts on Vercel.

import { Redis } from "@upstash/redis";

export interface ObstacleRecord {
  status: "blocked" | "clear";
  note?: string;
  reportedAt: string;
}

export interface LeaderboardRecord {
  bestSeconds: number;
  holder: string;
  recordedAt: string;
}

const memObstacles = new Map<string, ObstacleRecord>();
const memLeaderboard = new Map<string, LeaderboardRecord>();

function redisClient(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const redis = redisClient();

export async function getObstacles(): Promise<Record<string, ObstacleRecord>> {
  if (redis) {
    const keys = await redis.hkeys("obstacles");
    if (keys.length === 0) return {};
    const values = await redis.hmget<Record<string, ObstacleRecord>>("obstacles", ...keys);
    return values ?? {};
  }
  return Object.fromEntries(memObstacles);
}

export async function setObstacle(edgeId: string, status: "blocked" | "clear", note?: string) {
  const record: ObstacleRecord = { status, note, reportedAt: new Date().toISOString() };
  if (redis) {
    await redis.hset("obstacles", { [edgeId]: record });
  } else {
    memObstacles.set(edgeId, record);
  }
  return record;
}

function routeKey(fromId: string, toId: string) {
  return `${fromId}->${toId}`;
}

export async function getLeaderboardEntry(fromId: string, toId: string): Promise<LeaderboardRecord | null> {
  const key = routeKey(fromId, toId);
  if (redis) {
    const val = await redis.hget<LeaderboardRecord>("leaderboard", key);
    return val ?? null;
  }
  return memLeaderboard.get(key) ?? null;
}

export async function submitAttempt(
  fromId: string,
  toId: string,
  seconds: number,
  holder: string
): Promise<{ isNewRecord: boolean; best: LeaderboardRecord }> {
  const key = routeKey(fromId, toId);
  const current = await getLeaderboardEntry(fromId, toId);
  if (current && current.bestSeconds <= seconds) {
    return { isNewRecord: false, best: current };
  }
  const record: LeaderboardRecord = { bestSeconds: seconds, holder, recordedAt: new Date().toISOString() };
  if (redis) {
    await redis.hset("leaderboard", { [key]: record });
  } else {
    memLeaderboard.set(key, record);
  }
  return { isNewRecord: true, best: record };
}
