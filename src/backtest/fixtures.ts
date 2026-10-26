import { DAY_SECONDS } from "../scoring/scoring.config.ts";
import type { EventRecord, MemberRecord, PostRecord } from "../scoring/types.ts";

const BASE = 1_700_000_000;

export function separatedCommunity(options?: { silent?: number; reactors?: number }): {
  posts: PostRecord[];
  events: EventRecord[];
  members: MemberRecord[];
  exposureNow: number;
} {
  const silent = options?.silent ?? 100;
  const reactors = options?.reactors ?? 10;
  const posts: PostRecord[] = Array.from({ length: 10 }, (_, index) => ({
    postId: index + 1,
    date: BASE + index * DAY_SECONDS,
    views: 1000,
    reach: 800,
  }));
  const exposureNow = posts[posts.length - 1].date + DAY_SECONDS;
  const members: MemberRecord[] = [];
  const events: EventRecord[] = [];
  for (let index = 0; index < silent; index += 1) {
    members.push(person(index + 1, exposureNow));
  }
  for (let index = 0; index < reactors; index += 1) {
    const userId = silent + index + 1;
    members.push(person(userId, exposureNow));
    for (const post of posts) {
      events.push({ userId, postId: post.postId, type: "like", ts: null });
    }
  }
  return { posts, events, members, exposureNow };
}

export function tiedCommunity(): {
  posts: PostRecord[];
  events: EventRecord[];
  members: MemberRecord[];
  exposureNow: number;
} {
  const posts: PostRecord[] = Array.from({ length: 10 }, (_, index) => ({
    postId: index + 1,
    date: BASE + index * DAY_SECONDS,
    views: 100,
    reach: 80,
  }));
  const exposureNow = posts[posts.length - 1].date + DAY_SECONDS;
  const members = Array.from({ length: 20 }, (_, index) => person(index + 1, exposureNow));
  const events: EventRecord[] = [];
  for (let userId = 1; userId <= 10; userId += 1) {
    for (const post of posts.slice(7)) {
      events.push({ userId, postId: post.postId, type: "comment", ts: post.date });
    }
  }
  return { posts, events, members, exposureNow };
}

export function clockCommunity(exposureNow: number): {
  posts: PostRecord[];
  events: EventRecord[];
  members: MemberRecord[];
  exposureNow: number;
} {
  const posts: PostRecord[] = [0, 1].map((index) => ({
    postId: index + 1,
    date: exposureNow - (200 - index) * DAY_SECONDS,
    views: null,
    reach: null,
  }));
  return {
    posts,
    events: [],
    members: [person(1, exposureNow - 100 * DAY_SECONDS)],
    exposureNow,
  };
}

function person(userId: number, lastSeen: number): MemberRecord {
  return {
    userId,
    lastSeen,
    lastSeenHidden: false,
    deactivated: null,
    role: null,
    isDonut: false,
    lastInboundDmTs: null,
    whitelisted: false,
    firstName: "Участник",
    lastName: String(userId),
  };
}
