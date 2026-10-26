import { describe, expect, it } from "vitest";
import { DAY_SECONDS, HOUR_SECONDS, scoringConfig } from "./scoring.config.ts";
import { exposureForMember, earlyExposureForMember, harmScore } from "./exposure.ts";
import { combineReaction, probability } from "./reaction.ts";
import { splitLists } from "./lists.ts";
import { scoreMembers } from "./score.ts";
import type { MemberRecord } from "./types.ts";

const NOW = 1_700_000_000;

function member(overrides: Partial<MemberRecord> = {}): MemberRecord {
  return {
    userId: 1,
    lastSeen: NOW,
    lastSeenHidden: false,
    deactivated: null,
    role: null,
    isDonut: false,
    lastInboundDmTs: null,
    whitelisted: false,
    firstName: "Иван",
    lastName: "Иванов",
    ...overrides,
  };
}

describe("reaction", () => {
  it("combines type probabilities as at least one reaction", () => {
    expect(combineReaction(0.5, 0.2, 0.1)).toBeCloseTo(1 - 0.5 * 0.8 * 0.9);
  });

  it("applies recency and the beta prior", () => {
    const postDate = NOW - 60 * DAY_SECONDS;
    const [score] = scoreMembers({
      now: NOW,
      posts: [{ postId: 10, date: postDate, views: 10, reach: 10 }],
      events: [{ userId: 1, postId: 10, type: "like", ts: null }],
      members: [member()],
    });
    expect(score.p.like).toBeCloseTo((0.5 + 1) / (1 + 1 + 30));
  });

  it("uses the post date for likes and reposts and the comment date for comments", () => {
    const postDate = NOW - 60 * DAY_SECONDS;
    const [score] = scoreMembers({
      now: NOW,
      posts: [{ postId: 10, date: postDate, views: null, reach: null }],
      events: [
        { userId: 1, postId: 10, type: "like", ts: null },
        { userId: 1, postId: 10, type: "repost", ts: NOW },
        { userId: 1, postId: 10, type: "comment", ts: NOW },
        { userId: 1, postId: 10, type: "comment", ts: postDate },
      ],
      members: [member()],
    });
    expect(score.p.like).toBeCloseTo((0.5 + 1) / (1 + 1 + 30));
    expect(score.p.repost).toBeCloseTo((0.5 + scoringConfig.priors.repost.alpha) / (1 + 0.2 + 50));
    expect(score.p.comment).toBeCloseTo((1 + 0.4) / (1 + 0.4 + 40));
  });

  it("falls back to the prior when the window has no posts", () => {
    const [score] = scoreMembers({
      now: NOW,
      posts: [],
      events: [{ userId: 1, postId: 10, type: "like", ts: NOW }],
      members: [member()],
    });
    expect(score.p.like).toBeCloseTo(1 / 31);
    expect(score.p.comment).toBeCloseTo(0.4 / 40.4);
    expect(score.p.repost).toBeCloseTo(0.2 / 50.2);
    expect(score.hasEvents).toBe(false);
    expect(score.reaction).toBeCloseTo(combineReaction(score.p.like, score.p.comment, score.p.repost));
  });

  it("clamps a probability at 1", () => {
    expect(probability(100, 1, { alpha: 1, beta: 30 })).toBe(1);
  });

  it("keeps value on the weights and out of harm", () => {
    const [silent, liker] = scoreMembers({
      now: NOW,
      posts: [{ postId: 1, date: NOW, views: null, reach: null }],
      events: [{ userId: 2, postId: 1, type: "like", ts: null }],
      members: [member({ userId: 1 }), member({ userId: 2 })],
    });
    expect(silent.value).toBeCloseTo(1 * silent.p.like + 3 * silent.p.comment + 5 * silent.p.repost);
    expect(liker.value).toBeGreaterThan(silent.value);
    expect(liker.harm).toBeCloseTo(liker.earlyExposure * (1 - liker.reaction));
  });
});

describe("exposure", () => {
  const boundaries = [3, 7, 30, 90, 180];

  it.each(boundaries)("keeps the bucket on day %s and steps down one second later", (days) => {
    const onBoundary = member({ lastSeen: NOW - days * DAY_SECONDS });
    const justOver = member({ lastSeen: NOW - days * DAY_SECONDS - 1 });
    const expected = scoringConfig.exposureByMaxDays.find((bucket) => bucket.maxDays === days)!.exposure;
    const next =
      scoringConfig.exposureByMaxDays.find((bucket) => bucket.maxDays > days)?.exposure ??
      scoringConfig.exposureBeyond;
    expect(exposureForMember(onBoundary, NOW, scoringConfig)).toBe(expected);
    expect(exposureForMember(justOver, NOW, scoringConfig)).toBe(next);
  });

  it("uses 0.01 after 180 days", () => {
    const aged = member({ lastSeen: NOW - 180 * DAY_SECONDS - 1 });
    expect(exposureForMember(aged, NOW, scoringConfig)).toBe(0.01);
  });

  it("treats a hidden or missing last_seen as 0.3 without the early boost", () => {
    const hidden = member({ lastSeen: NOW, lastSeenHidden: true });
    const missing = member({ lastSeen: null, lastSeenHidden: false });
    expect(exposureForMember(hidden, NOW, scoringConfig)).toBe(0.3);
    expect(earlyExposureForMember(hidden, 0.3, NOW, scoringConfig)).toBe(0.3);
    expect(exposureForMember(missing, NOW, scoringConfig)).toBe(0.3);
    expect(earlyExposureForMember(missing, 0.3, NOW, scoringConfig)).toBe(0.3);
  });

  it("zeroes exposure for deleted and banned profiles", () => {
    for (const deactivated of ["deleted", "banned"] as const) {
      const person = member({ deactivated, lastSeen: NOW });
      expect(exposureForMember(person, NOW, scoringConfig)).toBe(0);
      expect(earlyExposureForMember(person, 0, NOW, scoringConfig)).toBe(0);
    }
  });

  it("boosts the first impression batch inside 24 hours and not on the 25th hour", () => {
    const online = member({ lastSeen: NOW - 24 * HOUR_SECONDS });
    const dayOld = member({ lastSeen: NOW - 24 * HOUR_SECONDS - 1 });
    expect(earlyExposureForMember(online, 1, NOW, scoringConfig)).toBeCloseTo(1.3);
    expect(earlyExposureForMember(dayOld, 1, NOW, scoringConfig)).toBe(1);
  });
});

describe("harm and lists", () => {
  it("ranks an active silent member above a liker and a hidden profile", () => {
    const scores = scoreMembers({
      now: NOW,
      posts: [{ postId: 1, date: NOW, views: 100, reach: 80 }],
      events: [{ userId: 2, postId: 1, type: "like", ts: null }],
      members: [
        member({ userId: 1, firstName: "Молчун" }),
        member({ userId: 2, firstName: "Лайк" }),
        member({ userId: 3, firstName: "Скрыт", lastSeenHidden: true }),
      ],
    });
    const byId = new Map(scores.map((score) => [score.userId, score]));
    const silent = byId.get(1)!;
    const liker = byId.get(2)!;
    const hidden = byId.get(3)!;
    expect(silent.exposure).toBe(1);
    expect(silent.earlyExposure).toBeCloseTo(1.3);
    expect(silent.harm).toBeGreaterThan(liker.harm);
    expect(silent.harm).toBeGreaterThan(hidden.harm);
    expect(silent.harm).toBeCloseTo(harmScore(silent.earlyExposure, silent.reaction, false));
  });

  it("zeroes harm for managers, donut, the whitelist, and a recent direct message", () => {
    const cases: Array<Partial<MemberRecord>> = [
      { role: "admin" },
      { role: "editor" },
      { role: "moderator" },
      { isDonut: true },
      { whitelisted: true },
      { lastInboundDmTs: NOW - 30 * DAY_SECONDS },
    ];
    for (const [index, overrides] of cases.entries()) {
      const [score] = scoreMembers({
        now: NOW,
        posts: [{ postId: 1, date: NOW, views: null, reach: null }],
        events: [],
        members: [member({ userId: index + 1, ...overrides })],
      });
      expect(score.protected).toBe(true);
      expect(score.harm).toBe(0);
      expect(score.protectionReasons.length).toBeGreaterThan(0);
    }
  });

  it("drops direct-message protection one second after the window", () => {
    const [score] = scoreMembers({
      now: NOW,
      posts: [{ postId: 1, date: NOW, views: null, reach: null }],
      events: [],
      members: [member({ lastInboundDmTs: NOW - 30 * DAY_SECONDS - 1 })],
    });
    expect(score.protected).toBe(false);
    expect(score.harm).toBeGreaterThan(0);
  });

  it("puts deleted and banned accounts only on the dead-account list", () => {
    const scores = scoreMembers({
      now: NOW,
      posts: [],
      events: [],
      members: [
        member({ userId: 1, deactivated: "deleted", lastSeen: null }),
        member({ userId: 2, deactivated: "banned", lastSeen: NOW }),
      ],
    });
    const lists = splitLists(scores);
    expect(lists.deadAccounts.map((score) => score.userId)).toEqual([1, 2]);
    expect(lists.harmReach).toHaveLength(0);
    expect(lists.deadWeight).toHaveLength(0);
    expect(scores.every((score) => score.harm === 0)).toBe(true);
  });

  it("keeps someone who reacted out of dead weight", () => {
    const scores = scoreMembers({
      now: NOW,
      posts: [{ postId: 1, date: NOW - 200 * DAY_SECONDS, views: null, reach: null }],
      events: [{ userId: 2, postId: 1, type: "like", ts: null }],
      members: [
        member({ userId: 1, lastSeen: NOW - 200 * DAY_SECONDS }),
        member({ userId: 2, lastSeen: NOW - 200 * DAY_SECONDS }),
        member({ userId: 3, lastSeenHidden: true }),
      ],
    });
    const lists = splitLists(scores);
    expect(lists.deadWeight.map((score) => score.userId)).toEqual([1]);
    expect(lists.harmReach).toHaveLength(0);
    expect(lists.deadAccounts).toHaveLength(0);
    expect(lists.harmReach.some((score) => score.userId === 3)).toBe(false);
    expect(lists.deadWeight.some((score) => score.userId === 3)).toBe(false);
  });

  it("orders the harm list by harm and leaves protected members out", () => {
    const scores = scoreMembers({
      now: NOW,
      posts: [{ postId: 1, date: NOW, views: null, reach: null }],
      events: [{ userId: 2, postId: 1, type: "like", ts: null }],
      members: [
        member({ userId: 2 }),
        member({ userId: 1 }),
        member({ userId: 3, role: "admin" }),
      ],
    });
    const lists = splitLists(scores);
    expect(lists.harmReach.map((score) => score.userId)).toEqual([1, 2]);
    expect(lists.harmReach[0].harm).toBeGreaterThan(lists.harmReach[1].harm);
  });
});
