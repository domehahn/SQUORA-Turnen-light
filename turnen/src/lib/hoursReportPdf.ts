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

// Erzeugt das PDF des Stundennachweises (inkl. digitaler Unterschrift) für den
// Upload nach R2. Bewusst mit jsPDF-Primitiven statt DOM-Rasterung – dadurch
// unabhängig von Tailwind-v4-Farben (oklch), klein und mit echtem Text.
export function buildHoursReportPdf(
  report: HoursReport,
  meta: HoursReportPdfMeta,
  signatureDataUrl: string | null
): Blob {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 15;
  let y = 18;

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
  y += 10;

  if (signatureDataUrl) {
    try {
      doc.addImage(signatureDataUrl, "PNG", marginX, y, 60, 20);
    } catch {
      /* ungültiges Bild ignorieren */
    }
  }
  y += 22;
  doc.setDrawColor(120);
  doc.line(marginX, y, marginX + 70, y);
  doc.line(pageWidth - marginX - 70, y, pageWidth - marginX, y);
  y += 4;
  doc.setTextColor(90);
  doc.setFontSize(8);
  doc.text(`${report.userName ?? ""}`, marginX, y);
  doc.text("Unterschrift Übungsleiter", marginX, y + 4);
  doc.text(`${meta.ort}, ${meta.dateLabel}`, pageWidth - marginX - 70, y);
  doc.text("Ort / Datum", pageWidth - marginX - 70, y + 4);

  return doc.output("blob");
}
