import type { Deactivated, MemberRecord } from "../scoring/types.ts";

export type VkUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  deactivated?: string;
  last_seen?: { time?: number };
  role?: string;
};

export type VkPost = {
  id: number;
  date: number;
  views?: { count?: number };
};

export type VkComment = {
  from_id?: number;
  date?: number;
};

export function mapRole(role: string | undefined): string | null {
  if (role === "creator" || role === "administrator" || role === "admin") return "admin";
  if (role === "editor" || role === "moderator") return role;
  return null;
}

export function mapDeactivated(value: string | undefined): Deactivated | null {
  if (value === "deleted" || value === "banned") return value;
  return null;
}

export function mapMember(user: VkUser, extras?: Partial<MemberRecord>): MemberRecord {
  const deactivated = mapDeactivated(user.deactivated);
  const lastSeen = user.last_seen?.time ?? null;
  return {
    userId: user.id,
    lastSeen,
    lastSeenHidden: deactivated == null && lastSeen == null,
    deactivated,
    role: mapRole(user.role),
    isDonut: false,
    lastInboundDmTs: null,
    whitelisted: false,
    firstName: user.first_name ?? "",
    lastName: user.last_name ?? "",
    ...extras,
  };
}

export function mapReach(row: { reach_total?: number; reach_subscribers?: number }): number | null {
  if (typeof row.reach_total === "number") return row.reach_total;
  if (typeof row.reach_subscribers === "number") return row.reach_subscribers;
  return null;
}
