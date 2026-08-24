const TOKEN_KEY = "turnen_auth_token";

// Leer am Domain-Root (lokale Entwicklung), "/turnen-light" im
// Produktions-Build (siehe .env.production) - die App läuft dort unter
// squora.de/turnen-light/ statt am Root, API-Aufrufe müssen also denselben
// Präfix tragen.
const API_BASE = import.meta.env.VITE_API_URL ?? "";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

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
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};
