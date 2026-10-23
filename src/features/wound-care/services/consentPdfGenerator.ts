/**
 * Consent PDF Generator
 *
 * Generates a 1-page institutional consent document for clinical photography.
 * Uses jsPDF for generation — dynamic import to keep bundle size small.
 */

import { getBase64ImageFromURL } from '@/services/pdf/handoffPdfUtils';
import {
  HOSPITAL_LOGO_PATH,
  HOSPITAL_NAME,
  HOSPITAL_SUBTITLE,
  HOSPITAL_LOCATION,
} from '../constants';
import { getTodayISO } from '@/utils/dateCoreUtils';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';

interface ConsentPdfInput {
  patientName: string;
  patientRut: string;
  admissionDate?: string;
}

const formatDate = (iso?: string): string => {
  if (!iso) return '____/____/________';
  try {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  } catch {
    return iso;
  }
};

const todayFormatted = (): string => formatDateDDMMYYYY(getTodayISO()).replace(/-/g, '/');

export const generateConsentPdf = async (input: ConsentPdfInput): Promise<string> => {
  const [{ default: jsPDF }] = await Promise.all([import('jspdf')]);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  // --- Header with logo ---
  try {
    const logoData = await getBase64ImageFromURL(HOSPITAL_LOGO_PATH);
    doc.addImage(logoData, 'PNG', margin, y, 15, 15);
  } catch {
    // Continue without logo
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(HOSPITAL_NAME, margin + 18, y + 6);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(HOSPITAL_SUBTITLE, margin + 18, y + 11);
  doc.text(HOSPITAL_LOCATION, margin + 18, y + 15);

  y += 25;

  // --- Horizontal line ---
  doc.setDrawColor(0, 120, 200);
  doc.setLineWidth(0.8);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  // --- Title ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('AUTORIZACIÓN PARA REGISTRO CLÍNICO AUDIOVISUAL', pageWidth / 2, y, {
    align: 'center',
  });
  y += 6;
  doc.setFontSize(11);
  doc.text('Lesiones cutáneas, heridas y otros hallazgos clínicos', pageWidth / 2, y, {
    align: 'center',
  });
  y += 10;

  // --- Patient data ---
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);

  const fieldY = y;
  doc.setFont('helvetica', 'bold');
  doc.text('Nombre del paciente:', margin, fieldY);
  doc.setFont('helvetica', 'normal');
  doc.text(input.patientName || '___________________________________', margin + 42, fieldY);

  doc.setFont('helvetica', 'bold');
  doc.text('RUT:', margin, fieldY + 7);
  doc.setFont('helvetica', 'normal');
  doc.text(input.patientRut || '____________________', margin + 12, fieldY + 7);

  doc.setFont('helvetica', 'bold');
  doc.text('Fecha de ingreso:', margin + 80, fieldY + 7);
  doc.setFont('helvetica', 'normal');
  doc.text(formatDate(input.admissionDate), margin + 115, fieldY + 7);

  y = fieldY + 16;

  // --- Horizontal separator ---
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  // --- Body text ---
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');

  const bodyText = [
    'Yo, el/la paciente abajo firmante (o su representante legal), declaro que he sido informado/a por el equipo de salud del Hospital Hanga Roa sobre lo siguiente:',
    '',
    '1.  Durante mi hospitalización, el equipo de salud podrá realizar registros audiovisuales de lesiones cutáneas, heridas, curaciones u otros hallazgos clínicos relevantes, con el fin de documentar mi evolución.',
    '',
    '2.  Este material se utilizará únicamente como parte de mi registro clínico para facilitar el seguimiento, la continuidad del cuidado y la comunicación entre los distintos integrantes del equipo de salud.',
    '',
    '3.  Las imágenes y registros NO serán utilizados con fines académicos, de investigación, publicación científica ni difusión de ningún tipo, salvo autorización expresa y separada.',
    '',
    '4.  El material será almacenado en un sistema digital seguro, con acceso restringido únicamente al personal clínico autorizado del Hospital Hanga Roa.',
    '',
    '5.  Puedo revocar esta autorización en cualquier momento, informando al equipo de salud a cargo de mi atención.',
  ];

  const lineHeight = 5;
  for (const line of bodyText) {
    if (line === '') {
      y += 2;
      continue;
    }
    // Handle line wrapping
    const wrapped = doc.splitTextToSize(line, contentWidth);
    for (const wrappedLine of wrapped) {
      doc.text(wrappedLine, margin, y);
      y += lineHeight;
    }
  }

  y += 6;

  // --- Signature area ---
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setDrawColor(0, 0, 0);

  const sigLineWidth = 65;
  const sigLeft = margin;
  const sigRight = pageWidth - margin - sigLineWidth;

  // Left: patient signature
  doc.line(sigLeft, y + 15, sigLeft + sigLineWidth, y + 15);
  doc.setFontSize(9);
  doc.text('Firma del Paciente o Representante Legal', sigLeft, y + 20);

  // Right: staff witness
  doc.line(sigRight, y + 15, sigRight + sigLineWidth, y + 15);
  doc.text('Firma del Profesional de Salud', sigRight, y + 20);
  doc.text('Nombre: ____________________________', sigRight, y + 28);

  y += 40;

  // --- Date and place ---
  doc.setFontSize(9);
  doc.text(`Fecha: ${todayFormatted()}`, pageWidth - margin, y, { align: 'right' });

  // Queue auto-print and return the blob URL so the caller can open it
  // through the browser window runtime adapter (keeps `window.open` out of
  // feature services — see scripts/check-runtime-adapter-boundary.mjs).
  doc.autoPrint();
  return doc.output('bloburl') as unknown as string;
};
