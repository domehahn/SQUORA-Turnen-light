import { type InputHTMLAttributes, type SelectHTMLAttributes, type ReactNode } from "react";

// forceLight: für Druckseiten (Stundennachweis, Anwesenheitsliste), die
// unabhängig vom App-Darkmode immer hell bleiben müssen (amtliches
// Formular-Layout) - lässt alle dark:-Klassen weg statt sie vom Browser
// ignorieren zu lassen, damit z.B. dark:[color-scheme:dark] nicht versehentlich
// die native Datumsauswahl im Druck verdunkelt.
type FloatingInputProps = InputHTMLAttributes<HTMLInputElement> & { label: string; forceLight?: boolean };

export function FloatingInput({ label, id, forceLight, ...props }: FloatingInputProps) {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div>
      <label
        htmlFor={inputId}
        className={`mb-1 block text-xs font-medium text-slate-600 ${forceLight ? "" : "dark:text-slate-400"}`}
      >
        {label}
      </label>
      <input
        id={inputId}
        className={`w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 ${
          forceLight ? "" : "dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
        }`}
        {...props}
      />
    </div>
  );
}

type FloatingSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  children: ReactNode;
  forceLight?: boolean;
};

export function FloatingSelect({ label, id, children, forceLight, ...props }: FloatingSelectProps) {
  const selectId = id ?? label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div>
      <label
        htmlFor={selectId}
        className={`mb-1 block text-xs font-medium text-slate-600 ${forceLight ? "" : "dark:text-slate-400"}`}
      >
        {label}
      </label>
      <select
        id={selectId}
        className={`w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 ${
          forceLight ? "" : "dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        }`}
        {...props}
      >
        {children}
      </select>
    </div>
  );
}
