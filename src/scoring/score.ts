import { DAY_SECONDS, scoringConfig } from "./scoring.config.ts";
import type { ScoringConfig } from "./scoring.config.ts";
import { earlyExposureForMember, exposureForMember, harmScore } from "./exposure.ts";
import {
  combineCommentsReposts,
  combineReaction,
  contributionValue,
  probability,
  recencyWeight,
} from "./reaction.ts";
import type {
  EventRecord,
  MemberRecord,
  MemberScore,
  PostRecord,
  ProtectionReason,
  ReactionType,
  TypeProbabilities,
} from "./types.ts";

export function selectWindow(posts: PostRecord[], limit: number): PostRecord[] {
  return [...posts].sort((a, b) => b.date - a.date || b.postId - a.postId).slice(0, limit);
}

export function protectionReasons(
  member: MemberRecord,
  now: number,
  config: ScoringConfig,
): ProtectionReason[] {
  const reasons: ProtectionReason[] = [];
  if (member.role != null && config.managerRoles.includes(member.role)) reasons.push("manager");
  if (member.isDonut) reasons.push("donut");
  if (member.whitelisted) reasons.push("whitelist");
  if (
    member.lastInboundDmTs != null &&
    member.lastInboundDmTs >= now - config.dmRecentDays * DAY_SECONDS
  ) {
    reasons.push("recent_dm");
  }
  return reasons;
}

function emptySums(): TypeProbabilities {
  return { like: 0, comment: 0, repost: 0 };
}

function stampForEvent(event: EventRecord, postDate: number): number {
  if (event.type === "comment" && event.ts != null) return event.ts;
  return postDate;
}

export function scoreMembers(args: {
  posts: PostRecord[];
  events: EventRecord[];
  members: MemberRecord[];
  now: number;
  exposureNow?: number;
  config?: ScoringConfig;
}): MemberScore[] {
  const config = args.config ?? scoringConfig;
  const window = selectWindow(args.posts, config.postWindow);
  const dateById = new Map(window.map((post) => [post.postId, post.date]));
  const best = new Map<number, Map<number, TypeProbabilities>>();
  const usersWithEvents = new Set<number>();

  for (const event of args.events) {
    const postDate = dateById.get(event.postId);
    if (postDate == null) continue;
    let byPost = best.get(event.userId);
    if (!byPost) {
      byPost = new Map();
      best.set(event.userId, byPost);
    }
    let sums = byPost.get(event.postId);
    if (!sums) {
      sums = emptySums();
      byPost.set(event.postId, sums);
    }
    const weight = recencyWeight(stampForEvent(event, postDate), args.now, config.recencyHalfLifeDays);
    const type = event.type;
    if (weight > sums[type]) sums[type] = weight;
    usersWithEvents.add(event.userId);
  }

  const summed = new Map<number, TypeProbabilities>();
  for (const [userId, byPost] of best) {
    const total = emptySums();
    for (const weights of byPost.values()) {
      total.like += weights.like;
      total.comment += weights.comment;
      total.repost += weights.repost;
    }
    summed.set(userId, total);
  }

  const exposureNow = args.exposureNow ?? args.now;
  return args.members.map((member) => {
    const weights = summed.get(member.userId) ?? emptySums();
    const postsInWindow = window.length;
    const p: TypeProbabilities = {
      like: probability(weights.like, postsInWindow, config.priors.like),
      comment: probability(weights.comment, postsInWindow, config.priors.comment),
      repost: probability(weights.repost, postsInWindow, config.priors.repost),
    };
    const reaction = combineReaction(p.like, p.comment, p.repost);
    const reasons = protectionReasons(member, exposureNow, config);
    const isProtected = reasons.length > 0;
    const exposure = exposureForMember(member, exposureNow, config);
    const earlyExposure = earlyExposureForMember(member, exposure, exposureNow, config);
    return {
      userId: member.userId,
      firstName: member.firstName,
      lastName: member.lastName,
      p,
      reaction,
      reactionCommentsReposts: combineCommentsReposts(p.comment, p.repost),
      value: contributionValue(p, config.valueWeights),
      exposure,
      earlyExposure,
      harm: harmScore(earlyExposure, reaction, isProtected),
      protected: isProtected,
      protectionReasons: reasons,
      hasEvents: usersWithEvents.has(member.userId),
      deactivated: member.deactivated,
      lastSeenHidden: member.lastSeenHidden || member.lastSeen == null,
    };
  });
}

export function reactionTypeOf(value: string): ReactionType | null {
  if (value === "like" || value === "comment" || value === "repost") return value;
  return null;
}
