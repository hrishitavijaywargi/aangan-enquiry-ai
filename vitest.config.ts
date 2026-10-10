import { defineConfig } from "vitest/config";
import os from "node:os";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(process.cwd(), "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    testTimeout: 30_000,
    env: {
      AANGAN_DB_PATH: ":memory:",
      AANGAN_OUTBOX_DIR: path.join(os.tmpdir(), "aangan-test-outbox"),
      AI_PROVIDER: "mock",
      ANTHROPIC_API_KEY: "",
      SMTP_HOST: "",
      SMTP_USER: "",
      SMTP_PASS: "",
      TELEPHONY_PROVIDER: "demo",
    },
  },
});
