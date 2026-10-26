import { scoringConfig } from "./scoring.config.ts";
import type { ScoringConfig } from "./scoring.config.ts";
import type { MemberLists, MemberScore } from "./types.ts";

function isDeactivated(score: MemberScore): boolean {
  return score.deactivated === "deleted" || score.deactivated === "banned";
}

export function splitLists(scores: MemberScore[], config: ScoringConfig = scoringConfig): MemberLists {
  const harmReach: MemberScore[] = [];
  const deadWeight: MemberScore[] = [];
  const deadAccounts: MemberScore[] = [];

  for (const score of scores) {
    if (isDeactivated(score)) {
      deadAccounts.push(score);
      continue;
    }
    if (!score.protected && score.exposure >= config.harmListMinExposure) {
      harmReach.push(score);
      continue;
    }
    if (!score.protected && score.exposure < config.deadWeightMaxExposure && !score.hasEvents) {
      deadWeight.push(score);
    }
  }

  harmReach.sort((a, b) => b.harm - a.harm || a.userId - b.userId);
  deadWeight.sort((a, b) => a.userId - b.userId);
  deadAccounts.sort((a, b) => a.userId - b.userId);
  return { harmReach, deadWeight, deadAccounts };
}
