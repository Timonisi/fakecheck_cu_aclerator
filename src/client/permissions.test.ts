import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vkontakte/vk-bridge", () => ({
  default: { send: vi.fn() },
  parseURLSearchParamsForGetLaunchParams: (search: string) => {
    const params = new URLSearchParams(search);
    return {
      vk_app_id: params.get("vk_app_id") ? Number(params.get("vk_app_id")) : null,
      vk_group_id: params.get("vk_group_id") ? Number(params.get("vk_group_id")) : null,
    };
  },
}));

import bridge from "@vkontakte/vk-bridge";
import {
  adminCommunitiesFrom,
  listAdminCommunities,
  requestCommunityAccess,
  requestUserApiAccess,
} from "./permissions.ts";

const groupAuthError = {
  error_data: { error_description: "Group authorization failed: method is unavailable with group auth." },
};

describe("admin communities", () => {
  beforeEach(() => {
    vi.mocked(bridge.send).mockReset();
    Object.defineProperty(globalThis, "window", {
      value: { location: { search: "?vk_app_id=123" } },
      configurable: true,
    });
  });

  it("keeps administrators and skips editors", () => {
    expect(
      adminCommunitiesFrom([
        { id: 2, name: "Ягода", admin_level: 2, members_count: 10 },
        { id: 1, name: "Арбуз", admin_level: 3, members_count: 20 },
        { id: 3, name: "  ", members_count: 5 },
      ]),
    ).toEqual([
      { id: 1, name: "Арбуз", membersCount: 20 },
      { id: 3, name: "Сообщество 3", membersCount: 5 },
    ]);
  });

  it("explains that group authorization cannot request a user token", async () => {
    const send = vi.mocked(bridge.send);
    send.mockRejectedValueOnce(groupAuthError);

    await expect(requestCommunityAccess(42)).rejects.toThrow(
      "Откройте мини-приложение от личного аккаунта VK, а не от имени сообщества",
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("VKWebAppGetCommunityToken", {
      app_id: 123,
      group_id: 42,
      scope: "manage,messages",
    });
  });

  it("keeps working when the messages permission is not granted", async () => {
    const send = vi.mocked(bridge.send);
    send.mockResolvedValueOnce({ access_token: "group-token", scope: "manage" });

    const result = await requestCommunityAccess(42);

    expect(result.accessToken).toBe("group-token");
    expect(result.warnings).toEqual([
      "Право сообщений не выдано: недавние личные сообщения не защитят участника.",
    ]);
  });

  it("explains group authorization failures while listing communities", async () => {
    vi.mocked(bridge.send).mockRejectedValueOnce(groupAuthError);

    await expect(listAdminCommunities()).rejects.toThrow(
      "Откройте мини-приложение от личного аккаунта VK, а не от имени сообщества",
    );
  });

  it("recognizes group authorization failures with array descriptions", async () => {
    vi.mocked(bridge.send).mockRejectedValueOnce({
      error_data: { error_description: ["Group authorization failed: method is unavailable with group auth."] },
    });

    await expect(requestCommunityAccess(42)).rejects.toThrow(
      "Откройте мини-приложение от личного аккаунта VK, а не от имени сообщества",
    );
  });

  it("requests a user token for wall and group API methods", async () => {
    const send = vi.mocked(bridge.send);
    send.mockResolvedValueOnce({ access_token: "user-token", scope: "groups,wall,stats" });

    await expect(requestUserApiAccess()).resolves.toEqual({ accessToken: "user-token" });
    expect(send).toHaveBeenCalledWith("VKWebAppGetAuthToken", {
      app_id: 123,
      scope: "groups,wall,stats",
    });
  });

  it("explains when VK blocks user-token auth in group authorization mode", async () => {
    vi.mocked(bridge.send).mockRejectedValueOnce(groupAuthError);

    await expect(requestUserApiAccess()).rejects.toThrow(
      "VK отклонил VKWebAppGetAuthToken в режиме авторизации сообщества",
    );
  });
});