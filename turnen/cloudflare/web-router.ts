// Web-Worker für die Turnen-SPA: liefert statische Assets, macht SPA-Fallback
// auf index.html und leitet /api/* per Service Binding an den API-Worker
// weiter (siehe worker/wrangler.toml). Läuft - anders als im
// tournament-manager-Referenzprojekt - ohne Pfad-Präfix direkt auf "/".

export interface Env {
  ASSETS: Fetcher;
  API: Fetcher;
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, { status: response.status, headers });
}

function acceptsHtml(request: Request): boolean {
  return request.headers.get("Accept")?.includes("text/html") ?? false;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      const apiResponse = await env.API.fetch(request);
      return withSecurityHeaders(apiResponse);
    }

    let response = await env.ASSETS.fetch(request);

    if (response.status === 404 && request.method === "GET" && acceptsHtml(request)) {
      const fallbackUrl = new URL("/", url);
      response = await env.ASSETS.fetch(new Request(fallbackUrl, request));
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "no-cache");
      response = new Response(response.body, { status: 200, headers });
    }

    return withSecurityHeaders(response);
  },
} satisfies ExportedHandler<Env>;
