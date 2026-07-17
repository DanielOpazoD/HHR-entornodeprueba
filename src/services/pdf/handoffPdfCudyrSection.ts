import type { jsPDF } from 'jspdf';
import { BEDS } from '@/constants/beds';
import type { HandoffPdfRecord } from '@/services/pdf/contracts/handoffPdfContracts';
import { resolvePresentedNightShiftNurses } from '@/services/staff/dailyRecordStaffing';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { AutoTableFunction, CellHookData, JsPDFWithAutoTable } from './handoffPdfTypes';
import { getCategorization } from '@/services/cudyr/CudyrScoreUtils';
import { buildDailyCudyrSummary } from '@/services/cudyr/cudyrSummary';
import {
  CUDYR_NIGHT_REFERENCE_TIME_LABEL,
  isCudyrPatientEligible,
  resolveCudyrNightApplicationDate,
} from '@/domain/cudyr/cudyrEligibility';
import { importedCudyrBelongsToCensus } from '@/domain/evaluationScales/importedCudyr';
import {
  HANDOFF_PDF_PAGE_LAYOUT,
  getHandoffPdfTableMargin,
  type HandoffPdfPageMargin,
} from './handoffPdfPageLayout';

const renderPdfCudyrScore = (value?: number) =>
  value === undefined || value === null ? '-' : value;

export const addCudyrTable = (
  doc: jsPDF,
  record: HandoffPdfRecord,
  margin: number,
  autoTable: AutoTableFunction,
  pageMargin: HandoffPdfPageMargin = HANDOFF_PDF_PAGE_LAYOUT.margin
) => {
  doc.addPage();
  let currentY = pageMargin.top;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('INSTRUMENTO CUDYR', margin, currentY);
  currentY += 6;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');

  const nursesStr = resolvePresentedNightShiftNurses(record).join(', ');
  const applicationDate = formatDateDDMMYYYY(resolveCudyrNightApplicationDate(record.date));

  doc.text(`Turno ${formatDateDDMMYYYY(record.date)}.`, margin, currentY);
  doc.text(
    ` | Fecha y hora de corte de aplicación: ${applicationDate}, ${CUDYR_NIGHT_REFERENCE_TIME_LABEL}`,
    margin + 28,
    currentY
  );

  currentY += 5;
  doc.text(`Enfermeros/as (Noche): ${nursesStr}`, margin, currentY);
  currentY += 8;

  const summary = buildDailyCudyrSummary({
    date: record.date,
    beds: record.beds,
    activeExtraBeds: [],
  });
  const categorizationIndex =
    summary.occupiedCount > 0
      ? Math.round((summary.categorizedCount / summary.occupiedCount) * 100)
      : 0;
  const summaryCounts = Object.entries(summary.counts.media).reduce(
    (acc, [category, count]) => {
      acc[category] = (acc[category] || 0) + count;
      return acc;
    },
    { ...summary.counts.uti } as Record<string, number>
  );
  const totalCategorized = summary.categorizedCount;

  if (totalCategorized > 0) {
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('Resumen Estadistico:', margin, currentY);
    currentY += 4;

    const headlineSummary =
      `Camas categorizables = ${summary.occupiedCount}  |  ` +
      `Camas categorizadas = ${summary.categorizedCount}  |  ` +
      `Indice categorización = ${categorizationIndex}%`;

    doc.setFont('helvetica', 'normal');
    doc.text(headlineSummary, margin, currentY);
    currentY += 4;

    const summaryText = Object.entries(summaryCounts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([category, count]) => `${category}: ${count}`)
      .join('  |  ');

    doc.text(`${summaryText}  (Total: ${totalCategorized})`, margin, currentY);
    currentY += 6;
  }

  const body: (string | number)[][] = [];

  BEDS.forEach(bedDef => {
    const patient = record.beds[bedDef.id];
    const appendRow = (bedName: string, rowPatient?: typeof patient) => {
      if (!rowPatient?.patientName) return;

      const isEligible = isCudyrPatientEligible(record.date, rowPatient);
      const score = isEligible ? rowPatient.cudyr : undefined;
      const calculated = getCategorization(score);
      const candidateImported = isEligible ? rowPatient.evaluationScores?.cudyr : undefined;
      const normalizedImportedCategory = String(candidateImported?.category || '')
        .trim()
        .toUpperCase();
      const imported =
        importedCudyrBelongsToCensus(candidateImported, record.date) &&
        /^[A-D][1-3]$/.test(normalizedImportedCategory)
          ? { ...candidateImported, category: normalizedImportedCategory }
          : undefined;
      const displayedScore = imported ? undefined : score;
      const depScore = imported ? (imported.dependencyScore ?? '-') : calculated.depScore;
      const riskScore = imported ? (imported.riskScore ?? '-') : calculated.riskScore;
      const finalCat = imported?.category || calculated.finalCat;
      const nameParts = rowPatient.patientName.split(' ');
      const shortNameBase =
        nameParts.length > 1 ? `${nameParts[0]} ${nameParts[1].charAt(0)}.` : nameParts[0];
      const shortName = isEligible ? shortNameBase : `${shortNameBase} (Bloq.)`;

      body.push([
        bedName,
        shortName,
        rowPatient.rut || '-',
        renderPdfCudyrScore(displayedScore?.changeClothes),
        renderPdfCudyrScore(displayedScore?.mobilization),
        renderPdfCudyrScore(displayedScore?.feeding),
        renderPdfCudyrScore(displayedScore?.elimination),
        renderPdfCudyrScore(displayedScore?.psychosocial),
        renderPdfCudyrScore(displayedScore?.surveillance),
        renderPdfCudyrScore(displayedScore?.vitalSigns),
        renderPdfCudyrScore(displayedScore?.fluidBalance),
        renderPdfCudyrScore(displayedScore?.oxygenTherapy),
        renderPdfCudyrScore(displayedScore?.airway),
        renderPdfCudyrScore(displayedScore?.proInterventions),
        renderPdfCudyrScore(displayedScore?.skinCare),
        renderPdfCudyrScore(displayedScore?.pharmacology),
        renderPdfCudyrScore(displayedScore?.invasiveElements),
        isEligible ? depScore : '-',
        isEligible ? riskScore : '-',
        finalCat || '-',
      ]);
    };

    appendRow(bedDef.name, patient);
    appendRow(`${bedDef.name} (CC)`, patient?.clinicalCrib);
  });

  autoTable(doc, {
    startY: currentY,
    head: [
      [
        'Cama',
        'Nombre',
        'RUT',
        'Ropa',
        'Movil',
        'Alim',
        'Elim',
        'Psico',
        'Vigi',
        'S.Vit',
        'Bal',
        'O2',
        'Aere',
        'Intv',
        'Piel',
        'Tto',
        'Inv',
        'T.Dep',
        'T.Ries',
        'Cat',
      ],
    ],
    body,
    theme: 'grid',
    styles: {
      fontSize: 6.5,
      halign: 'center',
      cellPadding: 1,
      lineColor: [100, 100, 100],
      lineWidth: 0.1,
    },
    headStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'bold', lineWidth: 0.1 },
    columnStyles: {
      0: { cellWidth: 10, halign: 'left', fontStyle: 'bold' },
      1: { cellWidth: 22, halign: 'left' },
      2: { cellWidth: 16, halign: 'center' },
      17: { cellWidth: 9, fontStyle: 'bold', fillColor: [240, 248, 255] },
      18: { cellWidth: 9, fontStyle: 'bold', fillColor: [254, 242, 242] },
      19: { cellWidth: 9, fontStyle: 'bold' },
    },
    margin: getHandoffPdfTableMargin(pageMargin),
    didParseCell: (hookData: CellHookData) => {
      if (hookData.section !== 'body' || hookData.column.index !== 19) return;
      const value = hookData.cell.raw as string;
      if (value.startsWith('A')) {
        hookData.cell.styles.fillColor = [220, 38, 38];
        hookData.cell.styles.textColor = 255;
      } else if (value.startsWith('B')) {
        hookData.cell.styles.fillColor = [249, 115, 22];
        hookData.cell.styles.textColor = 255;
      } else if (value.startsWith('C')) {
        hookData.cell.styles.fillColor = [250, 204, 21];
        hookData.cell.styles.textColor = 0;
      } else if (value.startsWith('D')) {
        hookData.cell.styles.fillColor = [22, 163, 74];
        hookData.cell.styles.textColor = 255;
      }
    },
  });

  return (doc as JsPDFWithAutoTable).lastAutoTable.finalY || currentY;
};
