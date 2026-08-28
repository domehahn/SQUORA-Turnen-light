import type { ReactNode } from "react";

interface EquipmentIconProps {
  type: string;
  className?: string;
}

function stackedBox(levels: number): ReactNode {
  return Array.from({ length: levels }, (_, index) => {
    const y = 48 - index * 8;
    const inset = Math.min(index * 2, 6);
    return <rect key={y} x={12 + inset} y={y} width={40 - inset * 2} height="7" rx="2" />;
  });
}

function artwork(type: string): ReactNode {
  switch (type) {
    case "weichboden":
      return <><rect x="7" y="17" width="50" height="32" rx="7" /><path d="M10 40h44M18 18v30M46 18v30" /></>;
    case "niedermatte":
      return <><rect x="8" y="23" width="48" height="24" rx="5" /><path d="M11 39h42M24 24v22" /></>;
    case "turnmatte":
      return <><rect x="7" y="27" width="50" height="18" rx="4" /><path d="M12 36h40M32 28v16" /></>;
    case "airtrack":
      return <><rect x="4" y="23" width="56" height="23" rx="11" /><path d="M14 25v19M23 24v21M32 24v21M41 24v21M50 25v19" /></>;
    case "keilmatte":
      return <><path d="M8 47h49L15 20a5 5 0 0 0-7 4v23Z" /><path d="m17 26 30 21" /></>;
    case "schwebebalken":
      return <><rect x="5" y="24" width="54" height="8" rx="3" /><path d="M16 32v18M48 32v18M10 50h12M42 50h12" /></>;
    case "methodikbalken":
      return <><rect x="6" y="30" width="52" height="8" rx="3" /><path d="m15 38-4 11M49 38l4 11M7 49h12M45 49h12" /></>;
    case "reck":
      return <><path d="M10 53V13M54 53V13M10 17h44M5 53h14M45 53h14" /></>;
    case "stufenbarren":
      return <><path d="M13 53V20M47 53V10M9 24h31M28 14h24M7 53h12M41 53h12" /></>;
    case "barren":
      return <><path d="M12 22h38M15 31h38M17 22v30M47 22v30M20 31v21M50 31v21M10 52h13M41 52h13" /></>;
    case "sprungtisch":
      return <><path d="M15 19c7-5 27-5 34 0l-3 11c-8 4-20 4-28 0l-3-11Z" /><path d="M26 33v15h12V33M21 52h22" /></>;
    case "sprungbock":
      return <><path d="M14 22c8-6 28-6 36 0l-3 10H17l-3-10Z" /><path d="m21 32-6 20M43 32l6 20M10 52h10M44 52h10" /></>;
    case "ringe":
      return <><path d="M10 10h44M22 10v20M42 10v20" /><circle cx="22" cy="38" r="8" /><circle cx="42" cy="38" r="8" /></>;
    case "pauschenpferd":
      return <><path d="M10 25c8-6 36-6 44 0l-3 13H13l-3-13Z" /><path d="M25 20v-7h5v7M36 20v-7h5v7M19 38l-4 14M45 38l4 14M10 52h10M44 52h10" /></>;
    case "sprungbrett":
      return <><path d="M8 43c17 0 32-8 45-24l4 5C43 44 27 51 8 51v-8Z" /><path d="m42 35 5 13" /></>;
    case "minitrampolin":
      return <><ellipse cx="32" cy="28" rx="22" ry="13" /><ellipse cx="32" cy="28" rx="15" ry="8" /><path d="m16 38-5 14M48 38l5 14" /></>;
    case "doppel_minitramp":
      return <><path d="m7 32 21-13 10 16-21 13L7 32ZM32 30l19-12 7 18-19 10" /><path d="m17 48-2 6M49 42l4 10" /></>;
    case "trampolin":
      return <><rect x="6" y="16" width="52" height="31" rx="5" /><rect x="13" y="22" width="38" height="19" rx="3" /><path d="M12 47 8 54M52 47l4 7M18 16l3 6M46 16l-3 6" /></>;
    case "kasten_5":
      return <>{stackedBox(5)}<path d="M18 15h28l4 7H14l4-7Z" /></>;
    case "kasten_3":
      return <>{stackedBox(3)}<path d="M18 29h28l4 7H14l4-7Z" /></>;
    case "kasten_1":
      return <><rect x="12" y="31" width="40" height="19" rx="3" /><path d="M18 24h28l4 7H14l4-7Z" /></>;
    case "turnbank":
      return <><path d="M6 27h52v8H6zM17 35l-5 16M47 35l5 16M8 51h11M45 51h11" /></>;
    case "sprossenwand":
      return <><path d="M15 7v50M49 7v50M15 12h34M15 20h34M15 28h34M15 36h34M15 44h34M15 52h34" /></>;
    case "tau":
      return <><path d="M32 7v8c-11 7 10 13 0 20s9 10 0 18" /><path d="m27 53 5 5 5-5M25 8h14" /></>;
    case "pezziball":
      return <><circle cx="32" cy="32" r="23" /><path d="M21 19c4-4 9-6 14-6M19 43c8 5 18 5 26 0" /></>;
    case "medizinball":
      return <><circle cx="32" cy="32" r="22" /><path d="M32 10c-8 8-8 36 0 44M32 10c8 8 8 36 0 44M10 32h44" /></>;
    case "pylonen":
      return <><path d="m27 10-12 39h34L37 10H27Z" /><path d="M22 31h20M9 53h46" /></>;
    case "springseil":
      return <><path d="M13 17c0 39 38 39 38 0M13 17v-7M51 17v-7" /><rect x="9" y="5" width="8" height="12" rx="3" /><rect x="47" y="5" width="8" height="12" rx="3" /></>;
    case "reifen":
      return <><circle cx="32" cy="32" r="24" /><circle cx="32" cy="32" r="18" /></>;
    case "softbaustein":
      return <><rect x="7" y="34" width="23" height="18" rx="3" /><rect x="34" y="30" width="23" height="22" rx="3" /><path d="M13 34V20h18l8 10" /><circle cx="22" cy="27" r="5" /></>;
    case "balancekissen":
      return <><path d="M9 39c5-20 41-20 46 0-8 10-38 10-46 0Z" /><path d="M18 34c8 4 20 4 28 0M25 51h14" /></>;
    default:
      return <><path d="m38 9-7 7 7 7 7-7a11 11 0 0 1-14 14L14 47l-6-6 17-17A11 11 0 0 1 38 9Z" /><circle cx="11" cy="44" r="1" fill="currentColor" /></>;
  }
}

export function EquipmentIcon({ type, className = "size-12" }: EquipmentIconProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {artwork(type)}
    </svg>
  );
}
