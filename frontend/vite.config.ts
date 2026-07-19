/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react(), tailwindcss()],
    define: {
      // Only Clerk's publishable key is included in the browser bundle.
      "import.meta.env.CLERK_PUBLISHABLE_KEY": JSON.stringify(env.CLERK_PUBLISHABLE_KEY),
      // In production this is "" (same-origin — FastAPI serves everything).
      // Override with VITE_API_BASE_URL if you ever split frontend/backend again.
      "import.meta.env.VITE_API_BASE_URL": JSON.stringify(env.VITE_API_BASE_URL ?? ""),
    },
    server: {
      port: 5173,
      proxy: {
        // Dev proxy: /api/* → FastAPI at :8000 (strips the /api prefix)
        "/api": {
          target: "http://localhost:8000",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
        "/health": {
          target: "http://localhost:8000",
          changeOrigin: true,
        },
      },
    },
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
    },
  };
});
