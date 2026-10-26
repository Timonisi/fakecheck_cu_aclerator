import { DAY_SECONDS } from "./scoring.config.ts";
import type { Prior } from "./scoring.config.ts";
import type { ReactionType, TypeProbabilities } from "./types.ts";

export function recencyWeight(eventTs: number, now: number, halfLifeDays: number): number {
  const daysAgo = Math.max(0, (now - eventTs) / DAY_SECONDS);
  return 0.5 ** (daysAgo / halfLifeDays);
}

export function probability(sumWeights: number, postsInWindow: number, prior: Prior): number {
  const denominator = postsInWindow + prior.alpha + prior.beta;
  if (denominator <= 0) return 0;
  const value = (sumWeights + prior.alpha) / denominator;
  return Math.min(1, Math.max(0, value));
}

export function combineReaction(pLike: number, pComment: number, pRepost: number): number {
  return 1 - (1 - pLike) * (1 - pComment) * (1 - pRepost);
}

export function combineCommentsReposts(pComment: number, pRepost: number): number {
  return 1 - (1 - pComment) * (1 - pRepost);
}

export function contributionValue(
  p: TypeProbabilities,
  weights: Record<ReactionType, number>,
): number {
  return weights.like * p.like + weights.comment * p.comment + weights.repost * p.repost;
}
