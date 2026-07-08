import type { jsPDF } from 'jspdf';

import { BEDS } from '@/constants/beds';
import type { ShiftType } from '@/types/domain/shift';
import type { HandoffPdfPatientTableRecord } from '@/services/pdf/contracts/handoffPdfContracts';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { calculateOperationalHospitalizedDays } from '@/utils/clinicalDayUtils';

import type { CellHookData, AutoTableFunction, JsPDFWithAutoTable } from './handoffPdfTypes';
import type { HandoffPdfTableRow } from './handoffPdfSectionTypes';
import {
  HANDOFF_PDF_PAGE_LAYOUT,
  getHandoffPdfTableMargin,
  type HandoffPdfPageMargin,
} from './handoffPdfPageLayout';
import {
  formatPatientDevicesForPdf,
  resolvePatientObservationForPdf,
  resolveStatusTextStyles,
} from './handoffPdfTableFormattingController';

export const PATIENT_TABLE_HEADERS = [
  ['Cama', 'Paciente', 'Diagnóstico', 'Est', 'DMI', 'Observaciones'],
];

export const buildPatientTableBody = (
  record: HandoffPdfPatientTableRecord,
  isMedical: boolean,
  selectedShift: ShiftType
): HandoffPdfTableRow[] => {
  const tableBody: HandoffPdfTableRow[] = [];

  BEDS.forEach(bedDef => {
    const patient = record.beds[bedDef.id];
    if (!patient || !patient.patientName) return;

    const admission = patient.admissionDate ? formatDateDDMMYYYY(patient.admissionDate) : '';
    const daysHosp = calculateOperationalHospitalizedDays(patient.admissionDate, record.date);
    const daysStr = daysHosp !== null ? `${daysHosp}d` : '';

    const row: HandoffPdfTableRow = [
      { content: bedDef.name, styles: { halign: 'center', fontStyle: 'bold', valign: 'top' } },
      {
        content: `${patient.patientName}\n${patient.rut || ''} ${patient.age ? `(${patient.age})` : ''}\nFI: ${admission}`,
        styles: { fontStyle: 'normal' },
      },
      patient.pathology || '',
      patient.status || '',
      formatPatientDevicesForPdf(patient, record.date),
      resolvePatientObservationForPdf(patient, isMedical, selectedShift),
    ];
    row._daysStr = daysStr;
    tableBody.push(row);

    if (patient.clinicalCrib && patient.clinicalCrib.patientName) {
      const crib = patient.clinicalCrib;
      const cribAdmission = crib.admissionDate ? formatDateDDMMYYYY(crib.admissionDate) : '';

      tableBody.push([
        { content: 'Cuna', styles: { halign: 'center', textColor: [236, 72, 153] } },
        {
          content: `${crib.patientName} (RN)\nFI: ${cribAdmission}`,
          styles: { textColor: [236, 72, 153], fontStyle: 'normal' },
        },
        crib.pathology || '',
        crib.status || '',
        formatPatientDevicesForPdf(crib, record.date),
        resolvePatientObservationForPdf(crib, isMedical, selectedShift),
      ]);
    }
  });

  if (tableBody.length === 0) {
    tableBody.push([
      { content: 'No hay pacientes registrados.', colSpan: 6, styles: { halign: 'center' } },
    ]);
  }

  return tableBody;
};

const createPatientTableDidParseCell = () => (hookData: CellHookData) => {
  if (hookData.section === 'body' && hookData.column.index === 3) {
    const styles = resolveStatusTextStyles((hookData.cell.raw as string) || '');
    if (styles) {
      Object.assign(hookData.cell.styles, styles);
    }
  }
};

const createPatientTableDidDrawCell =
  (doc: jsPDF, tableBody: HandoffPdfTableRow[]) => (hookData: CellHookData) => {
    if (hookData.section === 'body' && hookData.column.index === 0) {
      const rowData = tableBody[hookData.row.index];
      const daysStr = rowData?._daysStr;
      if (daysStr) {
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(120, 120, 120);
        doc.text(
          daysStr,
          hookData.cell.x + hookData.cell.width / 2,
          hookData.cell.y + hookData.cell.height - 2,
          { align: 'center' }
        );
        doc.setTextColor(0, 0, 0);
      }
    }
  };

export const addPatientTable = (
  doc: jsPDF,
  record: HandoffPdfPatientTableRecord,
  isMedical: boolean,
  selectedShift: ShiftType,
  currentY: number,
  autoTable: AutoTableFunction,
  pageMargin: HandoffPdfPageMargin = HANDOFF_PDF_PAGE_LAYOUT.margin
) => {
  const tableBody = buildPatientTableBody(record, isMedical, selectedShift);

  autoTable(doc, {
    startY: currentY,
    head: PATIENT_TABLE_HEADERS,
    body: tableBody,
    theme: 'plain',
    styles: {
      fontSize: 8,
      cellPadding: 1,
      lineColor: [200, 200, 200],
      lineWidth: 0.1,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [240, 240, 240],
      textColor: 0,
      fontStyle: 'bold',
      lineWidth: 0.1,
      lineColor: [180, 180, 180],
    },
    columnStyles: {
      0: { cellWidth: 15 },
      1: { cellWidth: 35 },
      2: { cellWidth: 40 },
      3: { cellWidth: 15 },
      4: { cellWidth: 25 },
      5: { cellWidth: 'auto' },
    },
    margin: getHandoffPdfTableMargin(pageMargin),
    didParseCell: createPatientTableDidParseCell(),
    didDrawCell: createPatientTableDidDrawCell(doc, tableBody),
  });

  return (doc as JsPDFWithAutoTable).lastAutoTable.finalY || currentY;
};
