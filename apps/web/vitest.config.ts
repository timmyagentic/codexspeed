import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

process.env["PUBLISHER_HMAC_SECRET"] ??= crypto.randomUUID();

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/worker/auth.ts",
      miniflare: {
        // The latest test pool currently bundles workerd 2026-07-10, while the
        // production Worker intentionally uses today's compatibility date.
        compatibilityDate: "2026-07-10",
      },
      wrangler: {
        configPath: "./wrangler.jsonc",
      },
    }),
  ],
  test: {
    include: ["src/worker/**/*.test.ts"],
  },
});
