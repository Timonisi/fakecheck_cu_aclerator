import type { MemberScore } from "../scoring/types.ts";

export type ErSide = {
  before: number | null;
  after: number | null;
  delta: number | null;
};

export type Simulation = {
  n: number;
  requested: number;
  selectedUserIds: number[];
  all: ErSide;
  commentsReposts: ErSide;
  harmPoolSize: number;
};

function rate(scores: MemberScore[], removed: Set<number>, pick: (score: MemberScore) => number): number | null {
  let reactions = 0;
  let impressions = 0;
  for (const score of scores) {
    if (removed.has(score.userId)) continue;
    reactions += score.earlyExposure * pick(score);
    impressions += score.earlyExposure;
  }
  if (impressions <= 0) return null;
  return reactions / impressions;
}

function side(before: number | null, after: number | null): ErSide {
  return {
    before,
    after,
    delta: before == null || after == null ? null : after - before,
  };
}

export function removalBatch(harmPool: MemberScore[], requested: number, batchSize: number): MemberScore[] {
  const count = Math.min(Math.floor(requested), batchSize, harmPool.length);
  if (count <= 0) return [];
  return harmPool.slice(0, count);
}

export function simulateRemoval(scores: MemberScore[], harmPool: MemberScore[], requested: number): Simulation {
  const selected = harmPool.slice(0, Math.max(0, Math.floor(requested)));
  const removed = new Set(selected.map((score) => score.userId));
  return {
    n: selected.length,
    requested: Math.max(0, Math.floor(requested)),
    selectedUserIds: selected.map((score) => score.userId),
    all: side(
      rate(scores, new Set(), (score) => score.reaction),
      rate(scores, removed, (score) => score.reaction),
    ),
    commentsReposts: side(
      rate(scores, new Set(), (score) => score.reactionCommentsReposts),
      rate(scores, removed, (score) => score.reactionCommentsReposts),
    ),
    harmPoolSize: harmPool.length,
  };
}
