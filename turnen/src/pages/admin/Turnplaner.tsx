import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { Group, PlacedEquipment, TrainingPlan } from "../../lib/types";

interface EquipmentTemplate {
  type: string;
  name: string;
  category: "matten" | "grossgeraete" | "sprung" | "hilfsmittel" | "kleingeraete";
  icon: string;
  defaultWidth: number;
  defaultHeight: number;
  colorClass: string;
}

const CATEGORY_TAB_LABELS: Record<EquipmentTemplate["category"], string> = {
  matten: "🟦 Matten & AirTrack",
  grossgeraete: "🤸‍♂️ Großgeräte",
  sprung: "🚀 Sprunggeräte",
  hilfsmittel: "🧱 Kästen, Bänke & Tau",
  kleingeraete: "⚽ Kleingeräte & Parcours",
};

const EQUIPMENT_TEMPLATES: EquipmentTemplate[] = [
  // 1. Matten & AirTrack
  { type: "weichboden", name: "Weichbodenmatte", category: "matten", icon: "🟦", defaultWidth: 18, defaultHeight: 12, colorClass: "bg-blue-200 border-blue-500 text-blue-900" },
  { type: "niedermatte", name: "Niedermatte", category: "matten", icon: "🟦", defaultWidth: 14, defaultHeight: 10, colorClass: "bg-blue-100 border-blue-400 text-blue-800" },
  { type: "turnmatte", name: "Standard-Turnmatte", category: "matten", icon: "🟩", defaultWidth: 10, defaultHeight: 8, colorClass: "bg-emerald-200 border-emerald-500 text-emerald-900" },
  { type: "airtrack", name: "AirTrack (Luftbahn)", category: "matten", icon: "💨", defaultWidth: 26, defaultHeight: 8, colorClass: "bg-cyan-200 border-cyan-500 text-cyan-950" },
  { type: "keilmatte", name: "Methodikkeil / Rutschkeil", category: "matten", icon: "📐", defaultWidth: 12, defaultHeight: 8, colorClass: "bg-teal-200 border-teal-500 text-teal-950" },

  // 2. Großgeräte
  { type: "schwebebalken", name: "Schwebebalken (Wettkampf)", category: "grossgeraete", icon: "🪵", defaultWidth: 24, defaultHeight: 4, colorClass: "bg-amber-200 border-amber-600 text-amber-900" },
  { type: "methodikbalken", name: "Methodikbalken (Niedrig)", category: "grossgeraete", icon: "🪵", defaultWidth: 20, defaultHeight: 3, colorClass: "bg-amber-100 border-amber-500 text-amber-800" },
  { type: "reck", name: "Reck / Spannreck", category: "grossgeraete", icon: "🤸‍♂️", defaultWidth: 16, defaultHeight: 4, colorClass: "bg-slate-300 border-slate-600 text-slate-900" },
  { type: "stufenbarren", name: "Stufenbarren", category: "grossgeraete", icon: "🤸‍♀️", defaultWidth: 18, defaultHeight: 8, colorClass: "bg-amber-100 border-amber-500 text-amber-900" },
  { type: "barren", name: "Barren (Männer)", category: "grossgeraete", icon: "🤸‍♂️", defaultWidth: 16, defaultHeight: 6, colorClass: "bg-amber-200 border-amber-600 text-amber-900" },
  { type: "sprungtisch", name: "Sprungtisch", category: "grossgeraete", icon: "📦", defaultWidth: 10, defaultHeight: 10, colorClass: "bg-red-200 border-red-500 text-red-900" },
  { type: "sprungbock", name: "Sprungbock", category: "grossgeraete", icon: "🐐", defaultWidth: 8, defaultHeight: 8, colorClass: "bg-red-100 border-red-400 text-red-800" },
  { type: "ringe", name: "Ringe / Schaukelringe", category: "grossgeraete", icon: "⭕", defaultWidth: 8, defaultHeight: 8, colorClass: "bg-purple-200 border-purple-500 text-purple-900" },
  { type: "pauschenpferd", name: "Pauschenpferd", category: "grossgeraete", icon: "🐴", defaultWidth: 14, defaultHeight: 6, colorClass: "bg-yellow-200 border-yellow-600 text-yellow-950" },

  // 3. Sprunggeräte
  { type: "sprungbrett", name: "Sprungbrett (Reuther)", category: "sprung", icon: "🚀", defaultWidth: 8, defaultHeight: 6, colorClass: "bg-amber-300 border-amber-600 text-amber-950" },
  { type: "minitrampolin", name: "Minitrampolin", category: "sprung", icon: "🎯", defaultWidth: 10, defaultHeight: 10, colorClass: "bg-orange-200 border-orange-500 text-orange-900" },
  { type: "doppel_minitramp", name: "Doppel-Minitramp", category: "sprung", icon: "🎯", defaultWidth: 16, defaultHeight: 10, colorClass: "bg-orange-300 border-orange-600 text-orange-950" },
  { type: "trampolin", name: "Großes Trampolin", category: "sprung", icon: "🎪", defaultWidth: 22, defaultHeight: 14, colorClass: "bg-indigo-200 border-indigo-500 text-indigo-900" },

  // 4. Kästen, Bänke & Tau
  { type: "kasten_5", name: "Kasten 5-teilig", category: "hilfsmittel", icon: "🧱", defaultWidth: 12, defaultHeight: 8, colorClass: "bg-yellow-200 border-yellow-600 text-yellow-950" },
  { type: "kasten_3", name: "Kasten 3-teilig", category: "hilfsmittel", icon: "🧱", defaultWidth: 10, defaultHeight: 7, colorClass: "bg-yellow-100 border-yellow-500 text-yellow-900" },
  { type: "kasten_1", name: "Kasten 1-teilig", category: "hilfsmittel", icon: "📦", defaultWidth: 8, defaultHeight: 6, colorClass: "bg-yellow-100 border-yellow-400 text-yellow-900" },
  { type: "turnbank", name: "Turnbank / Schwedenbank", category: "hilfsmittel", icon: "🪑", defaultWidth: 20, defaultHeight: 4, colorClass: "bg-amber-100 border-amber-400 text-amber-800" },
  { type: "sprossenwand", name: "Sprossenwand", category: "hilfsmittel", icon: "🪜", defaultWidth: 14, defaultHeight: 3, colorClass: "bg-stone-200 border-stone-500 text-stone-900" },
  { type: "tau", name: "Klettertau / Kletterstange", category: "hilfsmittel", icon: "🪢", defaultWidth: 6, defaultHeight: 6, colorClass: "bg-stone-300 border-stone-600 text-stone-900" },

  // 5. Kleingeräte & Parcours
  { type: "pezziball", name: "Pezziball / Gymnastikball", category: "kleingeraete", icon: "⚪", defaultWidth: 6, defaultHeight: 6, colorClass: "bg-pink-200 border-pink-500 text-pink-900" },
  { type: "medizinball", name: "Medizinball", category: "kleingeraete", icon: "🏀", defaultWidth: 5, defaultHeight: 5, colorClass: "bg-stone-400 border-stone-700 text-white" },
  { type: "pylonen", name: "Hütchen / Pylonen", category: "kleingeraete", icon: "🔺", defaultWidth: 5, defaultHeight: 5, colorClass: "bg-orange-300 border-orange-600 text-orange-950" },
  { type: "springseil", name: "Springseil / Schwungseil", category: "kleingeraete", icon: "➰", defaultWidth: 6, defaultHeight: 4, colorClass: "bg-violet-200 border-violet-500 text-violet-900" },
  { type: "reifen", name: "Reifen / Hula-Hoop", category: "kleingeraete", icon: "⭕", defaultWidth: 6, defaultHeight: 6, colorClass: "bg-lime-200 border-lime-500 text-lime-900" },
  { type: "softbaustein", name: "Soft-Baustein / Bausteine", category: "kleingeraete", icon: "🧸", defaultWidth: 8, defaultHeight: 6, colorClass: "bg-fuchsia-200 border-fuchsia-500 text-fuchsia-900" },
  { type: "balancekissen", name: "Balance-Kissen / Wackelbrett", category: "kleingeraete", icon: "🛹", defaultWidth: 6, defaultHeight: 6, colorClass: "bg-sky-200 border-sky-500 text-sky-900" },
];

function formatDateDisplay(isoDate: string): string {
  if (!isoDate) return "";
  const d = new Date(isoDate);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function Turnplaner() {
  const [plans, setPlans] = useState<TrainingPlan[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editor Zustand
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [planTitle, setPlanTitle] = useState("Neuer Hallenaufbau");
  const [planDescription, setPlanDescription] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [placedItems, setPlacedItems] = useState<PlacedEquipment[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [generalNotes, setGeneralNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [printMode, setPrintMode] = useState(false);

  // Palette Zustand
  const [activePaletteCategory, setActivePaletteCategory] = useState<EquipmentTemplate["category"]>("matten");
  const [customItemName, setCustomItemName] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [plansData, groupsData] = await Promise.all([
        api.get<TrainingPlan[]>("/api/training-plans"),
        api.get<Group[]>("/api/groups").catch(() => []),
      ]);
      setPlans(plansData);
      setGroups(groupsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Laden der Aufbauten");
    } finally {
      setLoading(false);
    }
  }

  function startNewPlan() {
    setActivePlanId(null);
    setPlanTitle("Neuer Hallenaufbau");
    setPlanDescription("");
    setSelectedGroupId("");
    setPlacedItems([
      { id: crypto.randomUUID(), type: "schwebebalken", label: "Station 1: Balken", x: 25, y: 35, rotation: 0 },
      { id: crypto.randomUUID(), type: "weichboden", label: "Landematte", x: 25, y: 55, rotation: 0 },
      { id: crypto.randomUUID(), type: "sprungbrett", label: "Sprungbrett", x: 12, y: 35, rotation: 0 },
    ]);
    setSelectedItemId(null);
    setGeneralNotes("");
    setSaveSuccess(false);
  }

  function loadPlanIntoEditor(plan: TrainingPlan) {
    setActivePlanId(plan.id);
    setPlanTitle(plan.title);
    setPlanDescription(plan.description ?? "");
    setSelectedGroupId(plan.groupId ?? "");
    setPlacedItems(plan.canvasData?.equipment ?? []);
    setGeneralNotes(plan.canvasData?.generalNotes ?? "");
    setSelectedItemId(null);
    setSaveSuccess(false);
  }

  function addEquipmentToCanvas(template: EquipmentTemplate) {
    const newItem: PlacedEquipment = {
      id: crypto.randomUUID(),
      type: template.type,
      label: template.name,
      x: 45,
      y: 45,
      rotation: 0,
    };
    setPlacedItems((prev) => [...prev, newItem]);
    setSelectedItemId(newItem.id);
  }

  function addCustomEquipment(name: string) {
    const newItem: PlacedEquipment = {
      id: crypto.randomUUID(),
      type: "custom",
      label: name,
      x: 45,
      y: 45,
      rotation: 0,
    };
    setPlacedItems((prev) => [...prev, newItem]);
    setSelectedItemId(newItem.id);
  }

  function updateSelectedItem(updates: Partial<PlacedEquipment>) {
    if (!selectedItemId) return;
    setPlacedItems((prev) =>
      prev.map((item) => (item.id === selectedItemId ? { ...item, ...updates } : item))
    );
  }

  function removeSelectedItem() {
    if (!selectedItemId) return;
    setPlacedItems((prev) => prev.filter((item) => item.id !== selectedItemId));
    setSelectedItemId(null);
  }

  async function handleSavePlan() {
    if (!planTitle.trim()) {
      alert("Bitte einen Titel für den Hallenaufbau eingeben.");
      return;
    }

    setSaving(true);
    setSaveSuccess(false);
    try {
      const payload = {
        title: planTitle,
        description: planDescription,
        groupId: selectedGroupId || null,
        canvasData: {
          equipment: placedItems,
          generalNotes,
        },
      };

      if (activePlanId) {
        await api.put(`/api/training-plans/${activePlanId}`, payload);
      } else {
        const created = await api.post<TrainingPlan>("/api/training-plans", payload);
        setActivePlanId(created.id);
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Fehler beim Speichern des Hallenaufbaus");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePlan(id: string, title: string) {
    if (!window.confirm(`Hallenaufbau "${title}" wirklich löschen?`)) return;
    try {
      await api.del(`/api/training-plans/${id}`);
      if (activePlanId === id) startNewPlan();
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Fehler beim Löschen");
    }
  }

  const selectedItem = placedItems.find((item) => item.id === selectedItemId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Turnplaner & Hallen-Aufbauplaner</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Erstelle visuelle Skizzen für den Hallenaufbau deiner Turnstunden, ordne Geräte auf der Hallenfläche an, beschrifte Stationen und drucke die Skizze für die Halle aus.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={startNewPlan}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            + Neuer Hallenaufbau
          </button>
          <button
            onClick={() => setPrintMode(true)}
            className="rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 shadow-sm"
          >
            🖨️ Druckansicht
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">Fehler: {error}</p>}

      {/* Main Grid Layout: Canvas & Controls */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left 2 Cols: Interactive Canvas & Palette */}
        <div className="lg:col-span-2 space-y-4">
          {/* Plan Settings Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex-1 space-y-2 min-w-[240px]">
              <input
                type="text"
                value={planTitle}
                onChange={(e) => setPlanTitle(e.target.value)}
                placeholder="Titel des Hallenaufbaus (z. B. Parcours Sprung & Balken)"
                className="w-full rounded border border-slate-300 px-3 py-1 text-sm font-bold dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={selectedGroupId}
                  onChange={(e) => setSelectedGroupId(e.target.value)}
                  className="rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="">-- Gruppe auswählen (optional) --</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={planDescription}
                  onChange={(e) => setPlanDescription(e.target.value)}
                  placeholder="Kurze Beschreibung / Ziel..."
                  className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              {saveSuccess && <span className="text-xs font-semibold text-emerald-600">Gespeichert! ✅</span>}
              <button
                onClick={handleSavePlan}
                disabled={saving}
                className="rounded bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? "Speichert…" : "Aufbau speichern"}
              </button>
            </div>
          </div>

          {/* 2D Gymnasium Hall Canvas */}
          <div className="relative w-full rounded-lg border-2 border-dashed border-slate-300 bg-amber-50/40 p-4 shadow-inner dark:border-slate-700 dark:bg-slate-950 min-h-[380px] overflow-hidden select-none">
            {/* Hall Grid lines */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]" />

            {/* Hall Labels */}
            <div className="absolute top-2 left-3 text-[0.65rem] font-bold text-slate-400 dark:text-slate-600 uppercase tracking-widest">
              🏋️‍♂️ Turnhalle · Geräte-Aufbaufläche
            </div>
            <div className="absolute bottom-2 right-3 text-[0.65rem] text-slate-400 dark:text-slate-600 italic">
              Klicke auf Geräte auf der Fläche, um sie zu drehen oder zu verschieben.
            </div>

            {/* Placed Items on Canvas */}
            {placedItems.map((item) => {
              const tmpl = EQUIPMENT_TEMPLATES.find((t) => t.type === item.type);
              const isSelected = item.id === selectedItemId;
              const width = tmpl?.defaultWidth ?? 12;
              const height = tmpl?.defaultHeight ?? 8;
              const colorClass = tmpl?.colorClass ?? "bg-slate-200 border-slate-500 text-slate-900";

              return (
                <div
                  key={item.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedItemId(item.id);
                  }}
                  style={{
                    left: `${item.x}%`,
                    top: `${item.y}%`,
                    width: `${width}%`,
                    height: `${height}%`,
                    transform: `rotate(${item.rotation}deg)`,
                  }}
                  className={`absolute flex cursor-pointer flex-col items-center justify-center rounded border-2 p-1 text-center shadow-sm transition-all ${colorClass} ${
                    isSelected ? "ring-4 ring-emerald-500 ring-offset-1 z-20 scale-105" : "hover:z-10 hover:opacity-90"
                  }`}
                >
                  <span className="text-xs font-bold leading-tight">
                    {tmpl?.icon} {item.label || tmpl?.name}
                  </span>
                  {item.notes && <span className="text-[0.6rem] opacity-75 truncate max-w-full">ℹ️ {item.notes}</span>}
                </div>
              );
            })}
          </div>

          {/* Equipment Palette with Category Tabs */}
          <div className="rounded-lg border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                ➕ Gerät / Material zur Hallenfläche hinzufügen:
              </h4>
            </div>

            {/* Category Tabs */}
            <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 pb-2 dark:border-slate-800">
              {(Object.keys(CATEGORY_TAB_LABELS) as EquipmentTemplate["category"][]).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActivePaletteCategory(cat)}
                  className={`rounded px-2.5 py-1 text-xs font-semibold ${
                    activePaletteCategory === cat
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                  }`}
                >
                  {CATEGORY_TAB_LABELS[cat]}
                </button>
              ))}
            </div>

            {/* Template Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              {EQUIPMENT_TEMPLATES.filter((t) => t.category === activePaletteCategory).map((tmpl) => (
                <button
                  key={tmpl.type}
                  onClick={() => addEquipmentToCanvas(tmpl)}
                  className="flex items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-emerald-400 hover:bg-emerald-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-emerald-600 dark:hover:bg-emerald-950/40"
                >
                  <span>{tmpl.icon}</span>
                  <span>{tmpl.name}</span>
                </button>
              ))}
            </div>

            {/* Custom Item Creator */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2">
              <input
                type="text"
                placeholder="Eigenes Gerät / Material eingeben (z. B. Slackline, Tumble-Track)..."
                value={customItemName}
                onChange={(e) => setCustomItemName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && customItemName.trim()) {
                    addCustomEquipment(customItemName);
                    setCustomItemName("");
                  }
                }}
                className="flex-1 rounded border border-slate-300 px-2.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
              <button
                disabled={!customItemName.trim()}
                onClick={() => {
                  if (customItemName.trim()) {
                    addCustomEquipment(customItemName);
                    setCustomItemName("");
                  }
                }}
                className="rounded bg-slate-800 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-50 dark:bg-slate-700 dark:hover:bg-slate-600"
              >
                + Hinzufügen
              </button>
            </div>
          </div>
        </div>

        {/* Right Col: Controls for Selected Item & Saved Plans */}
        <div className="space-y-4">
          {/* Selected Item Controls */}
          {selectedItem ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 shadow-sm dark:border-emerald-900 dark:bg-emerald-950/40 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-900 dark:text-emerald-300">
                  ⚙️ Ausgewähltes Gerät bearbeiten
                </h4>
                <button
                  onClick={removeSelectedItem}
                  className="text-xs font-semibold text-red-600 hover:underline dark:text-red-400"
                >
                  🗑️ Entfernen
                </button>
              </div>

              <div>
                <label className="block text-[0.7rem] font-medium text-slate-700 dark:text-slate-300">
                  Beschriftung / Station
                </label>
                <input
                  type="text"
                  value={selectedItem.label}
                  onChange={(e) => updateSelectedItem({ label: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[0.7rem] font-medium text-slate-700 dark:text-slate-300">
                    Position X ({selectedItem.x}%)
                  </label>
                  <input
                    type="range"
                    min={5}
                    max={80}
                    value={selectedItem.x}
                    onChange={(e) => updateSelectedItem({ x: parseInt(e.target.value) })}
                    className="w-full accent-emerald-600"
                  />
                </div>
                <div>
                  <label className="block text-[0.7rem] font-medium text-slate-700 dark:text-slate-300">
                    Position Y ({selectedItem.y}%)
                  </label>
                  <input
                    type="range"
                    min={5}
                    max={80}
                    value={selectedItem.y}
                    onChange={(e) => updateSelectedItem({ y: parseInt(e.target.value) })}
                    className="w-full accent-emerald-600"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Drehung: {selectedItem.rotation}°</span>
                <button
                  onClick={() => updateSelectedItem({ rotation: (selectedItem.rotation + 90) % 360 })}
                  className="rounded bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 border border-slate-300 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
                >
                  🔄 Um 90° drehen
                </button>
              </div>

              <div>
                <label className="block text-[0.7rem] font-medium text-slate-700 dark:text-slate-300">
                  Notiz / Sicherheitshinweis
                </label>
                <input
                  type="text"
                  placeholder="z. B. Hilfestellung durch 2 Trainer"
                  value={selectedItem.notes ?? ""}
                  onChange={(e) => updateSelectedItem({ notes: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white p-4 text-center text-xs text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              Klicke auf ein Gerät auf der Hallenfläche, um Position, Drehung und Notizen zu bearbeiten.
            </div>
          )}

          {/* Allgemeine Notizen */}
          <div className="rounded-lg border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
              📝 Gesamte Hallennotizen / Trainingsablauf:
            </label>
            <textarea
              rows={3}
              placeholder="z. B. 15 Min. Erwärmung im Kreis, danach 3x 15 Min. Stationswechsel..."
              value={generalNotes}
              onChange={(e) => setGeneralNotes(e.target.value)}
              className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          {/* Gespeicherte Aufbauten */}
          <div className="rounded-lg border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h4 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              📂 Gespeicherte Hallenaufbauten ({plans.length})
            </h4>

            {loading ? (
              <p className="text-xs text-slate-400">Lädt Aufbauten…</p>
            ) : plans.length === 0 ? (
              <p className="text-xs text-slate-400 italic">Noch keine Hallenaufbauten gespeichert.</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {plans.map((p) => (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between rounded border p-2 text-xs ${
                      activePlanId === p.id
                        ? "border-emerald-500 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40"
                        : "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60"
                    }`}
                  >
                    <div>
                      <p className="font-bold text-slate-900 dark:text-slate-100">{p.title}</p>
                      <p className="text-[0.65rem] text-slate-400 dark:text-slate-500">
                        {p.groupName ? `Gruppe: ${p.groupName} · ` : ""}
                        {p.canvasData?.equipment?.length ?? 0} Geräte · {formatDateDisplay(p.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => loadPlanIntoEditor(p)}
                        className="rounded bg-white px-2 py-0.5 text-xs font-medium text-slate-700 border hover:bg-slate-100 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-200"
                      >
                        Laden
                      </button>
                      <button
                        onClick={() => handleDeletePlan(p.id, p.title)}
                        className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal: Druckansicht */}
      {printMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4 overflow-y-auto">
          <div className="w-full max-w-3xl rounded-lg bg-white p-6 shadow-2xl text-slate-900">
            <div className="flex items-center justify-between border-b pb-3 mb-4">
              <div>
                <h3 className="text-xl font-bold">{planTitle}</h3>
                <p className="text-xs text-slate-500">
                  Turnhalle Aufbauplan {selectedGroupId ? `· Gruppe: ${groups.find((g) => g.id === selectedGroupId)?.name}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  🖨️ Jetzt drucken
                </button>
                <button
                  onClick={() => setPrintMode(false)}
                  className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Schließen
                </button>
              </div>
            </div>

            {/* Print Canvas */}
            <div className="relative w-full h-[360px] border-2 border-slate-800 bg-amber-50/20 p-4 mb-4 rounded">
              <div className="absolute top-2 left-3 text-[0.65rem] font-bold uppercase tracking-widest text-slate-400">
                Turnhalle · Hallenaufbau Skizze
              </div>
              {placedItems.map((item) => {
                const tmpl = EQUIPMENT_TEMPLATES.find((t) => t.type === item.type);
                const width = tmpl?.defaultWidth ?? 12;
                const height = tmpl?.defaultHeight ?? 8;
                return (
                  <div
                    key={item.id}
                    style={{
                      left: `${item.x}%`,
                      top: `${item.y}%`,
                      width: `${width}%`,
                      height: `${height}%`,
                      transform: `rotate(${item.rotation}deg)`,
                    }}
                    className="absolute flex flex-col items-center justify-center border-2 border-slate-800 bg-white p-1 text-center font-bold text-xs"
                  >
                    <span>{tmpl?.icon} {item.label || tmpl?.name}</span>
                    {item.notes && <span className="text-[0.65rem] font-normal text-slate-600">ℹ️ {item.notes}</span>}
                  </div>
                );
              })}
            </div>

            {/* Print Legend & Notes */}
            {generalNotes && (
              <div className="rounded border bg-slate-50 p-3 text-xs">
                <p className="font-bold mb-1">📝 Ablauf- & Sicherheitshinweise:</p>
                <p className="whitespace-pre-wrap text-slate-700">{generalNotes}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
