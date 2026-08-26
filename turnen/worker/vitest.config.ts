import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Test-Setup für den API-Worker - läuft in echtem Workers-Runtime (workerd),
// nicht in Node/jsdom, damit z.B. WebCrypto (AES-GCM in crypto.ts) exakt so
// funktioniert wie in Produktion. JWT_SECRET/ENCRYPTION_KEY sind reine
// Test-Dummies (nie die echten Produktions-Secrets - die stehen nur als
// Cloudflare Workers Secret, nicht in diesem Repo). Migrationen werden vor
// jedem Testlauf frisch auf eine isolierte In-Memory-D1 angewendet (siehe
// test/apply-migrations.ts) - keine Berührung der echten Produktivdatenbank.
export default defineWorkersConfig(async () => {
  const migrationsPath = path.join(dirname, "migrations");
  const migrations = await readD1Migrations(migrationsPath);
  return {
    test: {
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.toml" },
          miniflare: {
            bindings: {
              JWT_SECRET: "test-only-secret-not-for-production",
              ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd",
              FRONTEND_URL: "https://example.test",
              TEST_MIGRATIONS: migrations,
            },
          },
        },
      },
    },
  };
});
