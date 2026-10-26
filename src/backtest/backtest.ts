import { scoringConfig } from "../scoring/scoring.config.ts";
import type { ScoringConfig } from "../scoring/scoring.config.ts";
import { scoreMembers } from "../scoring/score.ts";
import type { EventRecord, MemberRecord, MemberScore, PostRecord } from "../scoring/types.ts";
import { auc, calibrationByDecile, precisionAtK } from "./metrics.ts";
import type { CalibrationBin, PrecisionAtK } from "./metrics.ts";

export type BacktestStatus = "ok" | "insufficient_posts" | "single_class" | "no_members";

export type BacktestResult = {
  status: BacktestStatus;
  trainPosts: number;
  testPosts: number;
  splitAt: number | null;
  auc: number | null;
  aucUnreliable: boolean;
  precisionAtK: PrecisionAtK[];
  silentBaseRate: number | null;
  calibration: CalibrationBin[];
  note: string;
};

const NOTE =
  "Exposure в бэктесте считается по текущему last_seen: исторической посещаемости нет. Реакции обучающего окна взвешены на момент границы 70/30. Удалённые и заблокированные аккаунты в метрики не входят.";

export function splitPosts(
  posts: PostRecord[],
  trainFraction: number,
): { train: PostRecord[]; test: PostRecord[] } | null {
  const sorted = [...posts].sort((a, b) => a.date - b.date || a.postId - b.postId);
  if (sorted.length < 2) return null;
  const trainCount = Math.min(sorted.length - 1, Math.max(1, Math.floor(sorted.length * trainFraction)));
  return { train: sorted.slice(0, trainCount), test: sorted.slice(trainCount) };
}

export function scoreTrainWindow(args: {
  posts: PostRecord[];
  events: EventRecord[];
  members: MemberRecord[];
  exposureNow: number;
  config?: ScoringConfig;
}):
  | {
      scores: MemberScore[];
      train: PostRecord[];
      test: PostRecord[];
      splitAt: number;
    }
  | { error: "insufficient_posts" } {
  const config = args.config ?? scoringConfig;
  const split = splitPosts(args.posts, config.backtestTrainFraction);
  if (!split) return { error: "insufficient_posts" };
  const splitAt = split.test[0].date;
  const scores = scoreMembers({
    posts: split.train,
    events: args.events,
    members: args.members,
    now: splitAt,
    exposureNow: args.exposureNow,
    config,
  });
  return { scores, train: split.train, test: split.test, splitAt };
}

function actualRates(
  members: MemberRecord[],
  testPosts: PostRecord[],
  events: EventRecord[],
): Map<number, number> {
  const testIds = new Set(testPosts.map((post) => post.postId));
  const reactedPosts = new Map<number, Set<number>>();
  for (const event of events) {
    if (!testIds.has(event.postId)) continue;
    let posts = reactedPosts.get(event.userId);
    if (!posts) {
      posts = new Set();
      reactedPosts.set(event.userId, posts);
    }
    posts.add(event.postId);
  }
  const rates = new Map<number, number>();
  const total = testPosts.length;
  for (const member of members) {
    const count = reactedPosts.get(member.userId)?.size ?? 0;
    rates.set(member.userId, total === 0 ? 0 : count / total);
  }
  return rates;
}

export function runBacktest(args: {
  posts: PostRecord[];
  events: EventRecord[];
  members: MemberRecord[];
  exposureNow: number;
  config?: ScoringConfig;
}): BacktestResult {
  const config = args.config ?? scoringConfig;
  const emptyPrecision = [100, 500].map((k) => precisionAtK([], k));
  const trained = scoreTrainWindow(args);
  if ("error" in trained) {
    return {
      status: "insufficient_posts",
      trainPosts: 0,
      testPosts: 0,
      splitAt: null,
      auc: null,
      aucUnreliable: false,
      precisionAtK: emptyPrecision,
      silentBaseRate: null,
      calibration: [],
      note: NOTE,
    };
  }

  const evaluatedMembers = args.members.filter((member) => member.deactivated == null);
  const scoreById = new Map(trained.scores.map((score) => [score.userId, score]));
  const rates = actualRates(evaluatedMembers, trained.test, args.events);
  const rows = evaluatedMembers
    .map((member) => {
      const score = scoreById.get(member.userId);
      const actual = rates.get(member.userId) ?? 0;
      return {
        userId: member.userId,
        harm: score?.harm ?? 0,
        predicted: score?.reaction ?? 0,
        actual,
        silent: actual === 0,
      };
    })
    .sort((a, b) => b.harm - a.harm || a.userId - b.userId);

  if (rows.length === 0) {
    return {
      status: "no_members",
      trainPosts: trained.train.length,
      testPosts: trained.test.length,
      splitAt: trained.splitAt,
      auc: null,
      aucUnreliable: false,
      precisionAtK: emptyPrecision,
      silentBaseRate: null,
      calibration: [],
      note: NOTE,
    };
  }

  const silentCount = rows.filter((row) => row.silent).length;
  const aucValue = auc(rows.map((row) => ({ score: row.harm, positive: row.silent })));
  const status: BacktestStatus = aucValue == null ? "single_class" : "ok";
  return {
    status,
    trainPosts: trained.train.length,
    testPosts: trained.test.length,
    splitAt: trained.splitAt,
    auc: aucValue,
    aucUnreliable: aucValue != null && aucValue < config.aucUnreliableBelow,
    precisionAtK: [100, 500].map((k) => precisionAtK(rows.map((row) => row.silent), k)),
    silentBaseRate: silentCount / rows.length,
    calibration: calibrationByDecile(rows.map((row) => ({ predicted: row.predicted, actual: row.actual }))),
    note: NOTE,
  };
}
