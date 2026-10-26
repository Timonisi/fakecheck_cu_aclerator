import { createHmac, timingSafeEqual } from "node:crypto";

export function vkLaunchSign(params: URLSearchParams, secret: string): string {
  const parts: string[] = [];
  params.forEach((value, key) => {
    if (key.startsWith("vk_")) parts.push(`${key}=${value}`);
  });
  parts.sort();
  return createHmac("sha256", secret)
    .update(parts.join("&"))
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function isValidVkLaunch(search: string, secret: string): boolean {
  const params = new URLSearchParams(search);
  const sign = params.get("sign");
  if (!sign) return false;
  const expected = Buffer.from(vkLaunchSign(params, secret));
  const actual = Buffer.from(sign);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
