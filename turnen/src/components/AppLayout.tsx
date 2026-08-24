import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { ThemeToggle } from "./ThemeToggle";
import { NotificationBell } from "./NotificationBell";
import SquoraBrand from "./SquoraBrand";

// Statt einer einzigen, mit 13 Punkten überladenen Zeile: gruppiert nach
// Basis (Tagesgeschäft jeder Turnleitung), Assistent (Planung/Überblick)
// und Verein (vereinsweite Verwaltung/Reporting).
const NAV_GROUPS: { label: string; items: { to: string; label: string; end?: boolean }[] }[] = [
  {
    label: "Basis",
    items: [
      { to: "/", label: "Start", end: true },
      { to: "/gruppen", label: "Gruppen" },
      { to: "/kinder", label: "Kinder" },
      { to: "/anwesenheit", label: "Anwesenheit" },
      { to: "/kalender", label: "Kalender" },
    ],
  },
  {
    label: "Assistent",
    items: [
      { to: "/uebersicht", label: "Übersicht" },
      { to: "/auslastung", label: "Auslastung" },
      { to: "/vertretungen", label: "Vertretungen" },
    ],
  },
  {
    label: "Verein",
    items: [
      { to: "/warteliste", label: "Warteliste" },
      { to: "/mitgliederstatistik", label: "Statistik" },
      { to: "/export", label: "Export" },
      { to: "/verlauf", label: "Verlauf" },
      { to: "/verein", label: "Verein" },
    ],
  },
];

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return `block rounded-md px-3 py-1.5 text-sm font-medium ${
    isActive
      ? "bg-emerald-600 text-white"
      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
  }`;
}

export function AppLayout() {
  const { userName, userEmail, clubName, signOut } = useAuth();
  const [navOpen, setNavOpen] = useState(false);

  const sidebarContent = (
    <>
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="mb-5">
          <p className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            {group.label}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass} onClick={() => setNavOpen(false)}>
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </>
  );

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setNavOpen((prev) => !prev)}
              aria-label="Navigation öffnen"
              className="rounded-md border border-slate-300 p-2 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 sm:hidden"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M2 5h16v1.5H2V5Zm0 4.25h16v1.5H2v-1.5ZM2 13.5h16V15H2v-1.5Z" clipRule="evenodd" />
              </svg>
            </button>
            <SquoraBrand />
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden max-w-[14rem] truncate text-sm text-slate-500 dark:text-slate-400 sm:inline">
              {userName ?? userEmail}
              {clubName ? ` · ${clubName}` : ""}
            </span>
            <NotificationBell />
            <ThemeToggle />
            <button
              onClick={signOut}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Abmelden
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-6 px-4 py-6">
        {/* Mobil: ausklappbare Overlay-Navigation samt Backdrop; ab sm:
            feste Seitenspalte statt der bisherigen, mit 13 Punkten
            überladenen horizontalen Zeile. */}
        {navOpen && (
          <div className="fixed inset-0 z-30 bg-black/30 sm:hidden" onClick={() => setNavOpen(false)} aria-hidden="true" />
        )}
        <nav
          className={`fixed inset-y-0 left-0 z-40 w-64 overflow-y-auto border-r border-slate-200 bg-white p-4 transition-transform dark:border-slate-800 dark:bg-slate-900 sm:static sm:z-auto sm:w-48 sm:shrink-0 sm:translate-x-0 sm:border-r-0 sm:bg-transparent sm:p-0 sm:dark:bg-transparent ${
            navOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          {sidebarContent}
        </nav>

        <main className="min-w-0 flex-1 pb-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
