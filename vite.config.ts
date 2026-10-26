import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const api = "http://127.0.0.1:3001";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "build",
    emptyOutDir: true,
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/overview": api,
      "/simulate": api,
      "/sync": api,
      "/experiment": api,
      "/remove": api,
      "/health": api,
    },
  },
});
