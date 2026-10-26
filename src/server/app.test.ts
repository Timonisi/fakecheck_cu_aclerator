import { describe, expect, it } from "vitest";
import { DAY_SECONDS } from "../scoring/scoring.config.ts";
import { addToWhitelist, latestExperiment, loadCommunity, openDatabase, replaceCommunityData } from "../db/database.ts";
import { experimentReport, observedMetrics } from "../scoring/experiment.ts";
import { splitLists } from "../scoring/lists.ts";
import { scoreMembers } from "../scoring/score.ts";
import { removalBatch, simulateRemoval } from "../scoring/simulate.ts";
import type { MemberRecord } from "../scoring/types.ts";
import { ingestCommunity } from "../vk/ingest.ts";
import { vkLaunchSign } from "../vk/launch.ts";
import { createApp } from "../server/app.ts";

const NOW = 1_700_000_000;

function person(overrides: Partial<MemberRecord> = {}): MemberRecord {
  return {
    userId: 1,
    lastSeen: NOW,
    lastSeenHidden: false,
    deactivated: null,
    role: null,
    isDonut: false,
    lastInboundDmTs: null,
    whitelisted: false,
    firstName: "А",
    lastName: "Б",
    ...overrides,
  };
}

function community() {
  const posts = [{ postId: 1, date: NOW, views: 100, reach: 80 }];
  const members = [
    person({ userId: 1, role: "admin" }),
    person({ userId: 2 }),
    person({ userId: 3 }),
    person({ userId: 4, lastSeen: NOW, firstName: "Лайк" }),
  ];
  const events = [{ userId: 4, postId: 1, type: "like" as const, ts: null }];
  return { posts, events, members };
}

describe("simulate", () => {
  it("keeps ER unchanged at n=0 and does not remove a protected manager", () => {
    const data = community();
    const scores = scoreMembers({ ...data, now: NOW });
    const lists = splitLists(scores);
    expect(lists.harmReach.map((score) => score.userId)).toEqual([2, 3, 4]);
    const same = simulateRemoval(scores, lists.harmReach, 0);
    expect(same.all.before).toBe(same.all.after);
    expect(same.commentsReposts.before).toBe(same.commentsReposts.after);
    expect(same.all.before).not.toBeCloseTo(same.commentsReposts.before!);
    const removed = simulateRemoval(scores, lists.harmReach, 2);
    expect(removed.selectedUserIds).toEqual([2, 3]);
    expect(removed.all.after!).toBeGreaterThanOrEqual(removed.all.before!);
    expect(removed.commentsReposts.after!).toBeGreaterThanOrEqual(removed.commentsReposts.before!);
  });

  it("caps a removal batch at 200", () => {
    const pool = Array.from({ length: 250 }, (_, index) => ({ userId: index + 1 })) as ReturnType<
      typeof scoreMembers
    >;
    expect(removalBatch(pool, 1000, 200)).toHaveLength(200);
    expect(removalBatch(pool, 0, 200)).toHaveLength(0);
  });
});

describe("database and experiment", () => {
  it("keeps the whitelist while replacing community data", () => {
    const db = openDatabase(":memory:");
    addToWhitelist(db, 4);
    replaceCommunityData(db, community());
    const loaded = loadCommunity(db);
    expect(loaded.posts).toHaveLength(1);
    expect(loaded.events[0].ts).toBeNull();
    expect(loaded.members.find((member) => member.userId === 4)?.whitelisted).toBe(true);
    expect(loaded.members.find((member) => member.userId === 2)?.whitelisted).toBe(false);
  });

  it("waits 14 days and then compares posts published after the snapshot", () => {
    const posts = [
      { postId: 1, date: NOW, views: null, reach: 100 },
      { postId: 2, date: NOW + 20 * DAY_SECONDS, views: null, reach: 200 },
    ];
    const events = [
      { userId: 2, postId: 1, type: "like" as const, ts: null },
      { userId: 2, postId: 2, type: "comment" as const, ts: posts[1].date },
      { userId: 3, postId: 2, type: "repost" as const, ts: null },
    ];
    const before = observedMetrics([posts[0]], events);
    expect(before.erAll).toBeCloseTo(1 / 100);
    expect(before.erCommentsReposts).toBe(0);
    const experiment = {
      id: 1,
      createdAt: NOW,
      removedIds: [2],
      postIds: [1],
      erAll: before.erAll,
      erCommentsReposts: before.erCommentsReposts,
      avgReach: before.avgReach,
      reachSource: before.reachSource,
      nRemoved: 1,
    };
    const early = experimentReport(experiment, posts, events, NOW + 13 * DAY_SECONDS);
    expect(early.ready).toBe(false);
    if (!early.ready) expect(early.daysLeft).toBe(1);
    const ready = experimentReport(experiment, posts, events, NOW + 14 * DAY_SECONDS);
    expect(ready.ready).toBe(true);
    if (ready.ready) {
      expect(ready.postsAfter).toBe(1);
      expect(ready.after.erAll).toBeCloseTo(2 / 200);
      expect(ready.after.erCommentsReposts).toBeCloseTo(2 / 200);
      expect(ready.deltaAvgReach).toBeCloseTo(100);
    }
  });

  it("checks the mini app launch signature and community id", async () => {
    const db = openDatabase(":memory:");
    replaceCommunityData(db, community());
    const app = createApp({ db, vk: null, now: () => NOW, appSecret: "secret", groupId: 10 });
    const denied = await app.request("/overview", { headers: { "x-vk-params": "vk_user_id=1&sign=no" } });
    expect(denied.status).toBe(401);
    const params = new URLSearchParams({ vk_user_id: "1", vk_group_id: "10" });
    params.set("sign", vkLaunchSign(params, "secret"));
    const allowed = await app.request("/overview", { headers: { "x-vk-params": params.toString() } });
    expect(allowed.status).toBe(200);
    const other = new URLSearchParams({ vk_user_id: "1", vk_group_id: "99" });
    other.set("sign", vkLaunchSign(other, "secret"));
    const wrongGroup = await app.request("/overview", { headers: { "x-vk-params": other.toString() } });
    expect(wrongGroup.status).toBe(403);
  });

  it("serves POST /simulate", async () => {
    const db = openDatabase(":memory:");
    replaceCommunityData(db, community());
    const app = createApp({ db, vk: null, now: () => NOW });
    const response = await app.request("/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ n: 0 }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { all: { before: number; after: number }; selectedUserIds: number[] };
    expect(body.all.before).toBe(body.all.after);
    expect(body.selectedUserIds).toEqual([]);
    const bad = await app.request("/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ n: -1 }),
    });
    expect(bad.status).toBe(400);
  });

  it("rejects a community token for a different launched group", async () => {
    const db = openDatabase(":memory:");
    replaceCommunityData(db, community());
    const app = createApp({ db, vk: null, now: () => NOW });
    const response = await app.request("/sync", {
      method: "POST",
      headers: { "content-type": "application/json", "x-vk-params": "vk_group_id=10" },
      body: JSON.stringify({ accessToken: "token", groupId: 99 }),
    });
    expect(response.status).toBe(403);
  });

  it("does not write a snapshot when the token is missing", async () => {
    const db = openDatabase(":memory:");
    replaceCommunityData(db, community());
    const app = createApp({ db, vk: null, now: () => NOW });
    const response = await app.request("/remove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ n: 2 }),
    });
    expect(response.status).toBe(400);
    expect(latestExperiment(db)).toBeNull();
  });

  it("writes a snapshot only for users that were actually removed", async () => {
    const db = openDatabase(":memory:");
    replaceCommunityData(db, community());
    const removed: number[] = [];
    const app = createApp({
      db,
      now: () => NOW,
      vk: {
        ingest: async () => ({ ...community(), warnings: [] }),
        removeUser: async (userId) => {
          if (userId === 3) throw new Error("отказ");
          removed.push(userId);
        },
      },
    });
    const response = await app.request("/remove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ n: 1000 }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { removed: number[]; failed: Array<{ userId: number }> };
    expect(body.removed).toEqual([2, 4]);
    expect(body.failed.map((item) => item.userId)).toEqual([3]);
    expect(removed).toEqual([2, 4]);
    const snapshot = latestExperiment(db);
    expect(snapshot?.removedIds).toEqual([2, 4]);
    expect(snapshot?.nRemoved).toBe(2);
  });

  it("recomputes backtest results when the same summary shape has different data", async () => {
    const db = openDatabase(":memory:");
    const app = createApp({ db, vk: null, now: () => NOW });

    const first = {
      posts: [
        { postId: 1, date: 100, views: 10, reach: 10 },
        { postId: 2, date: 200, views: 10, reach: 10 },
        { postId: 3, date: 300, views: 10, reach: 10 },
      ],
      events: [
        { userId: 1, postId: 3, type: "comment" as const, ts: null },
        { userId: 5, postId: 2, type: "comment" as const, ts: null },
        { userId: 5, postId: 1, type: "comment" as const, ts: null },
      ],
      members: [
        person({ userId: 1, lastSeen: 100 }),
        person({ userId: 2, lastSeen: 110 }),
        person({ userId: 3, lastSeen: 120 }),
        person({ userId: 4, lastSeen: 130 }),
        person({ userId: 5, lastSeen: 140 }),
      ],
    };
    const second = {
      posts: [
        { postId: 1, date: 100, views: 10, reach: 10 },
        { postId: 2, date: 200, views: 10, reach: 10 },
        { postId: 3, date: 300, views: 10, reach: 10 },
      ],
      events: [
        { userId: 5, postId: 1, type: "comment" as const, ts: null },
        { userId: 1, postId: 1, type: "like" as const, ts: null },
        { userId: 1, postId: 3, type: "repost" as const, ts: null },
      ],
      members: [
        person({ userId: 1, lastSeen: 110, firstName: "B0" }),
        person({ userId: 2, lastSeen: 120, firstName: "B1" }),
        person({ userId: 3, lastSeen: 130, firstName: "B2" }),
        person({ userId: 4, lastSeen: 140, firstName: "B3" }),
        person({ userId: 5, lastSeen: 100, firstName: "B4" }),
      ],
    };

    replaceCommunityData(db, first);
    const firstResponse = await app.request("/overview");
    const firstBody = (await firstResponse.json()) as { backtest: { auc: number | null } };
    expect(firstBody.backtest.auc).toBeCloseTo(0.375);

    replaceCommunityData(db, second);
    const secondResponse = await app.request("/overview");
    const secondBody = (await secondResponse.json()) as { backtest: { auc: number | null } };
    expect(secondBody.backtest.auc).toBeCloseTo(1);
  });
});

describe("ingest", () => {
  it("stores likes without time, keeps comment dates, and continues when reach is unavailable", async () => {
    const calls: string[] = [];
    const call = async (method: string, params: Record<string, string | number>) => {
      calls.push(method);
      if (method === "wall.get") {
        return { count: 1, items: [{ id: 9, date: NOW, views: { count: 15 } }] };
      }
      if (method === "stats.getPostReach") throw new Error("нет прав");
      if (method === "likes.getList" && params.filter === "likes") return { count: 1, items: [5] };
      if (method === "likes.getList" && params.filter === "copies") return { count: 1, items: [6] };
      if (method === "wall.getComments") {
        return {
          count: 2,
          items: [
            { from_id: 7, date: NOW - 10 },
            { from_id: 7, date: NOW },
            { from_id: -1, date: NOW },
          ],
        };
      }
      if (method === "groups.getMembers" && params.filter == null) {
        return {
          count: 2,
          items: [
            { id: 5, first_name: "Оля", last_name: "С", last_seen: { time: NOW } },
            { id: 8, first_name: "Петя", last_name: "У", deactivated: "deleted" },
          ],
        };
      }
      if (method === "groups.getMembers" && params.filter === "managers") {
        return { count: 1, items: [{ id: 5, role: "administrator" }] };
      }
      if (method === "groups.getMembers" && params.filter === "donut") throw new Error("нет donut");
      if (method === "messages.getConversations") {
        return {
          count: 1,
          items: [
            {
              conversation: { peer: { id: 5 } },
              last_message: { out: 1, from_id: -10, date: NOW },
            },
          ],
        };
      }
      if (method === "messages.getHistory") {
        return { count: 1, items: [{ out: 0, from_id: 5, date: NOW - 5 }] };
      }
      throw new Error(`unexpected ${method}`);
    };

    const result = await ingestCommunity(call, 10);
    expect(result.warnings.some((item) => item.includes("stats.getPostReach"))).toBe(true);
    expect(result.warnings.some((item) => item.includes("donut"))).toBe(true);
    expect(result.posts[0]).toMatchObject({ postId: 9, views: 15, reach: null });
    expect(result.events).toEqual([
      { userId: 5, postId: 9, type: "like", ts: null },
      { userId: 6, postId: 9, type: "repost", ts: null },
      { userId: 7, postId: 9, type: "comment", ts: NOW },
    ]);
    const olya = result.members.find((member) => member.userId === 5);
    expect(olya?.role).toBe("admin");
    expect(olya?.lastInboundDmTs).toBe(NOW - 5);
    expect(result.members.find((member) => member.userId === 8)?.deactivated).toBe("deleted");
    expect(calls).toContain("messages.getHistory");
  });
});
