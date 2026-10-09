import { defineConfig } from "vite";

// ponytail: no @vitejs/plugin-react — Vite 8 transforms TSX itself; add the plugin only if Fast Refresh is wanted.
const api = `http://127.0.0.1:${process.env.DRC_API_PORT ?? "8000"}`; // second local stack: DRC_API_PORT=8001

export default defineConfig({
  server: { proxy: { "/api": api } },
  preview: { proxy: { "/api": api } },
});
