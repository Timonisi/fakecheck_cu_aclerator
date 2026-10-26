import bridge from "@vkontakte/vk-bridge";
import type { ExperimentRow } from "../scoring/experiment.ts";

const KEY = "experiment";
const LIMIT = 4096;

export async function loadSnapshot(): Promise<ExperimentRow | null> {
  try {
    const response = await bridge.send("VKWebAppStorageGet", { keys: [KEY] });
    const value = response.keys.find((item) => item.key === KEY)?.value ?? "";
    const parsed = parseSnapshot(value);
    if (parsed) return parsed;
  } catch {
    // Вне ВКонтакте моста нет — ниже запасной вариант в этом браузере.
  }
  return parseSnapshot(localStorage.getItem(KEY) ?? "");
}

export async function saveSnapshot(row: ExperimentRow): Promise<void> {
  const value = encodeSnapshot(row);
  localStorage.setItem(KEY, value);
  try {
    await bridge.send("VKWebAppStorageSet", { key: KEY, value });
  } catch (error) {
    if (bridge.isWebView()) {
      const message = error instanceof Error ? error.message : "Не удалось сохранить снимок в хранилище ВКонтакте";
      throw new Error(message);
    }
  }
}

function encodeSnapshot(row: ExperimentRow): string {
  const full = JSON.stringify(row);
  if (full.length <= LIMIT) return full;
  const compact = JSON.stringify({ ...row, postIds: [] });
  if (compact.length <= LIMIT) return compact;
  throw new Error("Снимок не помещается в хранилище ВКонтакте.");
}

function parseSnapshot(value: string): ExperimentRow | null {
  if (!value) return null;
  try {
    const row = JSON.parse(value) as Partial<ExperimentRow>;
    if (typeof row.createdAt !== "number" || !Array.isArray(row.removedIds)) return null;
    return {
      id: typeof row.id === "number" ? row.id : 1,
      createdAt: row.createdAt,
      removedIds: row.removedIds.filter((id) => typeof id === "number"),
      postIds: Array.isArray(row.postIds) ? row.postIds.filter((id) => typeof id === "number") : [],
      erAll: numberOrNull(row.erAll),
      erCommentsReposts: numberOrNull(row.erCommentsReposts),
      avgReach: numberOrNull(row.avgReach),
      reachSource: typeof row.reachSource === "string" ? row.reachSource : "none",
      nRemoved: typeof row.nRemoved === "number" ? row.nRemoved : row.removedIds.length,
    };
  } catch {
    return null;
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}
