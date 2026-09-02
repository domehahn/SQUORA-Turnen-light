import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

// Leer am Domain-Root (lokale Entwicklung), "/turnen-light" im
// Produktions-Build (siehe .env.production) - die App läuft dort unter
// squora.de/turnen-light/ statt am Root, API-Aufrufe müssen also denselben
// Präfix tragen. In der nativen App (Capacitor) muss VITE_API_URL eine
// absolute URL sein (z.B. https://squora.de/turnen-light), da die WebView
// nicht von dieser Origin ausgeliefert wird.
const API_BASE = import.meta.env.VITE_API_URL ?? "";

// --- Auth-Transport -------------------------------------------------------
// Web: HttpOnly-Cookie, vom Browser automatisch mitgeschickt (credentials).
// Native App: Bearer-Token, hier gehalten und im geräteeigenen Secure-
// Storage (Keychain/Keystore via @capacitor/preferences) persistiert. Die
// WebView-Origin kann das squora.de-Cookie nicht nutzen.
export const IS_NATIVE = Capacitor.isNativePlatform();
const TOKEN_KEY = "turnen_session_token";
export const APP_CLIENT_HEADER = "turnen-app";

let authToken: string | null = null;

export async function loadAuthToken(): Promise<void> {
  if (!IS_NATIVE) return;
  try {
    authToken = (await Preferences.get({ key: TOKEN_KEY })).value;
  } catch {
    authToken = null;
  }
}

export async function setAuthToken(token: string | null): Promise<void> {
  authToken = token;
  if (!IS_NATIVE) return;
  try {
    if (token) await Preferences.set({ key: TOKEN_KEY, value: token });
    else await Preferences.remove({ key: TOKEN_KEY });
  } catch {
    /* Storage nicht verfügbar - Token bleibt zumindest im Speicher */
  }
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (IS_NATIVE) {
    headers["X-Client"] = APP_CLIENT_HEADER;
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  }
  return headers;
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
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    if (res.status === 401) authToken = null; // abgelaufene native Sitzung
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
    headers: authHeaders({ "Content-Type": contentType }),
    body: body as BodyInit,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    if (res.status === 401) authToken = null;
    throw new ApiError((data as { error?: string } | null)?.error ?? `Fehler ${res.status}`, res.status, data);
  }
}

// Login/MFA laufen über denselben Weg, brauchen aber die Antwort, um im
// nativen Fall das Token (Feld `token`, nur bei X-Client "turnen-app")
// herauszuziehen. `AuthContext` nutzt das.
export async function loginRequest<T>(path: string, body: unknown): Promise<T> {
  const result = await request<T>("POST", path, body);
  const token = (result as { token?: unknown } | null)?.token;
  if (IS_NATIVE && typeof token === "string") await setAuthToken(token);
  return result;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};
