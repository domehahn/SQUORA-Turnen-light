import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import type { Child, Group } from "../lib/types";

const MAX_RESULTS = 6;

// Sucht über bereits nutzerspezifisch gefilterte Endpunkte (GET
// /api/children, /api/groups liefern serverseitig ohnehin nur, was die
// jeweilige Rolle sehen darf) - kein eigener Suchendpunkt nötig, nur einmal
// pro Öffnen geladen und dann clientseitig gefiltert. Als Command-Palette
// (⌘K) über der ganzen Seite, statt als kleines Dropdown am Icon.
export function GlobalSearch() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [children, setChildren] = useState<Child[] | null>(null);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function ensureLoaded() {
    if (children !== null && groups !== null) return;
    setLoading(true);
    try {
      const [childList, groupList] = await Promise.all([api.get<Child[]>("/api/children"), api.get<Group[]>("/api/groups")]);
      setChildren(childList);
      setGroups(groupList);
    } catch {
      // Suche ist ein Komfortfeature - Ladefehler ignorieren wir hier.
    } finally {
      setLoading(false);
    }
  }

  function openPalette() {
    setOpen(true);
    void ensureLoaded();
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function close() {
    setOpen(false);
    setQuery("");
  }

  // ⌘K / Strg+K öffnet die Suche von überall in der App, Escape schließt sie.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPalette();
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groupById = new Map((groups ?? []).map((g) => [g.id, g]));
  const q = query.trim().toLowerCase();
  const matchedChildren =
    q.length >= 2 ? (children ?? []).filter((c) => `${c.firstName} ${c.lastName}`.toLowerCase().includes(q)).slice(0, MAX_RESULTS) : [];
  const matchedGroups = q.length >= 2 ? (groups ?? []).filter((g) => g.name.toLowerCase().includes(q)).slice(0, MAX_RESULTS) : [];
  const hasResults = matchedChildren.length > 0 || matchedGroups.length > 0;

  function goToChild(child: Child) {
    close();
    navigate(`/kinder?q=${encodeURIComponent(`${child.firstName} ${child.lastName}`)}`);
  }

  function goToGroup() {
    close();
    navigate("/gruppen");
  }

  return (
    <>
      <button
        onClick={openPalette}
        className="flex items-center gap-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        <span aria-hidden="true">🔍</span>
        <span className="hidden sm:inline">Suche</span>
        <span className="ml-1 hidden rounded border border-slate-300 px-1.5 py-0.5 font-mono text-[10px] text-slate-400 sm:inline dark:border-slate-700 dark:text-slate-500">
          ⌘K
        </span>
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex justify-center bg-black/50 px-4 pt-[12vh] backdrop-blur-sm"
            onClick={close}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="h-fit w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <span className="text-slate-400 dark:text-slate-500" aria-hidden="true">
                  🔍
                </span>
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Kinder, Gruppen suchen…"
                  className="w-full bg-transparent text-base text-slate-800 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
                />
              </div>
              <div className="max-h-[60vh] overflow-y-auto">
                {loading && <p className="px-4 py-8 text-center text-sm text-slate-400 dark:text-slate-500">Lädt…</p>}
                {!loading && q.length < 2 && (
                  <p className="px-4 py-8 text-center text-sm text-slate-400 dark:text-slate-500">
                    Mindestens 2 Zeichen eingeben, um zu suchen.
                  </p>
                )}
                {!loading && q.length >= 2 && !hasResults && (
                  <p className="px-4 py-8 text-center text-sm text-slate-400 dark:text-slate-500">Keine Treffer.</p>
                )}
                {matchedChildren.length > 0 && (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {matchedChildren.map((child) => (
                      <li key={child.id}>
                        <button
                          onClick={() => goToChild(child)}
                          className="block w-full px-4 py-2.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <span className="font-medium text-slate-800 dark:text-slate-100">
                            {child.firstName} {child.lastName}
                          </span>
                          <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">
                            {child.groupId ? (groupById.get(child.groupId)?.name ?? "unbekannte Gruppe") : "ohne Gruppe"}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {matchedGroups.length > 0 && (
                  <ul className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
                    {matchedGroups.map((group) => (
                      <li key={group.id}>
                        <button
                          onClick={goToGroup}
                          className="block w-full px-4 py-2.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <span className="font-medium text-slate-800 dark:text-slate-100">{group.name}</span>
                          <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">Gruppe</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
