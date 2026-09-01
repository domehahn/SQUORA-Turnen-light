// Liest ein hochgeladenes Unterschriftsbild ein, verkleinert es auf eine
// PDF-taugliche Größe und liefert eine PNG-Data-URL. Damit lässt sich eine
// bereits vorhandene digitale Unterschrift statt des Zeichenfelds verwenden.
export async function fileToSignatureDataUrl(file: File, maxW = 700, maxH = 240): Promise<string> {
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Datei konnte nicht gelesen werden"));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Bild konnte nicht geladen werden"));
    image.src = src;
  });

  const scale = Math.min(1, maxW / (img.naturalWidth || 1), maxH / (img.naturalHeight || 1));
  const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
  const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return src;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/png");
}
