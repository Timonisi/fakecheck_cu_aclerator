import { DAY_SECONDS, scoringConfig } from "../scoring/scoring.config.ts";
import type { ScoringConfig } from "../scoring/scoring.config.ts";
import type { EventRecord, PostRecord } from "../scoring/types.ts";

export type ExperimentRow = {
  id: number;
  createdAt: number;
  removedIds: number[];
  postIds: number[];
  erAll: number | null;
  erCommentsReposts: number | null;
  avgReach: number | null;
  reachSource: string;
  nRemoved: number;
};

export type ObservedMetrics = {
  erAll: number | null;
  erCommentsReposts: number | null;
  avgReach: number | null;
  reachSource: "reach" | "views" | "mixed" | "none";
  postIds: number[];
  impressions: number;
};

export function observedMetrics(posts: PostRecord[], events: EventRecord[]): ObservedMetrics {
  const postIds = new Set(posts.map((post) => post.postId));
  let reactionsAll = 0;
  let reactionsCommentsReposts = 0;
  for (const event of events) {
    if (!postIds.has(event.postId)) continue;
    reactionsAll += 1;
    if (event.type === "comment" || event.type === "repost") reactionsCommentsReposts += 1;
  }
  let impressions = 0;
  let reachSum = 0;
  let reachCount = 0;
  let sawReach = false;
  let sawViews = false;
  for (const post of posts) {
    if (post.reach != null) sawReach = true;
    else if (post.views != null) sawViews = true;
    const impression = post.reach ?? post.views;
    if (impression == null) continue;
    impressions += impression;
    reachSum += impression;
    reachCount += 1;
  }
  const reachSource = sawReach && sawViews ? "mixed" : sawReach ? "reach" : sawViews ? "views" : "none";
  return {
    erAll: impressions > 0 ? reactionsAll / impressions : null,
    erCommentsReposts: impressions > 0 ? reactionsCommentsReposts / impressions : null,
    avgReach: reachCount > 0 ? reachSum / reachCount : null,
    reachSource,
    postIds: posts.map((post) => post.postId),
    impressions,
  };
}

export type ExperimentReport =
  | {
      ready: false;
      secondsLeft: number;
      daysLeft: number;
      experiment: ExperimentRow;
    }
  | {
      ready: true;
      experiment: ExperimentRow;
      postsAfter: number;
      before: Pick<ObservedMetrics, "erAll" | "erCommentsReposts" | "avgReach" | "reachSource">;
      after: Pick<ObservedMetrics, "erAll" | "erCommentsReposts" | "avgReach" | "reachSource">;
      deltaErAll: number | null;
      deltaErCommentsReposts: number | null;
      deltaAvgReach: number | null;
    };

function delta(after: number | null, before: number | null): number | null {
  if (after == null || before == null) return null;
  return after - before;
}

export function experimentReport(
  experiment: ExperimentRow,
  posts: PostRecord[],
  events: EventRecord[],
  now: number,
  config: ScoringConfig = scoringConfig,
): ExperimentReport {
  const readyAt = experiment.createdAt + config.experimentWaitDays * DAY_SECONDS;
  if (now < readyAt) {
    const secondsLeft = readyAt - now;
    return {
      ready: false,
      secondsLeft,
      daysLeft: Math.ceil(secondsLeft / DAY_SECONDS),
      experiment,
    };
  }
  const afterPosts = posts.filter((post) => post.date > experiment.createdAt);
  const after = observedMetrics(afterPosts, events);
  return {
    ready: true,
    experiment,
    postsAfter: afterPosts.length,
    before: {
      erAll: experiment.erAll,
      erCommentsReposts: experiment.erCommentsReposts,
      avgReach: experiment.avgReach,
      reachSource: experiment.reachSource as ObservedMetrics["reachSource"],
    },
    after: {
      erAll: after.erAll,
      erCommentsReposts: after.erCommentsReposts,
      avgReach: after.avgReach,
      reachSource: after.reachSource,
    },
    deltaErAll: delta(after.erAll, experiment.erAll),
    deltaErCommentsReposts: delta(after.erCommentsReposts, experiment.erCommentsReposts),
    deltaAvgReach: delta(after.avgReach, experiment.avgReach),
  };
}
