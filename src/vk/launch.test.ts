import { describe, expect, it } from "vitest";
import { isValidVkLaunch, vkLaunchSign } from "./launch.ts";

describe("vk launch sign", () => {
  it("accepts a signature over vk_ params only", () => {
    const secret = "app-secret";
    const params = new URLSearchParams({
      vk_user_id: "1",
      vk_app_id: "2",
      vk_group_id: "3",
      extra: "ignore",
    });
    params.set("sign", vkLaunchSign(params, secret));
    expect(isValidVkLaunch(params.toString(), secret)).toBe(true);
    params.set("sign", "broken");
    expect(isValidVkLaunch(params.toString(), secret)).toBe(false);
  });
});
