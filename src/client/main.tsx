import { createRoot } from "react-dom/client";
import bridge from "@vkontakte/vk-bridge";
import "@vkontakte/vkui/dist/vkui.css";
import "./global.css";
import { App } from "./App.tsx";

bridge.send("VKWebAppInit").catch(() => undefined);

const root = document.getElementById("root");
if (!root) throw new Error("Нет #root");
createRoot(root).render(<App />);
