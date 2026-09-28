import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Forward model calls to the local Agent SDK proxy (server/index.mjs),
    // so the browser talks same-origin and never touches Anthropic directly.
    proxy: {
      "/api": {
        target: `http://localhost:${process.env.TABULA_PORT || 8787}`,
        changeOrigin: true,
      },
    },
  },
});
