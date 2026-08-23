import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { ThemeToggle } from "./ThemeToggle";
import { NotificationBell } from "./NotificationBell";
import SquoraBrand from "./SquoraBrand";

const NAV_ITEMS = [
  { to: "/gruppen", label: "Gruppen" },
  { to: "/kinder", label: "Kinder" },
  { to: "/anwesenheit", label: "Anwesenheit" },
  { to: "/uebersicht", label: "Übersicht" },
  { to: "/auslastung", label: "Auslastung" },
  { to: "/kalender", label: "Kalender" },
  { to: "/export", label: "Export" },
  { to: "/verlauf", label: "Verlauf" },
  { to: "/verein", label: "Verein" },
];

export function AppLayout() {
  const { userName, userEmail, clubName, signOut } = useAuth();

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto max-w-5xl px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <SquoraBrand />
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
          {/* Eigene, horizontal scrollbare Zeile statt in der Kopfzeile
              mitzulaufen - sonst laufen auf schmalen Bildschirmen (iPhone)
              Logo, Navigation und Nutzer-Aktionen ineinander. */}
          <nav className="-mx-4 mt-3 flex gap-1 overflow-x-auto px-4 pb-0.5">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex-shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ${
                    isActive
                      ? "bg-emerald-600 text-white"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
