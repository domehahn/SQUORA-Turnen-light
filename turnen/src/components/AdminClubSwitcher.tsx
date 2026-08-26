import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Club } from "../lib/types";
import { useAuth } from "../context/useAuth";
import { DropdownPortal } from "./DropdownPortal";

// Nur für die vereinsübergreifende Admin-Rolle: schneller Vereinswechsel
// direkt im Header, statt erst die Admin-Seite aufrufen zu müssen. Wechselt
// technisch den eigenen Account in den gewählten Verein als dessen
// Jugendleitung (wie /admin/vereine) - die komplette App zeigt danach
// unverändert die Daten dieses Vereins.
export function AdminClubSwitcher() {
  const { clubId, clubName, refreshClub } = useAuth();
  const [open, setOpen] = useState(false);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function ensureLoaded() {
    if (clubs.length > 0) return;
    try {
      setClubs(await api.get<Club[]>("/api/admin/clubs"));
    } catch {
      // Best effort - Klappt das Laden nicht, bleibt die Liste leer.
    }
  }

  async function handleSwitch(club: Club) {
    if (club.id === clubId) {
      setOpen(false);
      return;
    }
    setSwitchingId(club.id);
    try {
      await api.post("/api/admin/switch-club", { clubId: club.id });
      await refreshClub();
    } finally {
      setSwitchingId(null);
      setOpen(false);
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={buttonRef}
        onClick={() => {
          setOpen((v) => !v);
          void ensureLoaded();
        }}
        className="flex items-center gap-1.5 rounded-md border border-blue-300 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900"
        title="Als Admin: Verein wechseln"
      >
        <span aria-hidden="true">🛡️</span>
        <span className="max-w-[8rem] truncate">{clubName ?? "Kein Verein"}</span>
        <span aria-hidden="true">▾</span>
      </button>
      <DropdownPortal anchorRef={buttonRef} open={open}>
        <div
          ref={panelRef}
          className="w-64 max-w-[90vw] rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-800 dark:bg-slate-900"
        >
          <p className="border-b border-slate-100 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
            Als Admin: Verein wechseln
          </p>
          {clubs.length === 0 ? (
            <p className="px-3 py-3 text-sm text-slate-400 dark:text-slate-500">Lädt…</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {clubs.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => handleSwitch(c)}
                    disabled={switchingId === c.id}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800 ${
                      c.id === clubId ? "font-semibold text-emerald-700 dark:text-emerald-400" : "text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <span>{c.name}</span>
                    {c.id === clubId && <span className="text-xs">aktuell</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DropdownPortal>
    </div>
  );
}
