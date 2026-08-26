export interface Env {
  DB: D1Database;
  EXPORTS?: R2Bucket;
  APP_ENV: string;
  DATA_CLASSIFICATION: string;
}

/**
 * Minimal Worker shell.
 *
 * IMPORTANT:
 * - Never log request bodies or health/personal data.
 * - All authenticated API responses containing personal data should use
 *   Cache-Control: no-store, private.
 * - Implement authentication + object-level authorization before exposing data.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff"
        }
      });
    }

    return new Response("Not Found", {
      status: 404,
      headers: {
        "cache-control": "no-store"
      }
    });
  }
};
