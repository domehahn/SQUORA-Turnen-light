import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import type { Child, Group } from "../lib/types";
import { DropdownPortal } from "./DropdownPortal";

const MAX_RESULTS = 6;

// Sucht über bereits nutzerspezifisch gefilterte Endpunkte (GET
// /api/children, /api/groups liefern serverseitig ohnehin nur, was die
// jeweilige Rolle sehen darf) - kein eigener Suchendpunkt nötig, nur einmal
// pro Öffnen geladen und dann clientseitig gefiltert.
export function GlobalSearch() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [children, setChildren] = useState<Child[] | null>(null);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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

  const groupById = new Map((groups ?? []).map((g) => [g.id, g]));
  const q = query.trim().toLowerCase();
  const matchedChildren =
    q.length >= 2 ? (children ?? []).filter((c) => `${c.firstName} ${c.lastName}`.toLowerCase().includes(q)).slice(0, MAX_RESULTS) : [];
  const matchedGroups = q.length >= 2 ? (groups ?? []).filter((g) => g.name.toLowerCase().includes(q)).slice(0, MAX_RESULTS) : [];
  const hasResults = matchedChildren.length > 0 || matchedGroups.length > 0;

  function goToChild(child: Child) {
    setOpen(false);
    setQuery("");
    navigate(`/kinder?q=${encodeURIComponent(`${child.firstName} ${child.lastName}`)}`);
  }

  function goToGroup() {
    setOpen(false);
    setQuery("");
    navigate("/gruppen");
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => {
          setOpen((v) => !v);
          void ensureLoaded();
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className="rounded-md border border-slate-300 p-1.5 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        title="Suche"
        aria-label="Suche öffnen"
      >
        🔍
      </button>
      <DropdownPortal anchorRef={containerRef} open={open}>
        <div
          ref={panelRef}
          className="w-80 max-w-[90vw] rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="border-b border-slate-100 p-2 dark:border-slate-800">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Kind oder Gruppe suchen…"
              className="w-full rounded-md border border-slate-300 bg-transparent px-2 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:text-slate-100"
            />
          </div>
          <div className="max-h-80 overflow-y-auto">
            {loading && <p className="px-3 py-4 text-center text-sm text-slate-400 dark:text-slate-500">Lädt…</p>}
            {!loading && q.length < 2 && (
              <p className="px-3 py-4 text-center text-sm text-slate-400 dark:text-slate-500">Mind. 2 Zeichen eingeben.</p>
            )}
            {!loading && q.length >= 2 && !hasResults && (
              <p className="px-3 py-4 text-center text-sm text-slate-400 dark:text-slate-500">Keine Treffer.</p>
            )}
            {matchedChildren.length > 0 && (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {matchedChildren.map((child) => (
                  <li key={child.id}>
                    <button
                      onClick={() => goToChild(child)}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
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
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
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
      </DropdownPortal>
    </div>
  );
}
