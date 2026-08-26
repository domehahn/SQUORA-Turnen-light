import type { Env } from "../src/types";

// Macht die echten Worker-Bindings (DB, ENCRYPTION_KEY, ...) im Test-`env`
// bekannt - ohne diese Deklaration kennt `cloudflare:test`s `ProvidedEnv`
// nur, was hier explizit ergänzt wird.
declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: import("@cloudflare/vitest-pool-workers/config").D1Migration[];
  }
}
