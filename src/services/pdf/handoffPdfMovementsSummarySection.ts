import type { jsPDF } from 'jspdf';

import type { HandoffPdfMovementsRecord } from '@/services/pdf/contracts/handoffPdfContracts';
import {
  getActiveCma,
  getActiveDischarges,
  getActiveTransfers,
} from '@/application/census/movementTombstonePolicy';

import type { AutoTableFunction, JsPDFWithAutoTable } from './handoffPdfTypes';
import type { HandoffPdfMovementSummaryTable } from './handoffPdfSectionTypes';
import {
  HANDOFF_PDF_PAGE_LAYOUT,
  getHandoffPdfContentBottomY,
  getHandoffPdfTableMargin,
  type HandoffPdfPageMargin,
} from './handoffPdfPageLayout';

export const buildMovementsSummaryTables = (
  record: HandoffPdfMovementsRecord
): HandoffPdfMovementSummaryTable[] => {
  const discharges = getActiveDischarges(record.discharges);
  const transfers = getActiveTransfers(record.transfers);
  const cmaMovements = getActiveCma(record.cma);

  return [
    {
      title: 'ALTAS:',
      emptyLabel: ' Sin altas',
      emptyOffsetX: 12,
      headers: [['Cama', 'Paciente', 'Diagnóstico', 'Destino/Tipo']],
      rows: discharges.map(discharge => [
        discharge.bedName,
        discharge.patientName + (discharge.rut ? ` - ${discharge.rut}` : ''),
        discharge.diagnosis,
        discharge.status === 'Fallecido' ? 'Fallecido' : discharge.dischargeType || 'Domicilio',
      ]),
    },
    {
      title: 'TRASLADOS:',
      emptyLabel: ' Sin traslados',
      emptyOffsetX: 22,
      headers: [['Origen', 'Paciente', 'Diagnóstico', 'Destino', 'Medio']],
      rows: transfers.map(transfer => [
        transfer.bedName,
        transfer.patientName,
        transfer.diagnosis,
        transfer.receivingCenter,
        transfer.evacuationMethod,
      ]),
    },
    {
      title: 'HOSPITALIZACIÓN DIURNA (CMA):',
      emptyLabel: ' Sin hospitalizaciones diurnas',
      emptyOffsetX: 55,
      headers: [['Paciente', 'RUT', 'Intervención', 'Tipo']],
      rows: cmaMovements.map(cma => [
        cma.patientName,
        cma.rut,
        cma.diagnosis,
        cma.interventionType,
      ]),
    },
  ];
};

export const addMovementsSummary = (
  doc: jsPDF,
  record: HandoffPdfMovementsRecord,
  margin: number,
  startY: number,
  autoTable: AutoTableFunction,
  pageMargin: HandoffPdfPageMargin = HANDOFF_PDF_PAGE_LAYOUT.margin
) => {
  let currentY = startY;
  const contentBottomY = getHandoffPdfContentBottomY(doc, pageMargin);
  const movementTables = buildMovementsSummaryTables(record);

  if (currentY + 40 > contentBottomY) {
    doc.addPage();
    currentY = pageMargin.top;
  } else {
    currentY += 4;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('RESUMEN DE MOVIMIENTOS', margin, currentY);
  currentY += 6;

  movementTables.forEach((summaryTable, index) => {
    if (currentY + 12 > getHandoffPdfContentBottomY(doc, pageMargin)) {
      doc.addPage();
      currentY = pageMargin.top;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(summaryTable.title, margin, currentY);

    if (summaryTable.rows.length > 0) {
      currentY += 2;
      autoTable(doc, {
        startY: currentY,
        head: summaryTable.headers,
        body: summaryTable.rows,
        theme: 'plain',
        styles: { fontSize: 8, cellPadding: 1, lineColor: [200, 200, 200], lineWidth: 0.1 },
        headStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'bold' },
        margin: getHandoffPdfTableMargin(pageMargin),
      });
      currentY = (doc as JsPDFWithAutoTable).lastAutoTable.finalY + 4;
    } else {
      doc.setFont('helvetica', 'italic');
      doc.text(summaryTable.emptyLabel, margin + summaryTable.emptyOffsetX, currentY);
      currentY += 5;
    }

    if (index < movementTables.length - 1) {
      currentY += 3;
    }
  });

  return currentY;
};
