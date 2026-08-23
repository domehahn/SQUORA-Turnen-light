interface SquoraBrandProps {
  /** "xs": kompakte Kopfzeile. "lg": Login-Screen. */
  size?: "xs" | "lg";
  /** "row": Icon links, Text rechts (Header). "stack": Icon oben, Text zentriert darunter (Login). */
  layout?: "row" | "stack";
  className?: string;
}

// Gemeinsames SQUORA-Branding über die Vereins-Apps hinweg (siehe
// tournament-manager/*/src/components/SquoraBrand.tsx) - Icon + Wortmarke
// mit Farbverlauf, "Turnen" als App-Namenszusatz darunter.
export default function SquoraBrand({ size = "xs", layout = "row", className = "" }: SquoraBrandProps) {
  const logoSrc = `${import.meta.env.BASE_URL}squora-logo.png`;
  const iconSize = size === "lg" ? "h-24 w-24" : "h-9 w-9";
  const wordmarkSize = size === "lg" ? "text-3xl" : "text-lg";

  const textBlock = (
    <div className={layout === "stack" ? "text-center leading-tight" : "leading-tight"}>
      <span
        className={`${wordmarkSize} font-extrabold tracking-tight bg-gradient-to-r from-blue-800 via-blue-600 to-teal-500 bg-clip-text text-transparent`}
      >
        SQUORA
      </span>
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Turnen</p>
    </div>
  );

  if (layout === "stack") {
    return (
      <div className={`flex flex-col items-center gap-2 ${className}`}>
        <img src={logoSrc} alt="Squora" className={`${iconSize} shrink-0 object-contain`} />
        {textBlock}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <img src={logoSrc} alt="Squora" className={`${iconSize} shrink-0 object-contain`} />
      {textBlock}
    </div>
  );
}
