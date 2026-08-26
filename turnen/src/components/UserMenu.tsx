import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { DropdownPortal } from "./DropdownPortal";

function initials(name: string | null, email: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
  }
  return (email?.[0] ?? "?").toUpperCase();
}

export function UserMenu() {
  const { userName, userEmail, clubName, clubRole, isAdmin, signOut } = useAuth();
  const [open, setOpen] = useState(false);
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

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md border border-slate-300 py-1 pl-1 pr-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-xs font-semibold text-white">
          {initials(userName, userEmail)}
        </span>
        <span className="hidden max-w-[10rem] truncate sm:inline">{userName ?? userEmail}</span>
      </button>
      <DropdownPortal anchorRef={buttonRef} open={open}>
        <div
          ref={panelRef}
          className="w-64 max-w-[90vw] rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-800">
            <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{userName ?? "Ohne Namen"}</p>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">{userEmail}</p>
            {isAdmin && <p className="mt-1 text-xs font-medium text-blue-600 dark:text-blue-400">Admin</p>}
            {clubName && (
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                {clubName} · {clubRole === "jugendleiter" ? "Jugendleitung" : "Turnleiter*in"}
              </p>
            )}
          </div>
          <Link
            to="/profil"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Profil bearbeiten
          </Link>
          <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
          <button
            onClick={signOut}
            className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-slate-100 dark:text-red-400 dark:hover:bg-slate-800"
          >
            Abmelden
          </button>
        </div>
      </DropdownPortal>
    </div>
  );
}
