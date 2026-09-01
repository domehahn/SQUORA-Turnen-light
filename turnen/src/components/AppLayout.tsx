import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { ThemeToggle } from "./ThemeToggle";
import { NotificationBell } from "./NotificationBell";
import { UserMenu } from "./UserMenu";
import { GlobalSearch } from "./GlobalSearch";
import { AdminClubSwitcher } from "./AdminClubSwitcher";
import { IdleTimerProvider } from "../context/IdleTimerContext";
import { SessionTimerBadge } from "./SessionTimerBadge";
import { IdleLockOverlay } from "./IdleLockOverlay";
import { MfaEnforcementOverlay } from "./MfaEnforcementOverlay";
import { PasswordChangeRequiredOverlay } from "./PasswordChangeRequiredOverlay";
import SquoraBrand from "./SquoraBrand";

// Statt einer einzigen, mit 13 Punkten überladenen Zeile: gruppiert nach
// Basis (Tagesgeschäft jeder Turnleitung), Assistent (Planung/Überblick)
// und Verein (vereinsweite Verwaltung/Reporting).
// `springerOk`: für die Rolle "springer" sichtbar. Springer:innen leiten keine
// eigene Gruppe und haben eine bewusst reduzierte Navigation.
// `kassenwartOrLeader`: sichtbar für Jugendleitung ODER Kassenwart:in (das
// additive Flag) - unabhängig von der eigentlichen Rolle.
const NAV_GROUPS: {
  label: string;
  items: {
    to: string;
    label: string;
    end?: boolean;
    jugendleiterOnly?: boolean;
    adminOnly?: boolean;
    springerOk?: boolean;
    kassenwartOrLeader?: boolean;
  }[];
}[] = [
  {
    label: "Basis",
    items: [
      { to: "/", label: "Dashboard", end: true, springerOk: true },
      { to: "/gruppen", label: "Gruppen" },
      { to: "/kinder", label: "Kinder" },
      { to: "/anwesenheit", label: "Anwesenheit", springerOk: true },
      { to: "/kalender", label: "Kalender", springerOk: true },
      { to: "/events", label: "Events", springerOk: true },
      { to: "/geraete", label: "Gerätemelder", springerOk: true },
      { to: "/pinnwand", label: "Schwarzes Brett", springerOk: true },
    ],
  },
  {
    label: "Assistent",
    items: [
      { to: "/uebersicht", label: "Übersicht" },
      { to: "/auslastung", label: "Auslastung" },
      { to: "/vertretungen", label: "Vertretungen", springerOk: true },
      { to: "/warteliste", label: "Warteliste" },
      { to: "/turnplaner", label: "Turnplaner" },
      { to: "/saisonwechsel", label: "Saisonwechsel", jugendleiterOnly: true },
    ],
  },
  {
    label: "Verein",
    items: [
      { to: "/stundennachweise", label: "Stundennachweise", kassenwartOrLeader: true },
      { to: "/mitgliederstatistik", label: "Statistik" },
      { to: "/export", label: "Export" },
      // Bewusst nur für die Admin-Rolle sichtbar (nicht mehr für alle bzw.
      // Jugendleitung) - explizite Nutzerentscheidung. Zeigt anders als
      // "Admin: Verlauf" (Plattform-Gruppe, vereinsübergreifend) nur den
      // Verlauf des aktuell im Header gewählten Vereins.
      { to: "/verlauf", label: "Verlauf", adminOnly: true },
      // "Verein" bewusst nur für die Jugendleitung (siehe AppLayout unten) -
      // unten aus NAV_GROUPS herausgefiltert statt hier fest eingetragen.
      { to: "/verein", label: "Verein", jugendleiterOnly: true },
    ],
  },
  {
    label: "Plattform",
    items: [
      { to: "/admin/vereine", label: "Admin: Vereine", adminOnly: true },
      { to: "/admin/nutzer", label: "Admin: Nutzer*innen", adminOnly: true },
      { to: "/admin/verlauf", label: "Admin: Verlauf", adminOnly: true },
      { to: "/admin/betrieb", label: "Admin: Betrieb", adminOnly: true },
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
  const { clubRole, isKassenwart, isAdmin, mfaSetupRequired, passwordChangeRequired } = useAuth();
  const isJugendleiter = clubRole === "jugendleiter";
  const isSpringer = clubRole === "springer";
  const [navOpen, setNavOpen] = useState(false);

  const sidebarContent = (
    <>
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter(
          (item) =>
            (!item.jugendleiterOnly || isJugendleiter) &&
            (!item.adminOnly || isAdmin) &&
            (!item.kassenwartOrLeader || isJugendleiter || isKassenwart || isAdmin) &&
            // Springer:innen sehen nur die ausdrücklich freigegebenen Punkte
            // (Admin-Punkte bleiben über adminOnly sichtbar).
            (!isSpringer || item.springerOk || item.adminOnly)
        );
        if (items.length === 0) return null;
        return (
          <div key={group.label} className="mb-5">
            <p className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass} onClick={() => setNavOpen(false)}>
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );

  return (
    <IdleTimerProvider>
      <div className="min-h-screen">
        <IdleLockOverlay />
        {passwordChangeRequired ? <PasswordChangeRequiredOverlay /> : mfaSetupRequired && <MfaEnforcementOverlay />}
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
              {isAdmin && <AdminClubSwitcher />}
              <GlobalSearch />
              <NotificationBell />
              <SessionTimerBadge />
              <ThemeToggle />
              <UserMenu />
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
    </IdleTimerProvider>
  );
}
