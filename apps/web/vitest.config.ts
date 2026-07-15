import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

process.env["PUBLISHER_HMAC_SECRET"] ??= crypto.randomUUID();

export default defineConfig(async () => {
  const migrations = await readD1Migrations(new URL("./migrations", import.meta.url).pathname);

  return {
    plugins: [
      cloudflareTest({
        main: "./src/worker/index.ts",
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
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
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
