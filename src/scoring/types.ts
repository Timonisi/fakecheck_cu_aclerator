export const reactionTypes = ["like", "comment", "repost"] as const;

export type ReactionType = (typeof reactionTypes)[number];

export type Deactivated = "deleted" | "banned";

export type ProtectionReason = "manager" | "donut" | "whitelist" | "recent_dm";

export type PostRecord = {
  postId: number;
  date: number;
  views: number | null;
  reach: number | null;
};

export type EventRecord = {
  userId: number;
  postId: number;
  type: ReactionType;
  ts: number | null;
};

export type MemberRecord = {
  userId: number;
  lastSeen: number | null;
  lastSeenHidden: boolean;
  deactivated: Deactivated | null;
  role: string | null;
  isDonut: boolean;
  lastInboundDmTs: number | null;
  whitelisted: boolean;
  firstName: string;
  lastName: string;
};

export type TypeProbabilities = Record<ReactionType, number>;

export type MemberScore = {
  userId: number;
  firstName: string;
  lastName: string;
  p: TypeProbabilities;
  reaction: number;
  reactionCommentsReposts: number;
  value: number;
  exposure: number;
  earlyExposure: number;
  harm: number;
  protected: boolean;
  protectionReasons: ProtectionReason[];
  hasEvents: boolean;
  deactivated: Deactivated | null;
  lastSeenHidden: boolean;
};

export type MemberLists = {
  harmReach: MemberScore[];
  deadWeight: MemberScore[];
  deadAccounts: MemberScore[];
};
