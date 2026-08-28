import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { ClubEvent, ClubMember } from "../../lib/types";
import { useAuth } from "../../context/useAuth";

function formatDateDisplay(isoDate: string): string {
  if (!isoDate) return "";
  const [year, month, day] = isoDate.split("-");
  return `${day}.${month}.${year}`;
}

export default function Events() {
  const { clubRole, isAdmin } = useAuth();
  const isLeadership = clubRole === "jugendleiter" || isAdmin;

  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [members, setMembers] = useState<ClubMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<ClubEvent | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    eventDate: "",
    startTime: "",
    endTime: "",
    location: "",
    requiredTrainers: 2,
    tasks: "",
    materials: "",
  });
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Zuteilungs-Modal für Jugendleitung
  const [assigningEventId, setAssigningEventId] = useState<string | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
  const [selectedTask, setSelectedTask] = useState<string>("");
  const [assigning, setAssigning] = useState(false);

  // Checklisten-Zustand für Materialien (eventId-mat-idx -> boolean)
  const [checkedMaterials, setCheckedMaterials] = useState<Record<string, boolean>>({});

  // Filter
  const [search, setSearch] = useState("");
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [eventsList, membersList] = await Promise.all([
        api.get<ClubEvent[]>("/api/events"),
        isLeadership ? api.get<ClubMember[]>("/api/clubs/mine/members").catch(() => []) : Promise.resolve([]),
      ]);
      setEvents(eventsList);
      setMembers(membersList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Laden der Events");
    } finally {
      setLoading(false);
    }
  }

  function openCreateModal() {
    setEditingEvent(null);
    const today = new Date().toISOString().split("T")[0];
    setFormData({
      title: "",
      description: "",
      eventDate: today,
      startTime: "14:00",
      endTime: "17:00",
      location: "",
      requiredTrainers: 2,
      tasks: "z. B. Pausenaktion Betreuung, Hüpfburg, Urkunden",
      materials: "z. B. Turnmatten, Stoppuhr, Bälle",
    });
    setModalError(null);
    setShowModal(true);
  }

  function openEditModal(event: ClubEvent) {
    setEditingEvent(event);
    setFormData({
      title: event.title,
      description: event.description ?? "",
      eventDate: event.eventDate,
      startTime: event.startTime ?? "",
      endTime: event.endTime ?? "",
      location: event.location ?? "",
      requiredTrainers: event.requiredTrainers,
      tasks: event.tasks ?? "",
      materials: event.materials ?? "",
    });
    setModalError(null);
    setShowModal(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setModalError(null);
    try {
      if (editingEvent) {
        await api.put(`/api/events/${editingEvent.id}`, formData);
      } else {
        await api.post("/api/events", formData);
      }
      setShowModal(false);
      await loadData();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Fehler beim Speichern");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, title: string) {
    if (!window.confirm(`Event "${title}" wirklich löschen?`)) return;
    try {
      await api.del(`/api/events/${id}`);
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Fehler beim Löschen");
    }
  }

  async function handleSelfRegister(eventId: string, unregister = false) {
    try {
      await api.post(`/api/events/${eventId}/register`, { unregister });
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Fehler beim Anmelden als Helfer");
    }
  }

  async function handleAssignMember(eventId: string, userId: string, unassign = false, assignedTask?: string) {
    try {
      setAssigning(true);
      await api.post(`/api/events/${eventId}/assign`, { userId, unassign, assignedTask });
      setAssigningEventId(null);
      setSelectedMemberId("");
      setSelectedTask("");
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Fehler bei der Zuteilung");
    } finally {
      setAssigning(false);
    }
  }

  const todayStr = new Date().toISOString().split("T")[0];
  const filteredEvents = events.filter((ev) => {
    const isUpcoming = ev.eventDate >= todayStr;
    if (!showPast && !isUpcoming) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchTitle = ev.title.toLowerCase().includes(q);
      const matchLoc = (ev.location ?? "").toLowerCase().includes(q);
      const matchTasks = (ev.tasks ?? "").toLowerCase().includes(q);
      if (!matchTitle && !matchLoc && !matchTasks) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Events & Aktionen</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Organisiere Vereins-Events (z. B. Sommerspiele, Pausenaktionen bei Fußballevents), trage benötigte Helfer,
            Aufgaben und Materialien ein und verwalte die Trainer-Zuteilungen.
          </p>
        </div>
        {isLeadership && (
          <button
            onClick={openCreateModal}
            className="rounded-md bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 shadow-sm"
          >
            + Neues Event erstellen
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">Fehler: {error}</p>}

      {/* Filterleiste */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <input
          type="text"
          placeholder="Events durchsuchen…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-xs rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            checked={showPast}
            onChange={(e) => setShowPast(e.target.checked)}
            className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          />
          Vergangene Events anzeigen
        </label>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Lädt Events…</p>
      ) : filteredEvents.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          Keine Events gefunden.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filteredEvents.map((ev) => {
            const isFull = ev.helpers.length >= ev.requiredTrainers;
            return (
              <div
                key={ev.id}
                className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{ev.title}</h3>
                      <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                        📅 {formatDateDisplay(ev.eventDate)}
                        {ev.startTime && ` · ⏰ ${ev.startTime}${ev.endTime ? ` – ${ev.endTime}` : ""} Uhr`}
                      </p>
                      {ev.location && (
                        <p className="text-xs text-slate-500 dark:text-slate-400">📍 {ev.location}</p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                        isFull
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300"
                          : "bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300"
                      }`}
                    >
                      {ev.helpers.length} / {ev.requiredTrainers} Trainer gemeldet
                    </span>
                  </div>

                  {ev.description && (
                    <p className="text-xs text-slate-600 dark:text-slate-300">{ev.description}</p>
                  )}

                  {/* Aufgaben */}
                  {ev.tasks && (
                    <div className="rounded-md bg-slate-50 p-2.5 dark:bg-slate-800/60">
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">📋 Aufgaben:</p>
                      <p className="text-xs text-slate-600 dark:text-slate-400">{ev.tasks}</p>
                    </div>
                  )}

                  {/* Materialien */}
                  {ev.materials && (
                    <div className="rounded-md bg-slate-50 p-2.5 dark:bg-slate-800/60">
                      <p className="mb-1 text-xs font-semibold text-slate-700 dark:text-slate-300">📦 Benötigte Materialien (Checkliste):</p>
                      <div className="space-y-1">
                        {ev.materials
                          .split(/[,;\n]+/)
                          .map((m) => m.trim())
                          .filter(Boolean)
                          .map((item, idx) => {
                            const key = `${ev.id}-mat-${idx}`;
                            const isChecked = Boolean(checkedMaterials[key]);
                            return (
                              <label key={key} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) =>
                                    setCheckedMaterials((prev) => ({ ...prev, [key]: e.target.checked }))
                                  }
                                  className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                />
                                <span className={isChecked ? "line-through text-slate-400 dark:text-slate-500" : ""}>
                                  {item}
                                </span>
                              </label>
                            );
                          })}
                      </div>
                    </div>
                  )}

                  {/* Helfer-Liste */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        👥 Eingeteilte Trainer / Helfer ({ev.helpers.length}):
                      </p>
                      {isLeadership && (
                        <button
                          onClick={() => {
                            setAssigningEventId(assigningEventId === ev.id ? null : ev.id);
                            setSelectedMemberId("");
                            setSelectedTask("");
                          }}
                          className="text-xs font-medium text-emerald-600 hover:underline dark:text-emerald-400"
                        >
                          + Trainer zuteilen
                        </button>
                      )}
                    </div>

                    {/* Zuteilungs-Auswahl für Jugendleitung */}
                    {assigningEventId === ev.id && isLeadership && (
                      <div className="mb-2.5 space-y-1.5 rounded-md border border-emerald-200 bg-emerald-50 p-2.5 dark:border-emerald-900 dark:bg-emerald-950/40">
                        <div className="flex items-center gap-2">
                          <select
                            value={selectedMemberId}
                            onChange={(e) => setSelectedMemberId(e.target.value)}
                            className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          >
                            <option value="">-- Trainer auswählen --</option>
                            {members
                              .filter((m) => !ev.helpers.some((h) => h.userId === m.id))
                              .map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name ?? m.email} ({m.role === "jugendleiter" ? "Jugendleitung" : "Übungsleiter*in"})
                                </option>
                              ))}
                          </select>
                          <button
                            disabled={!selectedMemberId || assigning}
                            onClick={() => handleAssignMember(ev.id, selectedMemberId, false, selectedTask)}
                            className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            Zuteilen
                          </button>
                        </div>
                        <input
                          type="text"
                          placeholder="Aufgabe für Helfer (z. B. Betreuung Hüpfburg)..."
                          value={selectedTask}
                          onChange={(e) => setSelectedTask(e.target.value)}
                          className="w-full rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        />
                      </div>
                    )}

                    {ev.helpers.length === 0 ? (
                      <p className="text-xs text-slate-400 dark:text-slate-500 italic">Noch keine Helfer eingetragen.</p>
                    ) : (
                      <ul className="space-y-1">
                        {ev.helpers.map((h) => (
                          <li
                            key={h.id}
                            className="flex items-center justify-between rounded bg-slate-100 px-2.5 py-1 text-xs dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                          >
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span>👤 {h.userName}</span>
                              {h.assignedTask && (
                                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[0.65rem] font-semibold text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
                                  📌 {h.assignedTask}
                                </span>
                              )}
                              {h.assignedByName ? (
                                <span className="text-[0.65rem] text-slate-400 dark:text-slate-500">
                                  (zugeteilt von {h.assignedByName})
                                </span>
                              ) : (
                                <span className="text-[0.65rem] text-emerald-600 dark:text-emerald-400 font-medium">
                                  (selbst gemeldet)
                                </span>
                              )}
                            </div>
                            {isLeadership && (
                              <button
                                onClick={() => handleAssignMember(ev.id, h.userId, true)}
                                title="Zuteilung aufheben"
                                className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400"
                              >
                                ✕
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                {/* Footer Buttons */}
                <div className="mt-4 flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
                  {ev.isRegistered ? (
                    <button
                      onClick={() => handleSelfRegister(ev.id, true)}
                      className="rounded border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40"
                    >
                      Meldung zurückziehen
                    </button>
                  ) : (
                    <button
                      onClick={() => handleSelfRegister(ev.id, false)}
                      className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                    >
                      🙋‍♂️ Als Helfer melden
                    </button>
                  )}

                  {isLeadership && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openEditModal(ev)}
                        className="text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                      >
                        Bearbeiten
                      </button>
                      <button
                        onClick={() => handleDelete(ev.id, ev.title)}
                        className="text-xs font-medium text-red-600 hover:text-red-800 dark:text-red-400"
                      >
                        Löschen
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: Erstellen / Bearbeiten */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <h3 className="mb-4 text-lg font-bold text-slate-900 dark:text-slate-100">
              {editingEvent ? "Event bearbeiten" : "Neues Event erstellen"}
            </h3>

            {modalError && <p className="mb-3 text-xs text-red-600 dark:text-red-400">{modalError}</p>}

            <form onSubmit={handleSave} className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Titel des Events / Aktion *
                </label>
                <input
                  type="text"
                  required
                  placeholder="z. B. Sommerspiele Pausenaktion"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Datum *</label>
                  <input
                    type="date"
                    required
                    value={formData.eventDate}
                    onChange={(e) => setFormData({ ...formData, eventDate: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Von</label>
                  <input
                    type="time"
                    value={formData.startTime}
                    onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Bis</label>
                  <input
                    type="time"
                    value={formData.endTime}
                    onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Ort / Halle</label>
                  <input
                    type="text"
                    placeholder="z. B. Sportplatz Rasen 2"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Benötigte Trainer *
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={formData.requiredTrainers}
                    onChange={(e) => setFormData({ ...formData, requiredTrainers: parseInt(e.target.value) || 1 })}
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Welche Aufgaben fallen an?
                </label>
                <textarea
                  rows={2}
                  placeholder="z. B. Parcours aufbauen, Betreuung Hüpfburg, Riegenführung"
                  value={formData.tasks}
                  onChange={(e) => setFormData({ ...formData, tasks: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Benötigte Materialien
                </label>
                <textarea
                  rows={2}
                  placeholder="z. B. Turnmatten, Stoppuhren, Bälle, Urkunden"
                  value={formData.materials}
                  onChange={(e) => setFormData({ ...formData, materials: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Zusätzliche Beschreibung
                </label>
                <textarea
                  rows={2}
                  placeholder="Zusätzliche Informationen für die Helfer…"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="mt-5 flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {saving ? "Speichert…" : editingEvent ? "Änderungen speichern" : "Event erstellen"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
