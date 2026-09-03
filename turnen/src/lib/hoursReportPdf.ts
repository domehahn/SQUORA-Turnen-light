import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { HoursReport } from "./types";

export interface HoursReportPdfMeta {
  sport: string;
  licenseNumber: string;
  validUntil: string;
  ort: string;
  /** z.B. "01.09.2026" */
  dateLabel: string;
}

function quarterLabel(quarter: number, year: number): string {
  return quarter === 0 ? `Jahr ${year}` : `${quarter}. Quartal ${year}`;
}

function imageDims(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = dataUrl;
  });
}

// Lädt das SQUORA-Logo aus /public und liefert Data-URL + Originalmaße.
// Schlägt der Ladevorgang fehl (offline o.ä.), wird das PDF ohne Logo erzeugt.
async function loadBrandLogo(): Promise<{ dataUrl: string; width: number; height: number } | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}squora-logo.png`);
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    const dims = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
      img.onerror = () => reject(new Error("logo decode failed"));
      img.src = dataUrl;
    });
    return { dataUrl, ...dims };
  } catch {
    return null;
  }
}

// Erzeugt das PDF des Stundennachweises (inkl. digitaler Unterschrift) für den
// Upload nach R2. Bewusst mit jsPDF-Primitiven statt DOM-Rasterung – dadurch
// unabhängig von Tailwind-v4-Farben (oklch), klein und mit echtem Text.
export async function buildHoursReportPdf(
  report: HoursReport,
  meta: HoursReportPdfMeta,
  signatureDataUrl: string | null
): Promise<Blob> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 15;
  let y = 14;

  // --- Kopf mit Logo ----------------------------------------------------
  const logo = await loadBrandLogo();
  if (logo) {
    const logoH = 15;
    const logoW = (logo.width / logo.height) * logoH;
    try {
      doc.addImage(logo.dataUrl, "PNG", marginX, y, logoW, logoH);
    } catch {
      /* Logo überspringen */
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.setTextColor(30, 64, 128);
    doc.text("SQUORA", marginX + logoW + 4, y + 7);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text("Turnen", marginX + logoW + 4, y + 12);
    y += logoH + 6;
  } else {
    y = 18;
  }

  doc.setTextColor(20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Stundennachweis", marginX, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const infoLines = [
    ["Verein", report.clubName ?? "—"],
    ["Vereinsnummer", report.clubNumber ?? "—"],
    ["Name, Vorname", report.userName ?? "—"],
    ["Zeitraum", quarterLabel(report.quarter, report.year)],
    ["Sportart", meta.sport || "—"],
    ["Lizenz-Nr.", meta.licenseNumber || "—"],
    ["Gültig bis", meta.validUntil || "—"],
  ];
  for (const [label, value] of infoLines) {
    doc.setTextColor(120);
    doc.text(`${label}:`, marginX, y);
    doc.setTextColor(20);
    doc.text(String(value), marginX + 38, y);
    y += 5.5;
  }
  y += 3;

  // --- Zahlungsnachweis des Vereins: Stunden je Monat -----------------------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Zahlungsnachweis des Vereins", marginX, y);
  y += 3;

  const totalHours = Math.round(report.months.reduce((sum, m) => sum + m.totalHours, 0) * 100) / 100;
  autoTable(doc, {
    startY: y,
    head: [["Für Monat", "Zahl der Stunden"]],
    body: report.months.map((m) => [`${m.monthName} ${report.year}`, m.totalHours ? String(m.totalHours) : "—"]),
    foot: [["Summe", String(totalHours)]],
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 1.5 },
    headStyles: { fillColor: [219, 234, 254], textColor: [30, 58, 138] },
    footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: "bold" },
    margin: { left: marginX, right: marginX },
  });
  // @ts-expect-error lastAutoTable wird von jspdf-autotable ergänzt
  y = doc.lastAutoTable.finalY + 10;

  // --- Stundennachweis des Übungsleiters: Termine je Monat -----------------
  for (const month of report.months) {
    if (y > 245) {
      doc.addPage();
      y = 18;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`Monat ${month.monthName} ${report.year}`, marginX, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      head: [["Datum", "Uhrzeit von–bis", "Std.", "Einsatzort"]],
      body:
        month.sessions.length > 0
          ? month.sessions.map((s) => [
              s.date,
              s.startTime && s.endTime ? `${s.startTime}–${s.endTime}` : "—",
              s.hours != null ? String(s.hours) : "—",
              s.location,
            ])
          : [["—", "—", "—", "keine Termine"]],
      foot: [["", "", String(month.totalHours || 0), ""]],
      theme: "grid",
      styles: { fontSize: 8.5, cellPadding: 1.3 },
      headStyles: { fillColor: [219, 234, 254], textColor: [30, 58, 138] },
      footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: "bold" },
      columnStyles: { 0: { cellWidth: 26 }, 1: { cellWidth: 34 }, 2: { cellWidth: 16 } },
      margin: { left: marginX, right: marginX },
    });
    // @ts-expect-error lastAutoTable wird von jspdf-autotable ergänzt
    y = doc.lastAutoTable.finalY + 8;
  }

  // --- Unterschrift ------------------------------------------------------
  if (y > 235) {
    doc.addPage();
    y = 18;
  }
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(60);
  doc.text(
    "Die aufgeführten Stunden habe ich selbst geleistet und die oben eingetragenen Beträge erhalten.",
    marginX,
    y
  );
  // Eintrag jeweils ÜBER dem Strich, Label darunter (wie auf einem Papierformular).
  const lineW = 70;
  const rightLineX = pageWidth - marginX - lineW;
  const lineY = y + 24;

  if (signatureDataUrl) {
    try {
      // Seitenverhältnis erhalten - eine hochgeladene Unterschrift kann jedes
      // Format haben, das gezeichnete Feld ist 3:1.
      const maxW = 55;
      const maxH = 20;
      let drawW = maxW;
      let drawH = maxH;
      try {
        const dims = await imageDims(signatureDataUrl);
        const s = Math.min(maxW / dims.width, maxH / dims.height);
        drawW = dims.width * s;
        drawH = dims.height * s;
      } catch {
        /* Maße nicht ermittelbar -> Standardbox */
      }
      doc.addImage(signatureDataUrl, "PNG", marginX, lineY - 2 - drawH, drawW, drawH);
    } catch {
      /* ungültiges Bild ignorieren */
    }
  }
  doc.setTextColor(20);
  doc.setFontSize(9);
  doc.text(`${meta.ort}, ${meta.dateLabel}`, rightLineX, lineY - 2);

  doc.setDrawColor(120);
  doc.line(marginX, lineY, marginX + lineW, lineY);
  doc.line(rightLineX, lineY, rightLineX + lineW, lineY);

  doc.setTextColor(90);
  doc.setFontSize(8);
  doc.text("Unterschrift Übungsleiter", marginX, lineY + 4);
  doc.text("Ort / Datum", rightLineX, lineY + 4);

  return doc.output("blob");
}
