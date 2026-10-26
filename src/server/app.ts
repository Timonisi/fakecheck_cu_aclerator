import { Hono } from "hono";
import { cors } from "hono/cors";
import type { DatabaseSync } from "node:sqlite";
import type { BacktestResult } from "../backtest/backtest.ts";
import { runBacktest } from "../backtest/backtest.ts";
import { latestExperiment, loadCommunity, replaceCommunityData, insertExperiment } from "../db/database.ts";
import { experimentReport } from "../scoring/experiment.ts";
import { observedMetrics } from "../scoring/experiment.ts";
import { splitLists } from "../scoring/lists.ts";
import { scoringConfig } from "../scoring/scoring.config.ts";
import { scoreMembers } from "../scoring/score.ts";
import { removalBatch, simulateRemoval } from "../scoring/simulate.ts";
import { VkApi, ingestCommunity, removeMember, type IngestedCommunity } from "../vk/ingest.ts";
import { isValidVkLaunch } from "../vk/launch.ts";

const PREVIEW = 200;

export type VkGateway = {
  ingest: () => Promise<IngestedCommunity>;
  removeUser: (userId: number) => Promise<void>;
};

function parseN(body: unknown): number | null {
  if (body == null || typeof body !== "object" || !("n" in body)) return null;
  const value = (body as { n: unknown }).n;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

function sessionFrom(body: unknown): { accessToken: string; groupId: number } | null {
  if (body == null || typeof body !== "object") return null;
  const record = body as { accessToken?: unknown; groupId?: unknown };
  const accessToken = typeof record.accessToken === "string" ? record.accessToken.trim() : "";
  const groupId = Number(record.groupId);
  if (!accessToken || !Number.isInteger(groupId) || groupId <= 0) return null;
  return { accessToken, groupId };
}

function launchedGroupId(header: string | undefined): number {
  const groupId = Number(new URLSearchParams(header ?? "").get("vk_group_id") ?? 0);
  return Number.isInteger(groupId) && groupId > 0 ? groupId : 0;
}

function allowedOrigin(origin: string): string | undefined {
  let host = "";
  try {
    host = new URL(origin).hostname;
  } catch {
    return undefined;
  }
  const ok =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "vk.com" ||
    host === "vk.ru" ||
    host === "ok.ru" ||
    host.endsWith(".vk.com") ||
    host.endsWith(".vk.ru") ||
    host.endsWith(".ok.ru") ||
    host.endsWith(".vk-apps.com") ||
    host.endsWith(".vkuser.net");
  return ok ? origin : undefined;
}

export function createApp(options: {
  db: DatabaseSync;
  vk: VkGateway | null;
  now?: () => number;
  appSecret?: string;
  groupId?: number;
}) {
  const app = new Hono();
  app.use(
    "*",
    cors({
      origin: (origin) => allowedOrigin(origin) ?? null,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["content-type", "x-vk-params"],
    }),
  );
  app.use("*", async (c, next) => {
    if (c.req.method === "OPTIONS" || c.req.path === "/health") return next();
    const raw = c.req.header("x-vk-params") ?? "";
    if (options.appSecret && !isValidVkLaunch(raw, options.appSecret)) {
      return c.json({ error: "Подпись запуска мини-приложения не сошлась" }, 401);
    }
    const launchedGroup = Number(new URLSearchParams(raw).get("vk_group_id") ?? 0);
    if (launchedGroup && options.groupId && launchedGroup !== options.groupId) {
      return c.json({ error: "Мини-приложение открыто в другом сообществе" }, 403);
    }
    await next();
  });
  const now = () => options.now?.() ?? Math.floor(Date.now() / 1000);
  let backtestCache: { key: string; result: BacktestResult } | null = null;

  function community() {
    return loadCommunity(options.db);
  }

  function scored() {
    const data = community();
    const scores = scoreMembers({ ...data, now: now() });
    return { data, scores, lists: splitLists(scores) };
  }

  function backtestFor(data: ReturnType<typeof community>): BacktestResult {
    const exposureNow = now();
    const key = JSON.stringify({
      posts: data.posts,
      events: data.events,
      members: data.members,
      exposureNow,
    });
    if (backtestCache?.key === key) return backtestCache.result;
    const result = runBacktest({ ...data, exposureNow });
    backtestCache = { key, result };
    return result;
  }

  function preview(items: ReturnType<typeof scored>["lists"]["harmReach"]) {
    return items.slice(0, PREVIEW);
  }

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/overview", (c) => {
    const { data, lists } = scored();
    const backtest = backtestFor(data);
    return c.json({
      synced: data.posts.length > 0 || data.members.length > 0,
      harmCount: lists.harmReach.length,
      deadWeightCount: lists.deadWeight.length,
      deadAccountCount: lists.deadAccounts.length,
      harmReach: preview(lists.harmReach),
      deadWeight: preview(lists.deadWeight),
      deadAccounts: preview(lists.deadAccounts),
      backtest,
      removeBatchSize: scoringConfig.removeBatchSize,
    });
  });

  app.post("/simulate", async (c) => {
    const n = parseN(await c.req.json().catch(() => null));
    if (n == null) return c.json({ error: "Поле n должно быть неотрицательным числом" }, 400);
    const { data, scores, lists } = scored();
    const simulation = simulateRemoval(scores, lists.harmReach, n);
    const backtest = backtestFor(data);
    return c.json({
      ...simulation,
      auc: backtest.auc,
      aucUnreliable: backtest.aucUnreliable,
      backtestStatus: backtest.status,
    });
  });

  app.post("/sync", async (c) => {
    const body = await c.req.json().catch(() => null);
    const session = sessionFrom(body);
    const launched = launchedGroupId(c.req.header("x-vk-params"));
    if (session && launched && launched !== session.groupId) {
      return c.json({ error: "Мини-приложение открыто в другом сообществе" }, 403);
    }
    try {
      let ingested: IngestedCommunity | null = null;
      if (session) {
        const api = new VkApi(session.accessToken);
        ingested = await ingestCommunity((method, params) => api.call(method, params), session.groupId);
      } else if (options.vk) {
        ingested = await options.vk.ingest();
      }
      if (!ingested) return c.json({ error: "Нет ключа сообщества. Разрешите управление и сообщения." }, 400);
      replaceCommunityData(options.db, ingested);
      backtestCache = null;
      return c.json({
        posts: ingested.posts.length,
        events: ingested.events.length,
        members: ingested.members.length,
        warnings: ingested.warnings,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 502);
    }
  });

  app.get("/experiment", (c) => {
    const experiment = latestExperiment(options.db);
    if (!experiment) return c.json({ experiment: null });
    const data = community();
    return c.json(experimentReport(experiment, data.posts, data.events, now()));
  });

  app.post("/remove", async (c) => {
    const body = await c.req.json().catch(() => null);
    const n = parseN(body);
    if (n == null) return c.json({ error: "Поле n должно быть неотрицательным числом" }, 400);
    const session = sessionFrom(body);
    const launched = launchedGroupId(c.req.header("x-vk-params"));
    if (session && launched && launched !== session.groupId) {
      return c.json({ error: "Мини-приложение открыто в другом сообществе" }, 403);
    }
    let removeUser: ((userId: number) => Promise<void>) | undefined;
    if (session) {
      const api = new VkApi(session.accessToken);
      const groupId = session.groupId;
      removeUser = (userId) => removeMember((method, params) => api.call(method, params), groupId, userId);
    } else {
      removeUser = options.vk?.removeUser;
    }
    if (!removeUser) return c.json({ error: "Нет ключа сообщества. Разрешите управление и сообщения." }, 400);
    const { data, lists } = scored();
    const batch = removalBatch(lists.harmReach, n, scoringConfig.removeBatchSize);
    if (batch.length === 0) return c.json({ error: "В пуле «вредят охвату» некого удалять" }, 400);
    const metrics = observedMetrics(data.posts, data.events);
    const removed: number[] = [];
    const failed: Array<{ userId: number; error: string }> = [];
    for (const score of batch) {
      try {
        await removeUser(score.userId);
        removed.push(score.userId);
      } catch (error) {
        failed.push({ userId: score.userId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    let experimentId: number | null = null;
    if (removed.length > 0) {
      experimentId = insertExperiment(options.db, {
        createdAt: now(),
        removedIds: removed,
        postIds: metrics.postIds,
        erAll: metrics.erAll,
        erCommentsReposts: metrics.erCommentsReposts,
        avgReach: metrics.avgReach,
        reachSource: metrics.reachSource,
        nRemoved: removed.length,
      });
      backtestCache = null;
    }
    return c.json({ removed, failed, experimentId, batchSize: scoringConfig.removeBatchSize });
  });

  return app;
}
