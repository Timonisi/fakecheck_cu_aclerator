import { serve } from "@hono/node-server";
import { openDatabase } from "../db/database.ts";
import { loadEnv } from "../env.ts";
import { createApp } from "./app.ts";

loadEnv();

const port = Number(process.env.PORT ?? 3001);
const dbPath = process.env.DB_PATH ?? "data/fakestata.sqlite";
const db = openDatabase(dbPath);

const app = createApp({
  db,
  appSecret: process.env.VK_APP_SECRET || undefined,
  vk: null,
});

serve({ fetch: app.fetch, port }, () => {
  console.log(`api http://127.0.0.1:${port}`);
});
