import { defineConfig } from "vitest/config";

// Mirrors the estate test posture (org-admin vitest.config.ts): node env, serial files,
// generous timeouts (bcrypt cost-12 + live-DB integration runs — the estate's
// integration-test-timeout doctrine).
export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
