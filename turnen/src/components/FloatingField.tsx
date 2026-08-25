import { useState, type FocusEvent, type InputHTMLAttributes, type SelectHTMLAttributes, type ReactNode } from "react";

// Echtes Floating Label: das Label sitzt zunächst wie ein Platzhalter IM
// Feld und wandert beim Fokussieren oder sobald ein Wert vorhanden ist nach
// oben (Material-Design-Stil), statt immer statisch über dem Feld zu stehen.
//
// forceLight: für Druckseiten (Stundennachweis, Anwesenheitsliste), die
// unabhängig vom App-Darkmode immer hell bleiben müssen (amtliches
// Formular-Layout) - lässt alle dark:-Klassen weg.
//
// Bei date/time/month/week/datetime-local-Inputs zeigt der Browser immer
// eigene Platzhalter-Segmente (z.B. "--:--") an, auch wenn value="" ist -
// das Label bliebe sonst mit dem nativen Platzhalter überlappend in der
// Mitte stehen. Diese Typen gelten deshalb immer als "gefüllt".
const ALWAYS_FLOATED_TYPES = new Set(["date", "time", "month", "week", "datetime-local"]);

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value) !== "";
}

// Diskrete Schriftgrößen statt scale-Transform: mit transform würde die
// (unveränderte) Zeilenhöhe der Box weiterhin den vollen Platz beanspruchen
// und optisch mit dem Feldwert kollidieren, obwohl der Text selbst
// geschrumpft aussieht. leading-none hält die Label-Box eng am Glyphen.
const LABEL_BASE = "pointer-events-none absolute left-3 leading-none transition-all duration-150";
const LABEL_FLOATED = "top-1.5 text-[10px]";
const LABEL_RESTING = "top-1/2 -translate-y-1/2 text-sm";

type FloatingInputProps = InputHTMLAttributes<HTMLInputElement> & { label: string; forceLight?: boolean };

export function FloatingInput({ label, id, forceLight, type, value, placeholder, onFocus, onBlur, ...props }: FloatingInputProps) {
  const [focused, setFocused] = useState(false);
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, "-");
  // Ein eigener placeholder zeigt sich im leeren Feld immer selbst an (auch
  // ohne Fokus) - das Label muss dann ebenfalls oben stehen, sonst
  // überlagern sich beide mittig im Feld.
  const floated =
    focused || hasValue(value) || hasValue(placeholder) || (typeof type === "string" && ALWAYS_FLOATED_TYPES.has(type));

  return (
    <div className="relative">
      <input
        id={inputId}
        type={type}
        value={value}
        placeholder={placeholder}
        onFocus={(e: FocusEvent<HTMLInputElement>) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e: FocusEvent<HTMLInputElement>) => {
          setFocused(false);
          onBlur?.(e);
        }}
        className={`peer w-full rounded-md border border-slate-300 px-3 pb-1.5 pt-5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 ${
          forceLight ? "" : "dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
        }`}
        {...props}
      />
      <label
        htmlFor={inputId}
        className={`${LABEL_BASE} ${floated ? LABEL_FLOATED : LABEL_RESTING} ${
          floated
            ? focused
              ? "text-emerald-600 dark:text-emerald-400"
              : `text-slate-500 ${forceLight ? "" : "dark:text-slate-400"}`
            : `text-slate-400 ${forceLight ? "" : "dark:text-slate-500"}`
        }`}
      >
        {label}
      </label>
    </div>
  );
}

type FloatingSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  children: ReactNode;
  forceLight?: boolean;
};

export function FloatingSelect({ label, id, children, forceLight, value, onFocus, onBlur, ...props }: FloatingSelectProps) {
  const [focused, setFocused] = useState(false);
  const selectId = id ?? label.toLowerCase().replace(/\s+/g, "-");
  // Ein <select> zeigt immer den Text der aktuell gewählten Option an (auch
  // bei value="" via Platzhalter-Option wie "–") - anders als bei <input>
  // gibt es also nie einen wirklich leeren Zustand, in dem das Label mittig
  // im Feld stehen könnte, ohne den Options-Text zu überlappen. Das Label
  // bleibt bei Selects deshalb immer oben.
  const floated = true;

  return (
    <div className="relative">
      <select
        id={selectId}
        value={value}
        onFocus={(e: FocusEvent<HTMLSelectElement>) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e: FocusEvent<HTMLSelectElement>) => {
          setFocused(false);
          onBlur?.(e);
        }}
        className={`peer w-full rounded-md border border-slate-300 bg-white px-3 pb-1.5 pt-5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 ${
          forceLight ? "" : "dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        }`}
        {...props}
      >
        {children}
      </select>
      <label
        htmlFor={selectId}
        className={`${LABEL_BASE} ${floated ? LABEL_FLOATED : LABEL_RESTING} ${
          floated
            ? focused
              ? "text-emerald-600 dark:text-emerald-400"
              : `text-slate-500 ${forceLight ? "" : "dark:text-slate-400"}`
            : `text-slate-400 ${forceLight ? "" : "dark:text-slate-500"}`
        }`}
      >
        {label}
      </label>
    </div>
  );
}
