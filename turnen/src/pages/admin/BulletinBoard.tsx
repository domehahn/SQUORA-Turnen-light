import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { BulletinCategory, BulletinPost } from "../../lib/types";
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

const CATEGORY_LABELS: Record<BulletinCategory, { label: string; badge: string }> = {
  urgent: { label: "Dringend", badge: "bg-red-100 text-red-800 dark:bg-red-950/80 dark:text-red-300" },
  hall: { label: "Hallensperrung", badge: "bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300" },
  training: { label: "Training & Gruppen", badge: "bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300" },
  event: { label: "Events", badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300" },
  general: { label: "Allgemein", badge: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
};

export default function BulletinBoard() {
  const { userId, clubRole, isAdmin } = useAuth();
  const isLeadership = clubRole === "jugendleiter" || isAdmin;

  const [posts, setPosts] = useState<BulletinPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingPost, setEditingPost] = useState<BulletinPost | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    content: "",
    category: "general" as BulletinCategory,
    isPinned: false,
  });
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Filter
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    loadPosts();
  }, []);

  async function loadPosts() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<BulletinPost[]>("/api/bulletin-posts");
      setPosts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Laden des Schwarzen Bretts");
    } finally {
      setLoading(false);
    }
  }

  function openCreateModal() {
    setEditingPost(null);
    setFormData({
      title: "",
      content: "",
      category: "general",
      isPinned: false,
    });
    setModalError(null);
    setShowModal(true);
  }

  function openEditModal(post: BulletinPost) {
    setEditingPost(post);
    setFormData({
      title: post.title,
      content: post.content,
      category: post.category,
      isPinned: post.isPinned,
    });
    setModalError(null);
    setShowModal(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setModalError(null);
    try {
      if (editingPost) {
        await api.put(`/api/bulletin-posts/${editingPost.id}`, formData);
      } else {
        await api.post("/api/bulletin-posts", formData);
      }
      setShowModal(false);
      await loadPosts();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Fehler beim Speichern");
    } finally {
      setSaving(false);
    }
  }

  async function handleTogglePin(post: BulletinPost) {
    try {
      await api.put(`/api/bulletin-posts/${post.id}`, { isPinned: !post.isPinned });
      await loadPosts();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Fehler beim Anpinnen");
    }
  }

  async function handleDelete(id: string, title: string) {
    if (!window.confirm(`Mitteilung "${title}" wirklich löschen?`)) return;
    try {
      await api.del(`/api/bulletin-posts/${id}`);
      await loadPosts();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Fehler beim Löschen");
    }
  }

  const filteredPosts = posts.filter((p) => {
    if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchTitle = p.title.toLowerCase().includes(q);
      const matchContent = p.content.toLowerCase().includes(q);
      const matchAuthor = (p.authorName ?? "").toLowerCase().includes(q);
      if (!matchTitle && !matchContent && !matchAuthor) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Schwarzes Brett & Mitteilungen</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Vereinsinterne Ankündigungen, Hallenschließungen, Lehrgangsangebote und Informationen für alle Übungsleiter*innen.
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="rounded-md bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 shadow-sm"
        >
          + Neue Mitteilung verfassen
        </button>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">Fehler: {error}</p>}

      {/* Filter & Suche */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setCategoryFilter("all")}
            className={`rounded px-2.5 py-1 text-xs font-semibold ${
              categoryFilter === "all"
                ? "bg-emerald-600 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
            }`}
          >
            Alle ({posts.length})
          </button>
          {(Object.keys(CATEGORY_LABELS) as BulletinCategory[]).map((cat) => {
            const count = posts.filter((p) => p.category === cat).length;
            return (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`rounded px-2.5 py-1 text-xs font-semibold ${
                  categoryFilter === cat
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                }`}
              >
                {CATEGORY_LABELS[cat].label} ({count})
              </button>
            );
          })}
        </div>

        <input
          type="text"
          placeholder="Mitteilungen durchsuchen…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-xs rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
      </div>

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Lädt Mitteilungen…</p>
      ) : filteredPosts.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          Keine Mitteilungen auf dem Schwarzen Brett.
        </div>
      ) : (
        <div className="space-y-4">
          {filteredPosts.map((p) => {
            const catInfo = CATEGORY_LABELS[p.category] ?? CATEGORY_LABELS.general;
            const canManage = isLeadership || p.authorId === userId;
            return (
              <div
                key={p.id}
                className={`flex flex-col justify-between rounded-lg border p-5 shadow-sm ${
                  p.isPinned
                    ? "border-emerald-300 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20"
                    : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                }`}
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        {p.isPinned && (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
                            📌 Oben angepinnt
                          </span>
                        )}
                        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${catInfo.badge}`}>
                          {catInfo.label}
                        </span>
                      </div>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{p.title}</h3>
                      <p className="text-xs text-slate-400 dark:text-slate-500">
                        Verfasst von <span className="font-medium text-slate-600 dark:text-slate-300">{p.authorName ?? "Unbekannt"}</span> · {formatDateDisplay(p.createdAt)}
                      </p>
                    </div>
                  </div>

                  <div className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                    {p.content}
                  </div>
                </div>

                {/* Footer Buttons */}
                <div className="mt-4 flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800/80">
                  {isLeadership && (
                    <button
                      onClick={() => handleTogglePin(p)}
                      className="text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                    >
                      {p.isPinned ? "📌 Pin aufheben" : "📌 Oben anpinnen"}
                    </button>
                  )}

                  {canManage && (
                    <div className="flex items-center gap-3 ml-auto">
                      <button
                        onClick={() => openEditModal(p)}
                        className="text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                      >
                        Bearbeiten
                      </button>
                      <button
                        onClick={() => handleDelete(p.id, p.title)}
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
              {editingPost ? "Mitteilung bearbeiten" : "Neue Mitteilung verfassen"}
            </h3>

            {modalError && <p className="mb-3 text-xs text-red-600 dark:text-red-400">{modalError}</p>}

            <form onSubmit={handleSave} className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Titel / Überschrift *
                </label>
                <input
                  type="text"
                  required
                  placeholder="z. B. Hallenschließung in den Herbstferien"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Kategorie
                </label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value as BulletinCategory })}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="general">📌 Allgemein</option>
                  <option value="urgent">🚨 Dringend</option>
                  <option value="hall">🏫 Hallensperrung</option>
                  <option value="training">🤸‍♂️ Training & Gruppen</option>
                  <option value="event">🎪 Events</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Inhalt der Mitteilung *
                </label>
                <textarea
                  rows={5}
                  required
                  placeholder="Details zur Mitteilung eingeben…"
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              {isLeadership && (
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={formData.isPinned}
                    onChange={(e) => setFormData({ ...formData, isPinned: e.target.checked })}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  📌 Oben auf dem Schwarzen Brett anpinnen
                </label>
              )}

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
                  {saving ? "Speichert…" : editingPost ? "Änderungen speichern" : "Mitteilung veröffentlichen"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
