import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import type { Child, ClubWaitlistEntry, Group, PlacementRequest } from "../../lib/types";
import { useAuth } from "../../context/useAuth";
import { FloatingInput, FloatingSelect } from "../../components/FloatingField";
import { CAPACITY_CANCELLED, withCapacityConfirm } from "../../lib/capacityConfirm";
import { calculateAgeYears } from "../../lib/age";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "short" }).format(new Date(iso));
}

const NEW_CHILD_VALUE = "__new__";

interface GroupFit {
  group: Group;
  count: number;
  utilization: number; // 0..1, Gruppen ohne Limit zählen als 0 (am attraktivsten)
  ageFits: boolean;
}

export default function ClubWaitlist() {
  const { userId, clubId, clubRole } = useAuth();
  const isJugendleiter = clubRole === "jugendleiter";

  const [entries, setEntries] = useState<ClubWaitlistEntry[]>([]);
  const [incoming, setIncoming] = useState<PlacementRequest[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [childId, setChildId] = useState("");
  const [note, setNote] = useState("");
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");
  const [newBirthDate, setNewBirthDate] = useState("");
  const [proposalGroup, setProposalGroup] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [entryList, childList, groupList, incomingList] = await Promise.all([
        api.get<ClubWaitlistEntry[]>("/api/club-waitlist"),
        api.get<Child[]>("/api/children"),
        api.get<Group[]>("/api/groups"),
        api.get<PlacementRequest[]>("/api/placement-requests/incoming"),
      ]);
      setEntries(entryList);
      setChildren(childList);
      setGroups(groupList);
      setIncoming(incomingList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Vorschlag vorbelegen: die Gruppe, die vom Alter her passt und aktuell
  // am wenigsten ausgelastet ist - Jugendleitung kann das im Dropdown noch
  // überschreiben.
  useEffect(() => {
    if (groups.length === 0 || children.length === 0) return;
    setProposalGroup((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const entry of entries) {
        if (entry.pendingProposal || next[entry.id]) continue;
        const best = recommendGroup(entry.childId)[0];
        if (best) {
          next[entry.id] = best.group.id;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, groups, children]);

  // Kinder ohne Gruppe sind die typischen Kandidaten für die Warteliste,
  // aber ein Kind, das schon irgendwo trainiert, aber umziehen soll, wäre
  // ein Fall für "Verschieben" bei den Kindern - hier daher nur ungruppierte.
  const waitingChildIds = new Set(entries.map((e) => e.childId));
  const candidateChildren = children.filter((c) => c.groupId === null && !waitingChildIds.has(c.id));

  // Für jede Gruppe die aktuelle Auslastung (Kinder / Kapazität) - Basis für
  // den automatischen Vorschlag "passt vom Alter und ist am wenigsten voll".
  const groupFits: GroupFit[] = useMemo(
    () =>
      groups.map((group) => {
        const count = children.filter((c) => c.groupId === group.id).length;
        return {
          group,
          count,
          utilization: group.maxChildren ? count / group.maxChildren : 0,
          ageFits: false,
        };
      }),
    [groups, children]
  );

  // Beste passende Gruppe für ein Kind: erst nach Altersgruppe filtern, dann
  // nach geringster Auslastung sortieren (bei Gleichstand nach absoluter
  // Kinderzahl, damit sich die Empfehlung nicht willkürlich anfühlt).
  function recommendGroup(childId: string): GroupFit[] {
    const child = children.find((c) => c.id === childId);
    if (!child) return [];
    const age = calculateAgeYears(child.birthDate);
    return groupFits
      .map((fit) => ({ ...fit, ageFits: age >= fit.group.minAge && age < fit.group.maxAge }))
      .sort((a, b) => {
        if (a.ageFits !== b.ageFits) return a.ageFits ? -1 : 1;
        if (a.utilization !== b.utilization) return a.utilization - b.utilization;
        return a.count - b.count;
      });
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    const isNewChild = childId === NEW_CHILD_VALUE;
    if (!childId || (isNewChild && (!newFirstName || !newLastName || !newBirthDate))) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      let targetChildId = childId;
      if (isNewChild) {
        // Neuanmeldung ohne Gruppe - Kind wird bewusst gruppenlos angelegt
        // und direkt auf die Warteliste gesetzt, ohne den Umweg über die
        // Kinder-Seite.
        const child = await api.post<Child>("/api/children", {
          firstName: newFirstName,
          lastName: newLastName,
          birthDate: newBirthDate,
          groupId: null,
        });
        targetChildId = child.id;
      }
      await api.post("/api/club-waitlist", { childId: targetChildId, note: note || null });
      setInfo("Kind zur Warteliste hinzugefügt.");
      setChildId("");
      setNote("");
      setNewFirstName("");
      setNewLastName("");
      setNewBirthDate("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Hinzufügen");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel(id: string) {
    setError(null);
    setBusy(true);
    try {
      await api.post(`/api/club-waitlist/${id}/cancel`, {});
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Entfernen");
    } finally {
      setBusy(false);
    }
  }

  async function handlePropose(entryId: string) {
    const groupId = proposalGroup[entryId];
    if (!groupId) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      await api.post(`/api/club-waitlist/${entryId}/propose`, { groupId });
      setInfo("Vorschlag an die Gruppenleitung geschickt – wartet auf Bestätigung.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Vorschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm(id: string) {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const result = await withCapacityConfirm((confirmOverCapacity) =>
        api.post<{ ok: true }>(`/api/placement-requests/${id}/confirm`, { confirmOverCapacity })
      );
      if (result === CAPACITY_CANCELLED) return;
      setInfo("Kind aufgenommen.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Bestätigen");
    } finally {
      setBusy(false);
    }
  }

  async function handleDecline(id: string) {
    setError(null);
    setBusy(true);
    try {
      await api.post(`/api/placement-requests/${id}/decline`, {});
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Ablehnen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Warteliste</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Vereinsweite Liste für Kinder ohne Gruppe.{" "}
          {isJugendleiter
            ? "Als Jugendleitung siehst du hier die vereinsweite Liste und kannst nach Rücksprache eine Gruppe vorschlagen – die Gruppenleitung muss den Vorschlag noch bestätigen."
            : "Melde hier ein Kind an, das noch keine Gruppe hat – die Jugendleitung wird automatisch benachrichtigt und verteilt von dort aus. Die Gesamtliste sieht nur die Jugendleitung; Vorschläge für deine eigenen Gruppen musst du hier aktiv bestätigen oder ablehnen."}
        </p>
      </div>

      {incoming.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
          <h3 className="mb-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
            Platzvorschläge für deine Gruppen ({incoming.length})
          </h3>
          <ul className="space-y-2">
            {incoming.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-white p-3 text-sm dark:border-amber-800 dark:bg-slate-900"
              >
                <span className="text-slate-800 dark:text-slate-100">
                  {r.childName} → {r.groupName}
                  {r.proposedByName ? ` · vorgeschlagen von ${r.proposedByName}` : ""}
                </span>
                <span className="flex gap-2">
                  <button
                    onClick={() => handleConfirm(r.id)}
                    disabled={busy}
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Bestätigen
                  </button>
                  <button
                    onClick={() => handleDecline(r.id)}
                    disabled={busy}
                    className="rounded-md border border-red-300 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
                  >
                    Ablehnen
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="w-56">
          <FloatingSelect label="Kind" value={childId} onChange={(e) => setChildId(e.target.value)}>
            <option value="">Kind wählen…</option>
            {candidateChildren.map((c) => (
              <option key={c.id} value={c.id}>
                {c.firstName} {c.lastName}
              </option>
            ))}
            <option value={NEW_CHILD_VALUE}>+ Neuanmeldung ohne Gruppe…</option>
          </FloatingSelect>
        </div>
        {childId === NEW_CHILD_VALUE && (
          <>
            <div className="w-40">
              <FloatingInput label="Vorname" required value={newFirstName} onChange={(e) => setNewFirstName(e.target.value)} />
            </div>
            <div className="w-40">
              <FloatingInput label="Nachname" required value={newLastName} onChange={(e) => setNewLastName(e.target.value)} />
            </div>
            <div className="w-40">
              <FloatingInput
                label="Geburtsdatum"
                type="date"
                required
                value={newBirthDate}
                onChange={(e) => setNewBirthDate(e.target.value)}
              />
            </div>
          </>
        )}
        <div className="flex-1 min-w-[200px]">
          <FloatingInput label="Notiz (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button
          type="submit"
          disabled={
            busy || !childId || (childId === NEW_CHILD_VALUE && (!newFirstName || !newLastName || !newBirthDate))
          }
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-600"
        >
          Zur Warteliste hinzufügen
        </button>
        {candidateChildren.length === 0 && (
          <p className="w-full text-xs text-slate-400 dark:text-slate-500">
            Aktuell hat jedes bestehende Kind schon eine Gruppe – für eine Neuanmeldung „+ Neuanmeldung ohne
            Gruppe…“ wählen.
          </p>
        )}
      </form>

      {error && <p className="text-sm text-red-600 dark:text-red-400">Fehler: {error}</p>}
      {info && <p className="text-sm text-emerald-700 dark:text-emerald-400">{info}</p>}

      {!isJugendleiter ? (
        <p className="rounded-lg border border-slate-200 bg-white p-4 text-xs text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500">
          Die vereinsweite Warteliste sieht nur die Jugendleitung – deine Anmeldung wurde ihr per Benachrichtigung
          gemeldet.
        </p>
      ) : loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Lädt…</p>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500">
          Aktuell keine Kinder auf der Warteliste.
        </div>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <div>
                <span className="font-medium text-slate-800 dark:text-slate-100">{entry.childName}</span>
                {entry.note && <span className="text-slate-500 dark:text-slate-400"> · „{entry.note}“</span>}
                <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">seit {formatDate(entry.createdAt)}</span>
                {entry.pendingProposal && (
                  <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    Vorschlag: {entry.pendingProposal.groupName} · wartet auf Bestätigung der Gruppenleitung
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                {isJugendleiter && !entry.pendingProposal && (
                  <>
                    {(() => {
                      const ranked = recommendGroup(entry.childId);
                      const best = ranked[0];
                      return (
                        <>
                          {best?.ageFits && (
                            <span className="text-xs text-emerald-700 dark:text-emerald-400">
                              Empfehlung: {best.group.name} ({best.count}/{best.group.maxChildren ?? "∞"} Plätze, passt vom
                              Alter)
                            </span>
                          )}
                          <div className="flex items-end gap-2">
                            <div className="w-56">
                              <FloatingSelect
                                label="Gruppe vorschlagen"
                                id={`propose-group-${entry.id}`}
                                value={proposalGroup[entry.id] ?? ""}
                                onChange={(e) => setProposalGroup((prev) => ({ ...prev, [entry.id]: e.target.value }))}
                              >
                                <option value="">–</option>
                                {ranked.map((fit) => (
                                  <option key={fit.group.id} value={fit.group.id}>
                                    {fit.group.name} ({fit.count}/{fit.group.maxChildren ?? "∞"})
                                    {fit.ageFits ? "" : " – Alter passt nicht"}
                                  </option>
                                ))}
                              </FloatingSelect>
                            </div>
                            <button
                              onClick={() => handlePropose(entry.id)}
                              disabled={busy || !proposalGroup[entry.id]}
                              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              Vorschlagen
                            </button>
                          </div>
                        </>
                      );
                    })()}
                  </>
                )}
                {(entry.addedBy === userId || isJugendleiter) && (
                  <button
                    onClick={() => handleCancel(entry.id)}
                    disabled={busy}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Entfernen
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {!clubId && (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Die Warteliste ist vereinsweit – ohne Vereinszuordnung siehst du hier nichts.
        </p>
      )}
    </div>
  );
}
