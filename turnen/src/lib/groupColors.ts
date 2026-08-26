// Feste Palette statt Freitext (Hex etc.) - Schlüssel müssen mit
// GROUP_COLOR_KEYS im Worker (worker/src/validation.ts) übereinstimmen.
export interface GroupColorOption {
  key: string;
  label: string;
  swatch: string; // kleine Kreis-Vorschau im Picker
  classes: string; // Kalender-Karte (Hintergrund/Text/Rand, hell+dunkel)
}

export const GROUP_COLORS: GroupColorOption[] = [
  {
    key: "emerald",
    label: "Grün",
    swatch: "bg-emerald-500",
    classes: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-800",
  },
  {
    key: "blue",
    label: "Blau",
    swatch: "bg-blue-500",
    classes: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-800",
  },
  {
    key: "purple",
    label: "Violett",
    swatch: "bg-purple-500",
    classes: "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/40 dark:text-purple-200 dark:border-purple-800",
  },
  {
    key: "amber",
    label: "Gelb",
    swatch: "bg-amber-500",
    classes: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-800",
  },
  {
    key: "pink",
    label: "Pink",
    swatch: "bg-pink-500",
    classes: "bg-pink-100 text-pink-800 border-pink-300 dark:bg-pink-900/40 dark:text-pink-200 dark:border-pink-800",
  },
  {
    key: "teal",
    label: "Türkis",
    swatch: "bg-teal-500",
    classes: "bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-900/40 dark:text-teal-200 dark:border-teal-800",
  },
  {
    key: "orange",
    label: "Orange",
    swatch: "bg-orange-500",
    classes: "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/40 dark:text-orange-200 dark:border-orange-800",
  },
  {
    key: "red",
    label: "Rot",
    swatch: "bg-red-500",
    classes: "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-200 dark:border-red-800",
  },
  {
    key: "cyan",
    label: "Cyan",
    swatch: "bg-cyan-500",
    classes: "bg-cyan-100 text-cyan-800 border-cyan-300 dark:bg-cyan-900/40 dark:text-cyan-200 dark:border-cyan-800",
  },
  {
    key: "slate",
    label: "Grau",
    swatch: "bg-slate-500",
    classes: "bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800/60 dark:text-slate-200 dark:border-slate-700",
  },
];

const BY_KEY = new Map(GROUP_COLORS.map((c) => [c.key, c]));

// Ohne gewählte Farbe: fester, aber pro Gruppe stabiler Hash auf die ID -
// bisheriges Verhalten als Fallback für Gruppen ohne Farbwahl.
function hashColorFor(groupId: string): GroupColorOption {
  let hash = 0;
  for (let i = 0; i < groupId.length; i++) hash = (hash * 31 + groupId.charCodeAt(i)) % GROUP_COLORS.length;
  return GROUP_COLORS[hash];
}

export function groupColorClasses(color: string | null, groupId: string): string {
  return (color ? BY_KEY.get(color) : undefined)?.classes ?? hashColorFor(groupId).classes;
}
