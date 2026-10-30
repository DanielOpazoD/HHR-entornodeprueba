/**
 * PDF Content Builder for Handoff Backups
 * Builds the PDF content for nursing handoffs (identically to "PDF LITE")
 *
 * Logic replicated from services/pdf/handoffPdfGenerator.ts
 * Modified to avoid side effects (doc.save) and fix types.
 */

import type jsPDF from 'jspdf';
import { PatientData } from '@/services/contracts/patientServiceContracts';
import type { ShiftType } from '@/types/domain/shift';
import type { DeviceDetails } from '@/types/domain/devices';
import { BEDS } from '@/constants/beds';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import type { HandoffPdfRecord } from '@/services/pdf/contracts/handoffPdfContracts';
import { pdfContentBuilderLogger } from '@/services/backup/backupLoggers';
import { addNovedadesSection } from '@/services/pdf/handoffPdfLayoutSections';
import { getHandoffStaffInfo } from '@/services/pdf/handoffPdfUtils';
import { resolveNursingHandoffNovedadesText } from '@/shared/handoff/handoffNovedades';

// Logo path
const LOGO_PATH = '/images/logos/logo_HHR.svg';

export interface Schedule {
  dayStart?: string;
  dayEnd?: string;
  nightStart?: string;
  nightEnd?: string;
}

// Augment jsPDF for autotable
declare module 'jspdf' {
  interface jsPDF {
    lastAutoTable: { finalY: number };
  }
}

// Basic types for autoTable to avoid 'any'
interface AutoTableOptions {
  startY?: number;
  head?: (
    | string
    | {
        content: string;
        colSpan?: number;
        styles?: Record<string, string | number | boolean | number[] | undefined | null>;
      }
    | string[]
  )[][];
  body: (
    | string
    | {
        content: string;
        colSpan?: number;
        styles?: Record<string, string | number | boolean | number[] | undefined | null>;
      }
    | {
        content: string;
        styles: Record<string, string | number | boolean | number[] | undefined | null>;
      }
    | string[]
  )[][];
  theme?: 'striped' | 'grid' | 'plain';
  styles?: Record<string, string | number | boolean | number[] | undefined | null>;
  headStyles?: Record<string, string | number | boolean | number[] | undefined | null>;
  columnStyles?: Record<
    number | string,
    | { cellWidth?: number | 'auto' }
    | Record<string, string | number | boolean | number[] | undefined | null>
  >;
  margin?: { top?: number; right?: number; bottom?: number; left?: number };
  didDrawCell?: (data: {
    section: string;
    column: { index: number };
    row: { index: number };
    cell: { x: number; y: number; width: number; height: number };
  }) => void;
}

/**
 * Build handoff PDF content into a jsPDF document
 */
export const buildHandoffPdfContent = async (
  doc: jsPDF,
  record: HandoffPdfRecord,
  shiftType: ShiftType,
  schedule: Schedule,
  autoTable: (doc: jsPDF, options: AutoTableOptions) => void // Injected dependency
): Promise<void> => {
  const pageWidth = doc.internal.pageSize.width;
  const margin = 14;
  const logoSize = 10;

  // 1. HEADER
  try {
    const logoData = await getBase64ImageFromURL(LOGO_PATH);
    doc.addImage(logoData, 'PNG', margin, margin, logoSize, logoSize);
  } catch (e) {
    pdfContentBuilderLogger.warn('Could not load logo for backup PDF', e);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  const title = `ENTREGA DE TURNO ENFERMERÍA - TURNO ${shiftType === 'day' ? 'LARGO' : 'NOCHE'}`;
  doc.text(title, margin + logoSize + 4, margin + 4);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('HOSPITAL HANGA ROA', margin + logoSize + 4, margin + 9);

  // Date & Shift Info (Right aligned)
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  const dateStr = formatDateDDMMYYYY(record.date);
  doc.text(dateStr, pageWidth - margin, margin + 4, { align: 'right' });

  doc.setFontSize(9);
  doc.setFont('helvetica', 'italic');
  const shiftLabel = shiftType === 'day' ? 'TURNO LARGO' : 'TURNO NOCHE';
  const shiftHours =
    shiftType === 'day'
      ? `(${schedule?.dayStart || '08:00'} - ${schedule?.dayEnd || '20:00'})`
      : `(${schedule?.nightStart || '20:00'} - ${schedule?.nightEnd || '08:00'})`;

  doc.text(`${shiftLabel} ${shiftHours}`, pageWidth - margin, margin + 9, { align: 'right' });

  // Nurse/Staff Info
  let currentY = margin + 18;

  const { delivers, receives, tens } = getHandoffStaffInfo(record, shiftType);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'bolditalic');
  doc.text('ENFERMERO(A) ENTREGA:', margin, currentY);
  doc.text('ENFERMERO(A) RECIBE:', margin + 70, currentY);
  doc.text('TENS:', margin + 140, currentY);

  currentY += 4;
  doc.setFont('helvetica', 'normal');
  doc.text(delivers.filter(Boolean).join(', ') || '-', margin, currentY);
  doc.text(receives.filter(Boolean).join(', ') || '-', margin + 70, currentY);
  doc.text(tens.filter(Boolean).join(', ') || '-', margin + 140, currentY);

  currentY += 5;

  // 2. CHECKLIST
  const checklist = shiftType === 'day' ? record.handoffDayChecklist : record.handoffNightChecklist;
  if (checklist) {
    type Checklist = {
      escalaBraden?: boolean;
      escalaRiesgoCaidas?: boolean;
      escalaRiesgoLPP?: boolean;
      estadistica?: boolean;
      categorizacionCudyr?: boolean;
      encuestaUTI?: boolean;
      encuestaMedias?: boolean;
      conteoMedicamento?: boolean;
      conteoNoControlados?: boolean;
      conteoNoControladosProximaFecha?: string;
    };
    const cl = checklist as Checklist;
    const checklistItems: string[] = [];

    if (shiftType === 'day') {
      if (cl.escalaBraden) checklistItems.push('Escala Braden: OK');
      if (cl.escalaRiesgoCaidas) checklistItems.push('Riesgo Caidas: OK');
      if (cl.escalaRiesgoLPP) checklistItems.push('Evaluacion LPP: OK');
    } else {
      if (cl.estadistica) checklistItems.push('Estadistica: OK');
      if (cl.categorizacionCudyr) checklistItems.push('Categorizacion CUDYR: OK');
      if (cl.encuestaUTI) checklistItems.push('Encuesta UTI: OK');
      if (cl.encuestaMedias) checklistItems.push('Encuesta Medias: OK');
      if (cl.conteoMedicamento) checklistItems.push('Farmacos Controlados: OK');
      if (cl.conteoNoControlados) {
        const proxDate = cl.conteoNoControladosProximaFecha;
        if (proxDate) {
          checklistItems.push(
            `Farmacos No-Controlados: OK (PROX: ${formatDateDDMMYYYY(proxDate)})`
          );
        } else {
          checklistItems.push('Farmacos No-Controlados: OK');
        }
      }
    }

    doc.setFontSize(6);
    doc.setFont('helvetica', 'bold');
    const checklistText =
      checklistItems.length > 0
        ? `CHECKLIST: ${checklistItems.join(' | ')}`
        : 'CHECKLIST: Sin items completados';
    doc.text(checklistText, margin, currentY);
    doc.setFont('helvetica', 'normal');
    currentY += 4;
  }

  const sharedChecklist = record.handoffSharedChecklist;
  if (sharedChecklist?.crashCartReviewDate || sharedChecklist?.crashCartCode) {
    doc.setFontSize(6);
    doc.text(
      `Ultima fecha revision carro de paro: ${sharedChecklist.crashCartReviewDate ? formatDateDDMMYYYY(sharedChecklist.crashCartReviewDate) : '-'} | Codigo: ${sharedChecklist.crashCartCode || '-'}`,
      margin,
      currentY
    );
    currentY += 4;
  }

  // 3. PATIENT TABLE
  const tableHeaders: string[][] = [
    ['Cama', 'Paciente', 'Diagnóstico', 'Est', 'DMI', 'Observaciones'],
  ];
  type TableCellStyles = Record<string, string | number | boolean | number[] | undefined | null>;
  type TableCell =
    | string
    | { content: string; colSpan?: number; styles?: TableCellStyles }
    | { content: string; styles: TableCellStyles };
  type TableRow = TableCell[];
  const tableBody: TableRow[] = [];

  const formatDevices = (p: PatientData): string => {
    if (!p.devices || !Array.isArray(p.devices) || p.devices.length === 0) return '';
    return (p.devices as string[])
      .map((d: string) => {
        const detail = p.deviceDetails?.[d as keyof DeviceDetails];
        let daysStr = '';
        if (detail?.installationDate) {
          const installDate = new Date(detail.installationDate);
          const today = new Date(record.date);
          installDate.setHours(0, 0, 0, 0);
          today.setHours(0, 0, 0, 0);
          const diffTime = today.getTime() - installDate.getTime();
          const diffDays = Math.floor(diffTime / (1000 * 3600 * 24)) + 1;
          if (diffDays > 0) {
            daysStr = ` (${diffDays}d)`;
          }
        }
        return `${d}${daysStr}`;
      })
      .join(', ');
  };

  BEDS.forEach(bedDef => {
    const patient = record.beds[bedDef.id];
    if (!patient || !patient.patientName) return;

    const admission = patient.admissionDate ? formatDateDDMMYYYY(patient.admissionDate) : '';
    const observationKey =
      shiftType === 'day' ? 'handoffNoteDayShift' : ('handoffNoteNightShift' as const);
    // Safe access to observation
    const observation = patient[observationKey as keyof PatientData] || '';
    const devicesStr = formatDevices(patient);

    tableBody.push([
      { content: bedDef.name, styles: { halign: 'center', fontStyle: 'bold', valign: 'top' } },
      {
        content: `${patient.patientName}\n${patient.rut || ''} ${patient.age ? `(${patient.age})` : ''}\nFI: ${admission}`,
        styles: { fontStyle: 'normal' },
      },
      patient.pathology || '',
      patient.status || '',
      devicesStr,
      observation as string,
    ]);

    // Clinical Crib
    if (patient.clinicalCrib && patient.clinicalCrib.patientName) {
      const crib = patient.clinicalCrib;
      const cribObservation = crib[observationKey as keyof PatientData] || '';
      const cribDevices = formatDevices(crib);
      const cribAdmission = crib.admissionDate ? formatDateDDMMYYYY(crib.admissionDate) : '';

      tableBody.push([
        { content: 'Cuna', styles: { halign: 'center', textColor: [236, 72, 153] } },
        {
          content: `${crib.patientName} (RN)\nFI: ${cribAdmission}`,
          styles: { textColor: [236, 72, 153], fontStyle: 'normal' },
        },
        crib.pathology || '',
        crib.status || '',
        cribDevices,
        cribObservation as string,
      ]);
    }
  });

  if (tableBody.length === 0) {
    tableBody.push([
      { content: 'No hay pacientes registrados.', colSpan: 6, styles: { halign: 'center' } },
    ]);
  }

  autoTable(doc, {
    startY: currentY,
    head: tableHeaders,
    body: tableBody,
    theme: 'plain',
    styles: {
      fontSize: 8,
      cellPadding: 1,
      lineColor: [200, 200, 200],
      lineWidth: 0.1,
      fillColor: false,
      textColor: [0, 0, 0],
      minCellHeight: 6,
    },
    headStyles: {
      fillColor: [240, 240, 240],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      lineWidth: 0.1,
    },
    columnStyles: {
      0: { cellWidth: 12 },
      1: { cellWidth: 35 },
      2: { cellWidth: 35 },
      3: { cellWidth: 15 },
      4: { cellWidth: 25 },
      5: { cellWidth: 'auto' },
    },
    margin: { left: margin, right: margin },
    didDrawCell: data => {
      if (data.section === 'body' && data.row.index > 0) {
        doc.setDrawColor(220, 220, 220);
        doc.line(data.cell.x, data.cell.y, data.cell.x + data.cell.width, data.cell.y);
      }
    },
  });

  // 4. NOVEDADES
  const finalY = doc.lastAutoTable?.finalY || currentY + 20;
  const novedades = resolveNursingHandoffNovedadesText({
    selectedShift: shiftType,
    handoffNovedadesDayShift: record.handoffNovedadesDayShift,
    handoffNovedadesNightShift: record.handoffNovedadesNightShift,
  });
  addNovedadesSection(doc, novedades, margin, finalY + 8);

  // Page numbering
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.text(`Página ${i} de ${totalPages}`, pageWidth / 2, doc.internal.pageSize.height - 8, {
      align: 'center',
    });
  }
};

/**
 * Helper to convert image to DataURI
 */
const getBase64ImageFromURL = (url: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = url;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0);
      const dataURL = canvas.toDataURL('image/png');
      resolve(dataURL);
    };
    img.onerror = error => reject(error);
  });
};
