import type { ReactionType } from "./types.ts";

export type Prior = {
  alpha: number;
  beta: number;
};

export type ScoringConfig = {
  recencyHalfLifeDays: number;
  valueWeights: Record<ReactionType, number>;
  earlyExposureMultiplier: number;
  earlyExposureWithinHours: number;
  exposureByMaxDays: ReadonlyArray<{ maxDays: number; exposure: number }>;
  exposureBeyond: number;
  hiddenExposure: number;
  deactivatedExposure: number;
  harmListMinExposure: number;
  deadWeightMaxExposure: number;
  dmRecentDays: number;
  removeBatchSize: number;
  experimentWaitDays: number;
  aucUnreliableBelow: number;
  backtestTrainFraction: number;
  postWindow: number;
  priors: Record<ReactionType, Prior>;
  managerRoles: readonly string[];
};

export const DAY_SECONDS = 86_400;
export const HOUR_SECONDS = 3_600;

export const scoringConfig: ScoringConfig = {
  recencyHalfLifeDays: 60,
  valueWeights: { like: 1, comment: 3, repost: 5 },
  earlyExposureMultiplier: 1.3,
  earlyExposureWithinHours: 24,
  exposureByMaxDays: [
    { maxDays: 3, exposure: 1 },
    { maxDays: 7, exposure: 0.85 },
    { maxDays: 30, exposure: 0.5 },
    { maxDays: 90, exposure: 0.2 },
    { maxDays: 180, exposure: 0.05 },
  ],
  exposureBeyond: 0.01,
  hiddenExposure: 0.3,
  deactivatedExposure: 0,
  harmListMinExposure: 0.5,
  deadWeightMaxExposure: 0.2,
  dmRecentDays: 30,
  removeBatchSize: 200,
  experimentWaitDays: 14,
  aucUnreliableBelow: 0.6,
  backtestTrainFraction: 0.7,
  postWindow: 40,
  priors: {
    like: { alpha: 1, beta: 30 },
    comment: { alpha: 0.4, beta: 40 },
    repost: { alpha: 0.2, beta: 50 },
  },
  managerRoles: ["admin", "editor", "moderator"],
};
