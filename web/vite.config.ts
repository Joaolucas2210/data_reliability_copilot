import { defineConfig } from "vite";

// ponytail: no @vitejs/plugin-react — Vite 8 transforms TSX itself; add the plugin only if Fast Refresh is wanted.
export default defineConfig({
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
  preview: { proxy: { "/api": "http://127.0.0.1:8000" } },
});
