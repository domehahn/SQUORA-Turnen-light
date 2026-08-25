import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Notification } from "../lib/types";

const POLL_INTERVAL_MS = 60_000;

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      setNotifications(await api.get<Notification[]>("/api/notifications"));
    } catch {
      // Benachrichtigungen sind ein Zusatzfeature - Ladefehler ignorieren wir hier.
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  async function markRead(id: string) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    try {
      await api.post(`/api/notifications/${id}/read`, {});
    } catch {
      // Best effort - bei Fehler bleibt es lokal als gelesen markiert.
    }
  }

  async function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await api.post("/api/notifications/read-all", {});
    } catch {
      // s.o.
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-md border border-slate-300 p-1.5 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        title="Benachrichtigungen"
      >
        🔔
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-[60] mt-2 w-80 max-w-[90vw] rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 dark:border-slate-800">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Benachrichtigungen</span>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs text-emerald-700 hover:underline dark:text-emerald-400">
                Alle als gelesen markieren
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-slate-400 dark:text-slate-500">Keine Benachrichtigungen.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {notifications.map((n) => (
                  <li
                    key={n.id}
                    onClick={() => !n.read && markRead(n.id)}
                    className={`cursor-pointer px-3 py-2 text-sm ${n.read ? "text-slate-500 dark:text-slate-400" : "bg-emerald-50 font-medium text-slate-800 dark:bg-emerald-950/30 dark:text-slate-100"}`}
                  >
                    <p>{n.title}</p>
                    <p className="text-xs font-normal text-slate-500 dark:text-slate-400">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
