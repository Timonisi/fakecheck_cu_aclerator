import { DAY_SECONDS, HOUR_SECONDS } from "./scoring.config.ts";
import type { ScoringConfig } from "./scoring.config.ts";
import type { MemberRecord } from "./types.ts";

function isDeactivated(member: MemberRecord): boolean {
  return member.deactivated === "deleted" || member.deactivated === "banned";
}

function lastSeenUnknown(member: MemberRecord): boolean {
  return member.lastSeenHidden || member.lastSeen == null;
}

export function exposureForMember(member: MemberRecord, now: number, config: ScoringConfig): number {
  if (isDeactivated(member)) return config.deactivatedExposure;
  if (lastSeenUnknown(member)) return config.hiddenExposure;
  const daysAgo = Math.max(0, (now - member.lastSeen!) / DAY_SECONDS);
  for (const bucket of config.exposureByMaxDays) {
    if (daysAgo <= bucket.maxDays) return bucket.exposure;
  }
  return config.exposureBeyond;
}

export function earlyExposureForMember(
  member: MemberRecord,
  exposure: number,
  now: number,
  config: ScoringConfig,
): number {
  if (isDeactivated(member)) return config.deactivatedExposure;
  if (lastSeenUnknown(member)) return exposure;
  const hoursAgo = Math.max(0, (now - member.lastSeen!) / HOUR_SECONDS);
  if (hoursAgo <= config.earlyExposureWithinHours) {
    return exposure * config.earlyExposureMultiplier;
  }
  return exposure;
}

export function harmScore(earlyExposure: number, reaction: number, isProtected: boolean): number {
  if (isProtected) return 0;
  return earlyExposure * (1 - reaction);
}
