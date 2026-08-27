import { useEffect, useState } from "react";
import QRCode from "qrcode";

// Rendert einen QR-Code als Data-URI-Bild - rein clientseitig (qrcode-Paket,
// kein Server-Roundtrip, das otpauth://-Secret verlässt damit nie den
// Browser zusätzlich). Für MFA-Einrichtung: Scannen statt Schlüssel
// abtippen, das manuelle Eingabefeld bleibt daneben als Fallback bestehen.
export function QrCode({ value, size = 200 }: { value: string; size?: number }) {
  const [dataUri, setDataUri] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { width: size, margin: 1 })
      .then((uri) => {
        if (!cancelled) setDataUri(uri);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (error) return null;
  if (!dataUri) {
    return <div className="mx-auto h-[200px] w-[200px] animate-pulse rounded-md bg-slate-100 dark:bg-slate-800" />;
  }
  return (
    <img
      src={dataUri}
      alt="QR-Code zur Einrichtung der Authenticator-App"
      width={size}
      height={size}
      className="mx-auto rounded-md border border-slate-200 dark:border-slate-700"
    />
  );
}
