import { useLayoutEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

// Rendert sein Kind per Portal direkt in <body>, losgelöst vom Header (der
// via backdrop-blur einen eigenen Stacking-Context aufmacht und dadurch je
// nach Seite von anderem Seiteninhalt überdeckt werden kann). Position wird
// aus der Bounding-Box des Auslösers berechnet, damit das Popup optisch wie
// gewohnt darunter erscheint.
export function DropdownPortal({
  anchorRef,
  open,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    function update() {
      const rect = anchorRef.current!.getBoundingClientRect();
      setPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchorRef]);

  if (!open || !pos) return null;
  return createPortal(
    <div className="fixed z-[100]" style={{ top: pos.top, right: pos.right }}>
      {children}
    </div>,
    document.body
  );
}
