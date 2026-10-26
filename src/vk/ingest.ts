import type { EventRecord, MemberRecord, PostRecord } from "../scoring/types.ts";
import { mapMember, mapReach, mapRole } from "./map.ts";
import type { VkComment, VkPost, VkUser } from "./map.ts";

export type VkCaller = (method: string, params: Record<string, string | number>) => Promise<unknown>;

export type IngestedCommunity = {
  posts: PostRecord[];
  events: EventRecord[];
  members: MemberRecord[];
  warnings: string[];
};

export type IngestProgress = {
  stage: "wall" | "reactions" | "members" | "protection" | "messages";
  current: number;
  total: number;
};

type Counted<T> = { count?: number; items?: T[] };

export class VkApiError extends Error {
  constructor(
    readonly method: string,
    message: string,
    readonly code: number,
  ) {
    super(`VK API error ${code} in ${method}: ${message}`);
    this.name = "VkApiError";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class VkApi {
  private lastCall = 0;

  constructor(
    private readonly token: string,
    private readonly minIntervalMs = 340,
  ) {}

  async call(method: string, params: Record<string, string | number>): Promise<unknown> {
    let attempt = 0;
    while (true) {
      const wait = this.minIntervalMs - (Date.now() - this.lastCall);
      if (wait > 0) await sleep(wait);
      this.lastCall = Date.now();
      const body = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) body.set(key, String(value));
      body.set("access_token", this.token);
      body.set("v", "5.199");
      const response = await fetch(`https://api.vk.com/method/${method}`, { method: "POST", body });
      const json = (await response.json()) as {
        response?: unknown;
        error?: { error_code: number; error_msg: string };
      };
      if (json.error?.error_code === 6 && attempt < 3) {
        attempt += 1;
        await sleep(1000);
        continue;
      }
      if (json.error) throw new VkApiError(method, json.error.error_msg, json.error.error_code);
      return json.response;
    }
  }
}

async function pages<T>(
  call: VkCaller,
  method: string,
  params: Record<string, string | number>,
  pageSize: number,
): Promise<T[]> {
  const items: T[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (offset < total) {
    const response = (await call(method, { ...params, count: pageSize, offset })) as Counted<T>;
    const page = response.items ?? [];
    total = response.count ?? offset + page.length;
    items.push(...page);
    if (page.length === 0) break;
    offset += page.length;
  }
  return items;
}

function warningMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function ingestCommunity(
  call: VkCaller,
  groupId: number,
  communityCall: VkCaller = call,
  onProgress?: (progress: IngestProgress) => void,
): Promise<IngestedCommunity> {
  const warnings: string[] = [];
  const ownerId = -Math.abs(groupId);
  onProgress?.({ stage: "wall", current: 0, total: 1 });
  const wall = (await call("wall.get", { owner_id: ownerId, count: 40, filter: "owner" })) as Counted<VkPost>;
  const posts: PostRecord[] = (wall.items ?? []).slice(0, 40).map((post) => ({
    postId: post.id,
    date: post.date,
    views: post.views?.count ?? null,
    reach: null,
  }));

  try {
    const reach = await call("stats.getPostReach", {
      owner_id: ownerId,
      post_ids: posts.map((post) => post.postId).join(","),
    });
    const rows = Array.isArray(reach) ? reach : [];
    for (const row of rows as Array<{ post_id?: number; reach_total?: number; reach_subscribers?: number }>) {
      const post = posts.find((item) => item.postId === row.post_id);
      if (post) post.reach = mapReach(row);
    }
  } catch (error) {
    warnings.push(`stats.getPostReach: ${warningMessage(error)}`);
  }

  const events: EventRecord[] = [];
  for (const [index, post] of posts.entries()) {
    onProgress?.({ stage: "reactions", current: index + 1, total: posts.length });
    try {
      const likes = await pages<number>(
        call,
        "likes.getList",
        { type: "post", owner_id: ownerId, item_id: post.postId, filter: "likes" },
        1000,
      );
      for (const userId of likes) {
        if (userId > 0) events.push({ userId, postId: post.postId, type: "like", ts: null });
      }
    } catch (error) {
      warnings.push(`likes ${post.postId}: ${warningMessage(error)}`);
    }
    try {
      const copies = await pages<number>(
        call,
        "likes.getList",
        { type: "post", owner_id: ownerId, item_id: post.postId, filter: "copies" },
        1000,
      );
      for (const userId of copies) {
        if (userId > 0) events.push({ userId, postId: post.postId, type: "repost", ts: null });
      }
    } catch (error) {
      warnings.push(`reposts ${post.postId}: ${warningMessage(error)}`);
    }
    try {
      const comments = await pages<VkComment>(
        call,
        "wall.getComments",
        { owner_id: ownerId, post_id: post.postId, need_likes: 0, preview_length: 0 },
        100,
      );
      const latest = new Map<number, number>();
      for (const comment of comments) {
        if (comment.from_id == null || comment.from_id <= 0 || comment.date == null) continue;
        const prev = latest.get(comment.from_id);
        if (prev == null || comment.date > prev) latest.set(comment.from_id, comment.date);
      }
      for (const [userId, ts] of latest) {
        events.push({ userId, postId: post.postId, type: "comment", ts });
      }
    } catch (error) {
      warnings.push(`comments ${post.postId}: ${warningMessage(error)}`);
    }
  }

  onProgress?.({ stage: "members", current: 0, total: 1 });
  const rawMembers = await pages<VkUser>(
    call,
    "groups.getMembers",
    { group_id: groupId, fields: "last_seen,first_name,last_name" },
    1000,
  );
  const members = new Map<number, MemberRecord>();
  for (const user of rawMembers) members.set(user.id, mapMember(user));

  onProgress?.({ stage: "protection", current: 0, total: 1 });
  try {
    const managers = await pages<VkUser>(call, "groups.getMembers", { group_id: groupId, filter: "managers" }, 1000);
    for (const manager of managers) {
      const role = mapRole(manager.role);
      const existing = members.get(manager.id);
      if (existing) existing.role = role;
      else members.set(manager.id, mapMember(manager, { role }));
    }
  } catch (error) {
    warnings.push(`managers: ${warningMessage(error)}`);
  }

  onProgress?.({ stage: "messages", current: 0, total: 1 });
  try {
    const donut = await pages<VkUser>(
      communityCall,
      "groups.getMembers",
      { group_id: groupId, filter: "donut" },
      1000,
    );
    for (const user of donut) {
      const existing = members.get(user.id);
      if (existing) existing.isDonut = true;
      else members.set(user.id, mapMember(user, { isDonut: true }));
    }
  } catch (error) {
    warnings.push(`donut: ${warningMessage(error)}`);
  }

  try {
    await collectInboundMessages(communityCall, groupId, members, warnings);
  } catch (error) {
    warnings.push(`messages: ${warningMessage(error)}`);
  }

  return { posts, events, members: [...members.values()], warnings };
}

async function collectInboundMessages(
  call: VkCaller,
  groupId: number,
  members: Map<number, MemberRecord>,
  warnings: string[],
): Promise<void> {
  const conversations = await pages<{
    conversation?: { peer?: { id?: number } };
    last_message?: { date?: number; from_id?: number; out?: number };
  }>(call, "messages.getConversations", { group_id: groupId }, 200);

  let historyLookups = 0;
  for (const item of conversations) {
    const peerId = item.conversation?.peer?.id;
    if (peerId == null || peerId <= 0) continue;
    const last = item.last_message;
    let inbound = last && last.out === 0 && (last.from_id ?? 0) > 0 ? (last.date ?? null) : null;
    if (inbound == null && historyLookups < 100) {
      historyLookups += 1;
      try {
        const history = (await call("messages.getHistory", {
          group_id: groupId,
          peer_id: peerId,
          count: 50,
        })) as Counted<{ date?: number; out?: number; from_id?: number }>;
        for (const message of history.items ?? []) {
          if (message.out === 0 && (message.from_id ?? 0) > 0 && message.date != null) {
            inbound = inbound == null ? message.date : Math.max(inbound, message.date);
          }
        }
      } catch (error) {
        warnings.push(`messages ${peerId}: ${warningMessage(error)}`);
      }
    }
    if (inbound == null) continue;
    const member = members.get(peerId);
    if (member) member.lastInboundDmTs = inbound;
  }
}

export async function removeMember(call: VkCaller, groupId: number, userId: number): Promise<void> {
  await call("groups.removeUser", { group_id: groupId, user_id: userId });
}
