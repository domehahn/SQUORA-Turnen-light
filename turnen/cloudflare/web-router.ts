// Web-Worker für die Turnen-SPA: liefert statische Assets, macht SPA-Fallback
// auf index.html und leitet /api/* per Service Binding an den API-Worker
// weiter (siehe worker/wrangler.toml).
//
// Läuft unter zwei Hosts gleichzeitig: dem workers.dev-Standardnamen (ohne
// Pfad-Präfix) und squora.de/turnen-light/ (siehe [[routes]] in
// wrangler.toml). Der Produktions-Build referenziert seine eigenen Assets
// immer mit dem Präfix "/turnen-light/..." (vite `base`, siehe
// .env.production) - dieser Router schneidet den Präfix deshalb unabhängig
// vom aufrufenden Host ab, sobald er vorkommt, und reicht alles andere
// unverändert durch.

export interface Env {
  ASSETS: Fetcher;
  API: Fetcher;
}

const APP_PREFIX = "/turnen-light";

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
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function rewriteRequest(request: Request, pathname: string): Request {
  const url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url, request);
}

function acceptsHtml(request: Request): boolean {
  return request.headers.get("Accept")?.includes("text/html") ?? false;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    // "/turnen-light" (ohne Slash) auf "/turnen-light/" umleiten, sonst
    // würden relative Asset-Pfade im HTML falsch auflösen.
    if (url.pathname === APP_PREFIX) {
      url.pathname = `${APP_PREFIX}/`;
      return Response.redirect(url.toString(), 308);
    }

    const hasPrefix = url.pathname === APP_PREFIX || url.pathname.startsWith(`${APP_PREFIX}/`);
    const relativePath = hasPrefix ? url.pathname.slice(APP_PREFIX.length) || "/" : url.pathname;

    if (relativePath === "/api" || relativePath.startsWith("/api/")) {
      const apiResponse = await env.API.fetch(rewriteRequest(request, relativePath));
      return withSecurityHeaders(apiResponse);
    }

    let response = await env.ASSETS.fetch(rewriteRequest(request, relativePath));

    if (response.status === 404 && request.method === "GET" && acceptsHtml(request)) {
      // "/" statt "/index.html" anfragen: Workers Assets leitet interne
      // "/index.html"-Requests per Default (html_handling) auf "/" um, was
      // hier fälschlich als 200 mit leerem Body durchgereicht würde.
      response = await env.ASSETS.fetch(rewriteRequest(request, "/"));
      // index.html darf nie langfristig gecacht werden, sonst bekommen
      // Rückkehrer nach einem Deploy weiterhin die alte Asset-Referenz.
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "no-cache");
      response = new Response(response.body, { status: 200, headers });
    }

    return withSecurityHeaders(response);
  },
} satisfies ExportedHandler<Env>;
