import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // Mirrors the "@/*" path mapping in tsconfig.json so imports resolve the same
  // way under tsc, Next, and Vitest.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    include: ["features/**/*.test.{ts,tsx}"],
    clearMocks: true,
    restoreMocks: true,
  },
});
