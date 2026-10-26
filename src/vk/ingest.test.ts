import { afterEach, describe, expect, it, vi } from "vitest";
import { ingestCommunity, VkApi, VkApiError } from "./ingest.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VkApi", () => {
  it("includes the unavailable API method in errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              error_code: 27,
              error_msg: "Group authorization failed: method is unavailable with group auth.",
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const api = new VkApi("group-token", 0);
    await expect(api.call("wall.get", { owner_id: -42 })).rejects.toMatchObject({
      method: "wall.get",
      message: "VK API error 27 in wall.get: Group authorization failed: method is unavailable with group auth.",
    } satisfies Partial<VkApiError>);
  });
});

describe("community ingestion authorization", () => {
  it("uses the community caller for Donut members and message methods", async () => {
    const readMethods: string[] = [];
    const communityMethods: string[] = [];
    const readCall = vi.fn(async (method: string) => {
      readMethods.push(method);
      return { count: 0, items: [] };
    });
    const messageCall = vi.fn(async (method: string) => {
      communityMethods.push(method);
      return { count: 0, items: [] };
    });
    const progress: string[] = [];

    await ingestCommunity(readCall, 42, messageCall, (update) => progress.push(update.stage));

    expect(readMethods).toContain("wall.get");
    expect(readMethods).toContain("groups.getMembers");
    expect(communityMethods).toEqual(["groups.getMembers", "messages.getConversations"]);
    expect(readMethods).not.toContain("messages.getConversations");
    expect(readMethods).toContain("groups.getMembers");
    expect(progress).toEqual(["wall", "members", "protection", "messages"]);
  });
});
