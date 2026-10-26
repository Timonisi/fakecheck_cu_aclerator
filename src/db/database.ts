import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Deactivated, EventRecord, MemberRecord, PostRecord, ReactionType } from "../scoring/types.ts";

import type { ExperimentRow } from "../scoring/experiment.ts";

export type { ExperimentRow };

export type CommunityData = {
  posts: PostRecord[];
  events: EventRecord[];
  members: MemberRecord[];
};

function deactivatedOf(value: string | null): Deactivated | null {
  if (value === "deleted" || value === "banned") return value;
  return null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS posts (
  post_id INTEGER PRIMARY KEY,
  date INTEGER NOT NULL,
  views INTEGER,
  reach INTEGER
);

CREATE TABLE IF NOT EXISTS events (
  user_id INTEGER NOT NULL,
  post_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  ts INTEGER,
  PRIMARY KEY (user_id, post_id, type)
);

CREATE TABLE IF NOT EXISTS members (
  user_id INTEGER PRIMARY KEY,
  last_seen INTEGER,
  last_seen_hidden INTEGER NOT NULL,
  deactivated TEXT,
  role TEXT,
  is_donut INTEGER NOT NULL,
  last_inbound_dm_ts INTEGER,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS whitelist (
  user_id INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS experiments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  removed_ids TEXT NOT NULL,
  post_ids TEXT NOT NULL,
  er_all REAL,
  er_comments_reposts REAL,
  avg_reach REAL,
  reach_source TEXT NOT NULL,
  n_removed INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS events_post ON events(post_id);
CREATE INDEX IF NOT EXISTS events_user ON events(user_id);
`;

export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

export function replaceCommunityData(db: DatabaseSync, data: CommunityData): void {
  const insertPost = db.prepare(
    "INSERT INTO posts (post_id, date, views, reach) VALUES (?, ?, ?, ?)",
  );
  const insertEvent = db.prepare(
    "INSERT INTO events (user_id, post_id, type, ts) VALUES (?, ?, ?, ?)",
  );
  const insertMember = db.prepare(
    `INSERT INTO members (
      user_id, last_seen, last_seen_hidden, deactivated, role, is_donut, last_inbound_dm_ts, first_name, last_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM events");
    db.exec("DELETE FROM posts");
    db.exec("DELETE FROM members");
    for (const post of data.posts) insertPost.run(post.postId, post.date, post.views, post.reach);
    for (const event of data.events) insertEvent.run(event.userId, event.postId, event.type, event.ts);
    for (const member of data.members) {
      insertMember.run(
        member.userId,
        member.lastSeen,
        member.lastSeenHidden ? 1 : 0,
        member.deactivated,
        member.role,
        member.isDonut ? 1 : 0,
        member.lastInboundDmTs,
        member.firstName,
        member.lastName,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function loadCommunity(db: DatabaseSync): CommunityData {
  const whitelist = new Set(
    (db.prepare("SELECT user_id FROM whitelist").all() as Array<{ user_id: number }>).map(
      (row) => row.user_id,
    ),
  );
  const posts = (
    db.prepare("SELECT post_id, date, views, reach FROM posts ORDER BY date").all() as Array<{
      post_id: number;
      date: number;
      views: number | null;
      reach: number | null;
    }>
  ).map((row) => ({
    postId: row.post_id,
    date: row.date,
    views: row.views,
    reach: row.reach,
  }));
  const events = (
    db.prepare("SELECT user_id, post_id, type, ts FROM events").all() as Array<{
      user_id: number;
      post_id: number;
      type: string;
      ts: number | null;
    }>
  ).map((row) => ({
    userId: row.user_id,
    postId: row.post_id,
    type: row.type as ReactionType,
    ts: row.ts,
  }));
  const members = (
    db.prepare(
      `SELECT user_id, last_seen, last_seen_hidden, deactivated, role, is_donut, last_inbound_dm_ts, first_name, last_name
       FROM members`,
    ).all() as Array<{
      user_id: number;
      last_seen: number | null;
      last_seen_hidden: number;
      deactivated: string | null;
      role: string | null;
      is_donut: number;
      last_inbound_dm_ts: number | null;
      first_name: string;
      last_name: string;
    }>
  ).map((row) => ({
    userId: row.user_id,
    lastSeen: row.last_seen,
    lastSeenHidden: row.last_seen_hidden === 1,
    deactivated: deactivatedOf(row.deactivated),
    role: row.role,
    isDonut: row.is_donut === 1,
    lastInboundDmTs: row.last_inbound_dm_ts,
    whitelisted: whitelist.has(row.user_id),
    firstName: row.first_name,
    lastName: row.last_name,
  }));
  return { posts, events, members };
}

export function addToWhitelist(db: DatabaseSync, userId: number): void {
  db.prepare("INSERT OR IGNORE INTO whitelist (user_id) VALUES (?)").run(userId);
}

export function insertExperiment(
  db: DatabaseSync,
  row: Omit<ExperimentRow, "id">,
): number {
  const result = db
    .prepare(
      `INSERT INTO experiments (
        created_at, removed_ids, post_ids, er_all, er_comments_reposts, avg_reach, reach_source, n_removed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.createdAt,
      JSON.stringify(row.removedIds),
      JSON.stringify(row.postIds),
      row.erAll,
      row.erCommentsReposts,
      row.avgReach,
      row.reachSource,
      row.nRemoved,
    );
  return Number(result.lastInsertRowid);
}

export function latestExperiment(db: DatabaseSync): ExperimentRow | null {
  const row = db
    .prepare(
      `SELECT id, created_at, removed_ids, post_ids, er_all, er_comments_reposts, avg_reach, reach_source, n_removed
       FROM experiments ORDER BY id DESC LIMIT 1`,
    )
    .get() as
    | {
        id: number;
        created_at: number;
        removed_ids: string;
        post_ids: string;
        er_all: number | null;
        er_comments_reposts: number | null;
        avg_reach: number | null;
        reach_source: string;
        n_removed: number;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.created_at,
    removedIds: JSON.parse(row.removed_ids) as number[],
    postIds: JSON.parse(row.post_ids) as number[],
    erAll: row.er_all,
    erCommentsReposts: row.er_comments_reposts,
    avgReach: row.avg_reach,
    reachSource: row.reach_source,
    nRemoved: row.n_removed,
  };
}
