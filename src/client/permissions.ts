import bridge, { parseURLSearchParamsForGetLaunchParams } from "@vkontakte/vk-bridge";
import { VkApi } from "../vk/ingest.ts";

const REQUIRED_SCOPE = "manage";
const REQUESTED_SCOPE = "manage,messages";
const USER_API_SCOPE = "groups,wall,stats";

export type CommunityAccess = {
  accessToken: string;
  groupId: number;
  warnings: string[];
};

export type UserApiAccess = {
  accessToken: string;
};

export type AdminCommunity = {
  id: number;
  name: string;
  membersCount: number | null;
};

type RawGroup = {
  id?: number;
  name?: string;
  admin_level?: number;
  members_count?: number;
};

export function launchedGroupId(): number | null {
  const groupId = parseURLSearchParamsForGetLaunchParams(window.location.search).vk_group_id;
  return groupId && groupId > 0 ? groupId : null;
}

export function adminCommunitiesFrom(items: RawGroup[]): AdminCommunity[] {
  const communities: AdminCommunity[] = [];
  for (const group of items) {
    if (group.id == null || group.id <= 0) continue;
    if (group.admin_level != null && group.admin_level < 3) continue;
    communities.push({
      id: group.id,
      name: group.name?.trim() || `Сообщество ${group.id}`,
      membersCount: typeof group.members_count === "number" ? group.members_count : null,
    });
  }
  communities.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return communities;
}

export async function listAdminCommunities(): Promise<AdminCommunity[]> {
  const appId = requireAppId();
  let token: { access_token: string; scope: string };
  try {
    token = await bridge.send("VKWebAppGetAuthToken", { app_id: appId, scope: "groups" });
  } catch (error) {
    throw new Error(groupsFailure(error));
  }
  const granted = new Set(token.scope.split(",").map((item) => item.trim()).filter(Boolean));
  if (!granted.has("groups")) {
    throw new Error("Без доступа к сообществам нельзя показать, где вы администратор.");
  }
  const api = new VkApi(token.access_token);
  const items: RawGroup[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (offset < total) {
    const response = (await api.call("groups.get", {
      filter: "admin",
      extended: 1,
      fields: "members_count",
      count: 1000,
      offset,
    })) as { count?: number; items?: RawGroup[] };
    const page = response.items ?? [];
    total = response.count ?? offset + page.length;
    items.push(...page);
    if (page.length === 0) break;
    offset += page.length;
  }
  return adminCommunitiesFrom(items);
}

export async function requestCommunityAccess(groupId: number): Promise<CommunityAccess> {
  const appId = requireAppId();
  let result: { access_token: string; scope: string };
  try {
    result = await bridge.send("VKWebAppGetCommunityToken", {
      app_id: appId,
      group_id: groupId,
      scope: REQUESTED_SCOPE,
    });
  } catch (error) {
    throw new Error(permissionFailure(error));
  }

  const granted = new Set(result.scope.split(",").map((item) => item.trim()).filter(Boolean));
  if (!granted.has(REQUIRED_SCOPE)) {
    throw new Error("Без права управления сообществом нельзя читать стену, участников и удалять их.");
  }
  const warnings = granted.has("messages")
    ? []
    : ["Право сообщений не выдано: недавние личные сообщения не защитят участника."];
  return { accessToken: result.access_token, groupId, warnings };
}

export async function requestUserApiAccess(): Promise<UserApiAccess> {
  let result: { access_token: string; scope: string };
  try {
    result = await bridge.send("VKWebAppGetAuthToken", {
      app_id: requireAppId(),
      scope: USER_API_SCOPE,
    });
  } catch (error) {
    throw new Error(userApiPermissionFailure(error));
  }

  const granted = new Set(result.scope.split(",").map((item) => item.trim()).filter(Boolean));
  if (!granted.has("groups") || !granted.has("wall")) {
    throw new Error("Разрешите доступ к сообществам и стене, чтобы загрузить публикации и участников.");
  }
  return { accessToken: result.access_token };
}

function requireAppId(): number {
  const appId = parseURLSearchParamsForGetLaunchParams(window.location.search).vk_app_id;
  if (!appId) throw new Error("Откройте мини-приложение во ВКонтакте: так появится запрос прав.");
  return appId;
}

function groupsFailure(error: unknown): string {
  if (isGroupAuthUnavailable(error)) return groupAuthUnavailableMessage();
  const reason = bridgeReason(error);
  if (/denied|cancel|отклон/i.test(reason)) return "Доступ к списку сообществ не разрешён.";
  return reason || "ВКонтакте не выдал доступ к сообществам.";
}

function permissionFailure(error: unknown): string {
  if (isGroupAuthUnavailable(error)) return groupAuthUnavailableMessage();
  const reason = bridgeReason(error);
  if (/denied|cancel|отклон/i.test(reason)) {
    return "Доступ не разрешён. Нужно право управления сообществом; право сообщений — необязательно.";
  }
  return reason || "ВКонтакте не выдал ключ сообщества.";
}

function userApiPermissionFailure(error: unknown): string {
  if (isGroupAuthUnavailable(error)) {
    return "VK отклонил VKWebAppGetAuthToken в режиме авторизации сообщества. Откройте мини-приложение как пользователь VK, а не из интерфейса сообщества, затем обновите данные.";
  }
  const reason = bridgeReason(error);
  if (/denied|cancel|отклон/i.test(reason)) {
    return "Разрешите доступ к сообществам и стене для загрузки данных.";
  }
  return reason || "ВКонтакте не выдал пользовательский ключ для чтения стены и участников.";
}

function isGroupAuthUnavailable(error: unknown): boolean {
  return /method is unavailable with group auth/i.test(bridgeReason(error));
}

function groupAuthUnavailableMessage(): string {
  return "VK сообщает, что приложение запущено в режиме авторизации сообщества. Откройте мини-приложение от личного аккаунта VK, а не от имени сообщества, и повторите попытку.";
}

function bridgeReason(error: unknown): string {
  if (error && typeof error === "object") {
    if ("error_data" in error && error.error_data && typeof error.error_data === "object") {
      const data = error.error_data;
      const reason =
        firstString("error_description" in data ? data.error_description : undefined) ??
        firstString("error_reason" in data ? data.error_reason : undefined) ??
        firstString("error_msg" in data ? data.error_msg : undefined);
      if (reason) return reason;
    }
    if ("message" in error && typeof error.message === "string") return error.message;
  }
  return String(error ?? "");
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.find((item): item is string => typeof item === "string");
  return undefined;
}
