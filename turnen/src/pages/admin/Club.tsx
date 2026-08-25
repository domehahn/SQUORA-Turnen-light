import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import type { Club, ClubJoinRequest, ClubMember, Holiday } from "../../lib/types";
import { useAuth } from "../../context/useAuth";
import { FloatingInput, FloatingSelect } from "../../components/FloatingField";
import { loadCustomHolidays } from "../../lib/holidays";
import { parseHolidayFile } from "../../lib/holidayImport";

interface PendingJoin {
  status: "pending_club_join_approval";
  requestId: string;
  clubName: string;
}

function isPendingJoin(value: unknown): value is PendingJoin {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    (value as { status: unknown }).status === "pending_club_join_approval"
  );
}

export default function ClubPage() {
  const { userId, clubId, clubName, clubRole, refreshClub } = useAuth();
  const isJugendleiter = clubRole === "jugendleiter";
  const [clubs, setClubs] = useState<Club[]>([]);
  const [members, setMembers] = useState<ClubMember[]>([]);
  const [myJoinRequest, setMyJoinRequest] = useState<ClubJoinRequest | null>(null);
  const [incomingJoinRequests, setIncomingJoinRequests] = useState<ClubJoinRequest[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [holidayLabel, setHolidayLabel] = useState("");
  const [holidayStart, setHolidayStart] = useState("");
  const [holidayEnd, setHolidayEnd] = useState("");
  const [selectedClubId, setSelectedClubId] = useState("");
  const [newClubName, setNewClubName] = useState("");
  const [clubNumberInput, setClubNumberInput] = useState("");
  const [editingNumber, setEditingNumber] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const currentClub = clubs.find((c) => c.id === clubId);

  async function load() {
    setLoading(true);
    try {
      const [clubList, memberList, mine, incoming, holidayList] = await Promise.all([
        api.get<Club[]>("/api/clubs"),
        clubId && isJugendleiter ? api.get<ClubMember[]>("/api/clubs/mine/members") : Promise.resolve([]),
        api.get<ClubJoinRequest | null>("/api/club-join-requests/mine"),
        isJugendleiter ? api.get<ClubJoinRequest[]>("/api/club-join-requests/incoming") : Promise.resolve([]),
        clubId ? api.get<Holiday[]>("/api/holidays") : Promise.resolve([]),
      ]);
      setClubs(clubList);
      setMembers(memberList);
      setMyJoinRequest(mine);
      setIncomingJoinRequests(incoming);
      setHolidays(holidayList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId, clubRole]);

  async function handleJoin(e: FormEvent) {
    e.preventDefault();
    if (!selectedClubId) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const result = await api.put<{ clubId: string | null } | PendingJoin>("/api/me/club", { clubId: selectedClubId });
      if (isPendingJoin(result)) {
        setInfo(`Beitrittsanfrage an die Jugendleitung von „${result.clubName}“ gesendet – wartet auf Freigabe.`);
      } else {
        await refreshClub();
      }
      setSelectedClubId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Beitreten");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelJoinRequest(id: string) {
    setError(null);
    setBusy(true);
    try {
      await api.post(`/api/club-join-requests/${id}/cancel`, {});
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Zurückziehen");
    } finally {
      setBusy(false);
    }
  }

  async function handleApproveJoinRequest(id: string) {
    setError(null);
    setBusy(true);
    try {
      await api.post(`/api/club-join-requests/${id}/approve`, {});
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Freigeben");
    } finally {
      setBusy(false);
    }
  }

  async function handleRejectJoinRequest(id: string) {
    setError(null);
    setBusy(true);
    try {
      await api.post(`/api/club-join-requests/${id}/reject`, {});
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Ablehnen");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!newClubName.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await api.post("/api/clubs", { name: newClubName.trim() });
      await refreshClub();
      setNewClubName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Anlegen");
    } finally {
      setBusy(false);
    }
  }

  async function handlePromote(userId: string) {
    setError(null);
    setBusy(true);
    try {
      await api.post(`/api/clubs/mine/members/${userId}/promote`, {});
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Befördern");
    } finally {
      setBusy(false);
    }
  }

  async function handleDemote(userId: string) {
    setError(null);
    setBusy(true);
    try {
      await api.post(`/api/clubs/mine/members/${userId}/demote`, {});
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Zurückstufen");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveClubNumber() {
    setError(null);
    setBusy(true);
    try {
      await api.put("/api/clubs/mine/number", { clubNumber: clubNumberInput || null });
      setEditingNumber(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Speichern");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddHoliday(e: FormEvent) {
    e.preventDefault();
    if (!holidayLabel.trim() || !holidayStart || !holidayEnd) return;
    setError(null);
    setBusy(true);
    try {
      await api.post("/api/holidays", { label: holidayLabel.trim(), start: holidayStart, end: holidayEnd });
      setHolidayLabel("");
      setHolidayStart("");
      setHolidayEnd("");
      await load();
      await loadCustomHolidays();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Anlegen");
    } finally {
      setBusy(false);
    }
  }

  async function handleImportFile(file: File) {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const text = await file.text();
      const entries = parseHolidayFile(file.name, text);
      if (entries.length === 0) {
        setError("Konnte keine Zeiträume aus der Datei lesen - unterstützt werden .ics-Kalender oder CSV-Zeilen \"Bezeichnung,Von,Bis\".");
        return;
      }
      const created = await api.post<Holiday[]>("/api/holidays/import", { entries });
      setInfo(`${created.length} Ferien-/Ausfallzeiträume importiert.`);
      await load();
      await loadCustomHolidays();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Importieren");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteHoliday(id: string) {
    setError(null);
    setBusy(true);
    try {
      await api.del(`/api/holidays/${id}`);
      await load();
      await loadCustomHolidays();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Löschen");
    } finally {
      setBusy(false);
    }
  }

  async function handleLeave() {
    if (!confirm("Verein wirklich verlassen? Deine eigenen Gruppen bleiben erhalten, sind aber für andere Vereinsmitglieder nicht mehr sichtbar.")) return;
    setError(null);
    setBusy(true);
    try {
      await api.put("/api/me/club", { clubId: null });
      await refreshClub();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Verlassen");
    } finally {
      setBusy(false);
    }
  }

  const joinableClubs = clubs.filter((c) => c.id !== clubId);

  // Sobald man einem Verein angehört, ist die Verein-Seite (Mitglieder,
  // Vereinsnummer, Ferien) nur noch für die Jugendleitung sichtbar - "Verein
  // beitreten" bleibt für alle sichtbar, solange noch keiner zugeordnet ist,
  // sonst könnten neue Mitglieder nie beitreten.
  if (clubId && clubRole && !isJugendleiter) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Verein</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Diese Seite (Mitglieder, Vereinsnummer, Ferien) sieht nur die Jugendleitung von {clubName ?? "deinem Verein"}.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Verein</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {isJugendleiter
            ? "Turnleiter im selben Verein sehen die Gruppen und Kinderlisten der anderen Mitglieder lesend – bearbeiten kann jede*r nur die eigenen Gruppen. Als Jugendleitung verwaltest du hier Mitglieder, Beitrittsanfragen und die Vereinsnummer."
            : "Beitritte müssen von der Jugendleitung freigegeben werden. Mitgliederverwaltung sieht nur die Jugendleitung."}
        </p>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">Fehler: {error}</p>}
      {info && <p className="text-sm text-emerald-700 dark:text-emerald-400">{info}</p>}

      {isJugendleiter && incomingJoinRequests.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
          <h3 className="mb-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
            Offene Beitrittsanfragen ({incomingJoinRequests.length})
          </h3>
          <ul className="space-y-2">
            {incomingJoinRequests.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-white p-3 text-sm dark:border-amber-800 dark:bg-slate-900"
              >
                <span className="text-slate-800 dark:text-slate-100">{r.userName ?? "Unbekannt"}</span>
                <span className="flex gap-2">
                  <button
                    onClick={() => handleApproveJoinRequest(r.id)}
                    disabled={busy}
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Freigeben
                  </button>
                  <button
                    onClick={() => handleRejectJoinRequest(r.id)}
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

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Lädt…</p>
      ) : clubId ? (
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Aktueller Verein</p>
            <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{clubName}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Vereinsnummer (für den Stundennachweis)
            </p>
            {editingNumber ? (
              <div className="flex items-end gap-2">
                <div className="w-40">
                  <FloatingInput
                    label="Vereinsnummer"
                    value={clubNumberInput}
                    onChange={(e) => setClubNumberInput(e.target.value)}
                  />
                </div>
                <button
                  onClick={handleSaveClubNumber}
                  disabled={busy}
                  className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-600"
                >
                  Speichern
                </button>
                <button
                  onClick={() => setEditingNumber(false)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Abbrechen
                </button>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                {currentClub?.clubNumber ?? "–"}
                {clubRole === "jugendleiter" && (
                  <button
                    onClick={() => {
                      setClubNumberInput(currentClub?.clubNumber ?? "");
                      setEditingNumber(true);
                    }}
                    className="text-xs text-emerald-700 hover:underline dark:text-emerald-400"
                  >
                    Bearbeiten
                  </button>
                )}
              </p>
            )}
          </div>
          {isJugendleiter ? (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Mitglieder ({members.length})
              </p>
              <ul className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
                {members.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      {m.name ?? m.email}
                      {m.role === "jugendleiter" && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                          Jugendleitung
                        </span>
                      )}
                    </span>
                    {m.id !== userId && (
                      <span>
                        {m.role === "jugendleiter" ? (
                          <button
                            onClick={() => handleDemote(m.id)}
                            disabled={busy}
                            className="text-xs text-slate-500 hover:underline disabled:opacity-50 dark:text-slate-400"
                          >
                            Zurückstufen
                          </button>
                        ) : (
                          <button
                            onClick={() => handlePromote(m.id)}
                            disabled={busy}
                            className="text-xs text-emerald-700 hover:underline disabled:opacity-50 dark:text-emerald-400"
                          >
                            Zur Jugendleitung ernennen
                          </button>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Die Mitgliederliste sieht nur die Jugendleitung.
            </p>
          )}
          {isJugendleiter && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Zusätzliche Ferien/Trainingsausfälle ({holidays.length})
            </p>
            <p className="mb-2 text-xs text-slate-400 dark:text-slate-500">
              Keine Ferien sind fest hinterlegt - trage hier ein, an welchen Zeiträumen kein Training stattfindet
              (Schulferien, bewegliche Ferientage, Feiertage). Wirkt sich auf alle Trainingstermin-Berechnungen aus
              (Anwesenheit, Kalender, Übersicht).
            </p>
            {holidays.length > 0 && (
              <ul className="mb-2 space-y-1 text-sm text-slate-700 dark:text-slate-300">
                {holidays.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {h.label}: {h.start} – {h.end}
                    </span>
                    {isJugendleiter && (
                      <button
                        onClick={() => handleDeleteHoliday(h.id)}
                        disabled={busy}
                        className="text-xs text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
                      >
                        Löschen
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {isJugendleiter && (
              <form onSubmit={handleAddHoliday} className="flex flex-wrap items-end gap-2">
                <div className="min-w-[160px] flex-1">
                  <FloatingInput label="Bezeichnung" value={holidayLabel} onChange={(e) => setHolidayLabel(e.target.value)} />
                </div>
                <div className="w-40">
                  <FloatingInput label="Von" type="date" value={holidayStart} onChange={(e) => setHolidayStart(e.target.value)} />
                </div>
                <div className="w-40">
                  <FloatingInput label="Bis" type="date" value={holidayEnd} onChange={(e) => setHolidayEnd(e.target.value)} />
                </div>
                <button
                  type="submit"
                  disabled={busy || !holidayLabel.trim() || !holidayStart || !holidayEnd}
                  className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-600"
                >
                  Hinzufügen
                </button>
              </form>
            )}
            {isJugendleiter && (
              <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                  Ferienkalender importieren (.ics/.csv)
                  <input
                    type="file"
                    accept=".ics,.ical,.csv,text/calendar,text/csv"
                    className="hidden"
                    disabled={busy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) handleImportFile(file);
                    }}
                  />
                </label>
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  ICS-Kalender (z.B. Export aus Outlook/Google Kalender/offiziellen Ferienkalendern) oder CSV-Zeilen
                  im Format „Bezeichnung,Von,Bis" (Datum TT.MM.JJJJ oder JJJJ-MM-TT).
                </p>
              </div>
            )}
          </div>
          )}
          <button
            onClick={handleLeave}
            disabled={busy}
            className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            Verein verlassen
          </button>
        </div>
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Du bist aktuell keinem Verein zugeordnet. Deine Gruppen sind nur für dich sichtbar.
        </p>
      )}

      {!clubId && myJoinRequest && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/40">
          <span className="text-amber-800 dark:text-amber-300">
            Beitrittsanfrage für „{myJoinRequest.clubName}“ wartet auf Freigabe der Jugendleitung.
          </span>
          <button
            onClick={() => handleCancelJoinRequest(myJoinRequest.id)}
            disabled={busy}
            className="rounded-md border border-amber-300 px-3 py-1.5 text-xs text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-900/50"
          >
            Zurückziehen
          </button>
        </div>
      )}

      {!clubId && !myJoinRequest && (
        <div className="grid gap-4 sm:grid-cols-2">
          <form
            onSubmit={handleJoin}
            className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Bestehendem Verein beitreten</h3>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Der Beitritt muss von der Jugendleitung des Vereins freigegeben werden.
            </p>
            <FloatingSelect label="Verein" value={selectedClubId} onChange={(e) => setSelectedClubId(e.target.value)}>
              <option value="">Verein wählen</option>
              {joinableClubs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.memberCount} {c.memberCount === 1 ? "Mitglied" : "Mitglieder"})
                </option>
              ))}
            </FloatingSelect>
            <button
              type="submit"
              disabled={busy || !selectedClubId}
              className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-600"
            >
              Beitrittsanfrage senden
            </button>
            {joinableClubs.length === 0 && (
              <p className="text-xs text-slate-400 dark:text-slate-500">Noch keine Vereine vorhanden.</p>
            )}
          </form>

          <form
            onSubmit={handleCreate}
            className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Neuen Verein anlegen</h3>
            <FloatingInput label="Vereinsname" value={newClubName} onChange={(e) => setNewClubName(e.target.value)} />
            <button
              type="submit"
              disabled={busy || !newClubName.trim()}
              className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-600"
            >
              Anlegen &amp; beitreten
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
