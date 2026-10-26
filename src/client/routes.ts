import { createHashRouter, createPanel, createView, RoutesConfig } from "@vkontakte/vk-mini-apps-router";

export const views = {
  forecast: "forecast",
  lists: "lists",
  result: "result",
} as const;

const routes = RoutesConfig.create([
  createView(views.forecast, [createPanel(views.forecast, "/")]),
  createView(views.lists, [createPanel(views.lists, `/${views.lists}`)]),
  createView(views.result, [createPanel(views.result, `/${views.result}`)]),
]);

export const router = createHashRouter(routes.getRoutes());
