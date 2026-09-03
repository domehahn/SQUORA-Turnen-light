import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface SignaturePadHandle {
  /** PNG-Data-URL der Unterschrift, oder null wenn nichts gezeichnet wurde. */
  getDataUrl: () => string | null;
  clear: () => void;
  isEmpty: () => boolean;
}

interface Props {
  width?: number;
  height?: number;
  /** Wird nach jedem Strich aufgerufen (z.B. um „leer?“ im Elternteil zu tracken). */
  onChange?: (isEmpty: boolean) => void;
  disabled?: boolean;
}

// Freihand-Unterschrift per Maus/Trackpad/Touch (Pointer Events decken alle
// Eingabearten ab). Zeichnet auf ein hochauflösendes Canvas (devicePixelRatio),
// exportiert als PNG-Data-URL. Bewusst ohne externe Bibliothek.
export const SignaturePad = forwardRef<SignaturePadHandle, Props>(function SignaturePad(
  { width = 480, height = 160, onChange, disabled = false },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const dirty = useRef(false);
  const [empty, setEmpty] = useState(true);

  const ctx = useCallback(() => {
    const canvas = canvasRef.current;
    return canvas ? canvas.getContext("2d") : null;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.lineWidth = 2;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#0f172a";
  }, [width, height]);

  function pointerPos(e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * width,
      y: ((e.clientY - rect.top) / rect.height) * height,
    };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = pointerPos(e);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || disabled) return;
    const context = ctx();
    const pos = pointerPos(e);
    if (!context || !last.current) return;
    context.beginPath();
    context.moveTo(last.current.x, last.current.y);
    context.lineTo(pos.x, pos.y);
    context.stroke();
    last.current = pos;
    if (!dirty.current) {
      dirty.current = true;
      setEmpty(false);
      onChange?.(false);
    }
  }

  function end(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = false;
    last.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* Pointer schon freigegeben */
    }
  }

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    const context = ctx();
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    dirty.current = false;
    setEmpty(true);
    onChange?.(true);
  }, [ctx, onChange]);

  useImperativeHandle(
    ref,
    () => ({
      getDataUrl: () => (dirty.current && canvasRef.current ? canvasRef.current.toDataURL("image/png") : null),
      clear,
      isEmpty: () => !dirty.current,
    }),
    [clear]
  );

  return (
    <div className="inline-block">
      <canvas
        ref={canvasRef}
        style={{ width, height, touchAction: "none" }}
        className={`rounded-md border border-slate-400 bg-white ${disabled ? "opacity-50" : "cursor-crosshair"}`}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
      />
      <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
        <span>Mit Maus, Trackpad oder Finger unterschreiben</span>
        <button
          type="button"
          onClick={clear}
          disabled={disabled || empty}
          className="rounded px-2 py-0.5 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800"
        >
          Löschen
        </button>
      </div>
    </div>
  );
});
