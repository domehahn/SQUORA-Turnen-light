import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { EquipmentReport, EquipmentSeverity, EquipmentStatus } from "../../lib/types";
import { useAuth } from "../../context/useAuth";

function formatDateDisplay(isoDate: string): string {
  if (!isoDate) return "";
  const d = new Date(isoDate);
  return d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Equipment() {
  const { clubRole, isAdmin } = useAuth();
  const isLeadership = clubRole === "jugendleiter" || isAdmin;

  const [reports, setReports] = useState<EquipmentReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingReport, setEditingReport] = useState<EquipmentReport | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    location: "",
    severity: "medium" as EquipmentSeverity,
    description: "",
  });
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Filter
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "resolved">("active");
  const [search, setSearch] = useState("");

  useEffect(() => {
    loadReports();
  }, []);

  async function loadReports() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<EquipmentReport[]>("/api/equipment-reports");
      setReports(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Laden der Gerätemeldungen");
    } finally {
      setLoading(false);
    }
  }

  function openCreateModal() {
    setEditingReport(null);
    setFormData({
      title: "",
      location: "Halle 1",
      severity: "medium",
      description: "",
    });
    setModalError(null);
    setShowModal(true);
  }

  function openEditModal(report: EquipmentReport) {
    setEditingReport(report);
    setFormData({
      title: report.title,
      location: report.location ?? "",
      severity: report.severity,
      description: report.description ?? "",
    });
    setModalError(null);
    setShowModal(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setModalError(null);
    try {
      if (editingReport) {
        await api.put(`/api/equipment-reports/${editingReport.id}`, formData);
      } else {
        await api.post("/api/equipment-reports", formData);
      }
      setShowModal(false);
      await loadReports();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Fehler beim Speichern");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(id: string, newStatus: EquipmentStatus) {
    try {
      await api.put(`/api/equipment-reports/${id}`, { status: newStatus });
      await loadReports();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Fehler beim Ändern des Status");
    }
  }

  async function handleDelete(id: string, title: string) {
    if (!window.confirm(`Mängelmeldung "${title}" wirklich löschen?`)) return;
    try {
      await api.del(`/api/equipment-reports/${id}`);
      await loadReports();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Fehler beim Löschen");
    }
  }

  const filteredReports = reports.filter((r) => {
    if (statusFilter === "active" && r.status === "resolved") return false;
    if (statusFilter === "resolved" && r.status !== "resolved") return false;

    if (search.trim()) {
      const q = search.toLowerCase();
      const matchTitle = r.title.toLowerCase().includes(q);
      const matchLoc = (r.location ?? "").toLowerCase().includes(q);
      const matchDesc = (r.description ?? "").toLowerCase().includes(q);
      if (!matchTitle && !matchLoc && !matchDesc) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Geräte- & Mängelmelder</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Melde beschädigte Turngeräte (z. B. defektes Sprungbrett, gerissenes Seil, beschädigte Matte) und verfolge den Reparaturstatus im Verein.
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="rounded-md bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 shadow-sm"
        >
          + Mängelmeldung erstellen
        </button>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">Fehler: {error}</p>}

      {/* Filter & Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1 dark:bg-slate-800">
          <button
            onClick={() => setStatusFilter("active")}
            className={`rounded px-3 py-1 text-xs font-semibold ${
              statusFilter === "active"
                ? "bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-slate-100"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            Offen / In Bearbeitung ({reports.filter((r) => r.status !== "resolved").length})
          </button>
          <button
            onClick={() => setStatusFilter("all")}
            className={`rounded px-3 py-1 text-xs font-semibold ${
              statusFilter === "all"
                ? "bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-slate-100"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            Alle ({reports.length})
          </button>
          <button
            onClick={() => setStatusFilter("resolved")}
            className={`rounded px-3 py-1 text-xs font-semibold ${
              statusFilter === "resolved"
                ? "bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-slate-100"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            Behoben ({reports.filter((r) => r.status === "resolved").length})
          </button>
        </div>

        <input
          type="text"
          placeholder="Mängel durchsuchen…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-xs rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
      </div>

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Lädt Gerätemeldungen…</p>
      ) : filteredReports.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          Keine Gerätemeldungen vorhanden.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filteredReports.map((r) => {
            const isHigh = r.severity === "high";
            const isMedium = r.severity === "medium";
            return (
              <div
                key={r.id}
                className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{r.title}</h3>
                      {r.location && (
                        <p className="text-xs text-slate-500 dark:text-slate-400">📍 Standort: {r.location}</p>
                      )}
                      <p className="text-[0.65rem] text-slate-400 dark:text-slate-500">
                        Gemeldet von {r.reportedByName ?? "Unbekannt"} · {formatDateDisplay(r.createdAt)}
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {/* Dringlichkeit Badge */}
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[0.7rem] font-bold ${
                          isHigh
                            ? "bg-red-100 text-red-800 dark:bg-red-950/80 dark:text-red-300"
                            : isMedium
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300"
                            : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        }`}
                      >
                        {isHigh ? "🔴 Hoch (Dringend)" : isMedium ? "🟡 Mittel" : "🟢 Gering"}
                      </span>

                      {/* Status Badge */}
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[0.7rem] font-semibold ${
                          r.status === "open"
                            ? "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-300"
                            : r.status === "in_progress"
                            ? "bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:border-blue-900 dark:text-blue-300"
                            : "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-300"
                        }`}
                      >
                        {r.status === "open"
                          ? "⏳ Offen"
                          : r.status === "in_progress"
                          ? "🔧 In Bearbeitung"
                          : "✅ Behoben"}
                      </span>
                    </div>
                  </div>

                  {r.description && (
                    <div className="rounded-md bg-slate-50 p-2.5 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                      {r.description}
                    </div>
                  )}
                </div>

                {/* Status Aktionen */}
                <div className="mt-4 flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    {r.status === "open" && (
                      <button
                        onClick={() => handleStatusChange(r.id, "in_progress")}
                        className="rounded bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                      >
                        🔧 In Bearbeitung setzen
                      </button>
                    )}
                    {r.status !== "resolved" && (
                      <button
                        onClick={() => handleStatusChange(r.id, "resolved")}
                        className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
                      >
                        ✅ Als Behoben markieren
                      </button>
                    )}
                    {r.status === "resolved" && (
                      <button
                        onClick={() => handleStatusChange(r.id, "open")}
                        className="rounded border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300"
                      >
                        Wieder öffnen
                      </button>
                    )}
                  </div>

                  {isLeadership && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openEditModal(r)}
                        className="text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                      >
                        Bearbeiten
                      </button>
                      <button
                        onClick={() => handleDelete(r.id, r.title)}
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
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <h3 className="mb-4 text-lg font-bold text-slate-900 dark:text-slate-100">
              {editingReport ? "Mängelmeldung bearbeiten" : "Neue Mängelmeldung erstellen"}
            </h3>

            {modalError && <p className="mb-3 text-xs text-red-600 dark:text-red-400">{modalError}</p>}

            <form onSubmit={handleSave} className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Gerät / Bezeichnung des Mangels *
                </label>
                <input
                  type="text"
                  required
                  placeholder="z. B. Sprungbrett Feder gebrochen, Weichbodenmatte Naht offen"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Standort / Halle
                </label>
                <input
                  type="text"
                  placeholder="z. B. Halle 1, Geräteraum Links"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Dringlichkeit / Schweregrad
                </label>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="radio"
                      name="severity"
                      value="low"
                      checked={formData.severity === "low"}
                      onChange={() => setFormData({ ...formData, severity: "low" })}
                      className="text-emerald-600 focus:ring-emerald-500"
                    />
                    🟢 Gering
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="radio"
                      name="severity"
                      value="medium"
                      checked={formData.severity === "medium"}
                      onChange={() => setFormData({ ...formData, severity: "medium" })}
                      className="text-amber-600 focus:ring-amber-500"
                    />
                    🟡 Mittel
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="radio"
                      name="severity"
                      value="high"
                      checked={formData.severity === "high"}
                      onChange={() => setFormData({ ...formData, severity: "high" })}
                      className="text-red-600 focus:ring-red-500"
                    />
                    🔴 Hoch (Dringend)
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Schadensbeschreibung / Details
                </label>
                <textarea
                  rows={3}
                  placeholder="Genaue Beschreibung des Schadens oder der Sicherheitsgefahr…"
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
                  {saving ? "Speichert…" : editingReport ? "Änderungen speichern" : "Mängelmeldung absenden"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
