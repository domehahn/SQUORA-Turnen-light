// Leer am Domain-Root (lokale Entwicklung), "/turnen-light" im
// Produktions-Build (siehe .env.production) - die App läuft dort unter
// squora.de/turnen-light/ statt am Root, API-Aufrufe müssen also denselben
// Präfix tragen.
const API_BASE = import.meta.env.VITE_API_URL ?? "";

// Session-Management-Härtung (externe Production-Readiness-Prüfung
// 2026-08-27): kein JWT mehr im localStorage/Authorization-Header - die
// Sitzung lebt jetzt in einem HttpOnly-Cookie, das der Browser automatisch
// mitschickt. `credentials: "include"` stellt das auch für den lokalen
// Entwicklungsaufbau sicher (Vite-Proxy zu 127.0.0.1:8787 ist aus
// Browser-Sicht zwar same-origin, aber explizit ist hier sicherer als
// implizit).

// Trägt bei Fehlern zusätzlich zur Nachricht den vollständigen JSON-Body der
// API-Antwort mit (z.B. `code` und Detailfelder), damit UI-Code strukturiert
// darauf reagieren kann statt nur die Textnachricht zu parsen.
export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError((data as { error?: string } | null)?.error ?? `Fehler ${res.status}`, res.status, data);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// Für Stellen außerhalb von api.get/post/..., die selbst fetch() aufrufen
// (z.B. CSV-Download) oder einen rohen App-Pfad brauchen (z.B. Druck-Links).
export function apiPath(path: string): string {
  return `${API_BASE}${path}`;
}

// Rohen Binär-Body hochladen (z.B. das eingereichte Stundennachweis-PDF) -
// api.put schickt immer JSON, hier brauchen wir application/pdf.
export async function apiPutBinary(path: string, body: BlobPart, contentType: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": contentType },
    body: body as BodyInit,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError((data as { error?: string } | null)?.error ?? `Fehler ${res.status}`, res.status, data);
  }
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};
