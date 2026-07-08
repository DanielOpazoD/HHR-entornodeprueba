import type { ClinicalDocumentRecord } from '@/features/clinical-documents/domain/entities';
import { formatDateToCL } from '@/utils/clinicalUtils';
import { generateClinicalDocumentPrintStyledPdfBlob } from '@/features/clinical-documents/services/clinicalDocumentPrintPdfService';
import { stripClinicalDocumentHtml } from '@/features/clinical-documents/controllers/clinicalDocumentRichTextController';
import { clinicalDocumentPdfLogger } from '@/features/clinical-documents/services/clinicalDocumentLoggers';
import type { ClinicalDocumentAnnexPrintMode } from '@/features/clinical-documents/services/clinicalDocumentPrintSupport';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { getTodayISO } from '@/utils/dateCoreUtils';

type JsPdfModule = typeof import('jspdf');

let jsPdfModulePromise: Promise<JsPdfModule> | null = null;

const loadJsPdf = async (): Promise<JsPdfModule['jsPDF']> => {
  if (!jsPdfModulePromise) {
    jsPdfModulePromise = import('jspdf');
  }

  const module = await jsPdfModulePromise;
  return module.jsPDF;
};

const normalizeFieldValue = (fieldId: string, value: string): string => {
  if (!value.trim()) return '—';
  if (fieldId.startsWith('fec')) {
    return formatDateToCL(value);
  }
  return value;
};

const getPatientFieldLabelForPdf = (
  record: ClinicalDocumentRecord,
  field: ClinicalDocumentRecord['patientFields'][number]
): string => {
  if (
    record.documentType === 'epicrisis' &&
    field.id === 'finf' &&
    (!field.label || field.label === 'Fecha del informe')
  ) {
    return 'Fecha de alta';
  }
  return field.label;
};

const generateStructuredClinicalDocumentPdfBlob = async (
  record: ClinicalDocumentRecord,
  options: { annexMode?: ClinicalDocumentAnnexPrintMode } = {}
): Promise<Blob> => {
  const JsPdf = await loadJsPdf();
  const pdf = new JsPdf({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const marginX = 14;
  const marginY = 16;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const contentWidth = pageWidth - marginX * 2;
  const lineHeight = 5.5;
  let cursorY = marginY;

  const ensureSpace = (height: number) => {
    if (cursorY + height > pageHeight - marginY) {
      pdf.addPage();
      cursorY = marginY;
    }
  };

  const addWrappedText = (text: string, x: number, width: number, bold = false) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(10.5);
    const lines = pdf.splitTextToSize(text, width);
    ensureSpace(lines.length * lineHeight + 1);
    lines.forEach((line: string) => {
      pdf.text(line, x, cursorY);
      cursorY += lineHeight;
    });
  };
  const annexMode = options.annexMode ?? 'include';
  const shouldIncludeAnnex = annexMode === 'include' && Boolean(record.annexContent?.trim());
  const shouldPrintOnlyAnnex = annexMode === 'annex_only';
  const currentPrintDate = formatDateDDMMYYYY(getTodayISO());
  const annexPatientName =
    record.patientFields.find(field => field.id === 'nombre')?.value?.trim() ||
    record.patientName ||
    'Paciente';
  const renderAnnexHeader = () => {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(14);
    pdf.text('Anexo del documento', marginX, cursorY);
    cursorY += 7;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10.5);
    pdf.text(`Paciente: ${annexPatientName}`, marginX, cursorY);
    cursorY += 5.5;
    pdf.text(`Fecha: ${currentPrintDate}`, marginX, cursorY);
    cursorY += 7;
  };

  if (shouldPrintOnlyAnnex) {
    renderAnnexHeader();
    addWrappedText(stripClinicalDocumentHtml(record.annexContent || ''), marginX, contentWidth);
    return pdf.output('blob');
  }

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.text(record.title, pageWidth / 2, cursorY, { align: 'center' });
  cursorY += 8;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.text(record.patientInfoTitle || 'Información del Paciente', marginX, cursorY);
  cursorY += 6;

  record.patientFields
    .filter(field => field.visible !== false)
    .forEach(field => {
      addWrappedText(
        `${getPatientFieldLabelForPdf(record, field)}: ${normalizeFieldValue(field.id, field.value)}`,
        marginX,
        contentWidth
      );
      cursorY += 0.5;
    });
  cursorY += 2;

  record.sections
    .filter(section => section.visible !== false)
    .sort((left, right) => left.order - right.order)
    .forEach(section => {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(11);
      ensureSpace(lineHeight + 2);
      const formatPdfDate = (iso?: string): string => {
        if (!iso) return '';
        const p = iso.split('-');
        return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
      };
      const dateTimeSuffix =
        section.kind === 'clinical-update' && (section.updateDate || section.updateTime)
          ? `  ${formatPdfDate(section.updateDate)}${section.updateDate && section.updateTime ? ', ' : ''}${section.updateTime || ''}`
          : '';
      const sectionHeader = `${section.title}${dateTimeSuffix}`.trim();
      pdf.text(sectionHeader, marginX, cursorY);
      cursorY += lineHeight + 1;
      addWrappedText(
        stripClinicalDocumentHtml(section.content) || 'Sin contenido registrado.',
        marginX,
        contentWidth
      );
      cursorY += 2;
    });

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  ensureSpace(lineHeight * 3);
  pdf.text('Profesional Responsable', marginX, cursorY);
  cursorY += 6;
  addWrappedText(
    `${record.footerMedicoLabel || 'Médico'}: ${record.medico || '—'}`,
    marginX,
    contentWidth / 2 - 2
  );
  const savedY = cursorY;
  cursorY -= lineHeight;
  addWrappedText(
    `${record.footerEspecialidadLabel || 'Especialidad'}: ${record.especialidad || '—'}`,
    pageWidth / 2 + 2,
    contentWidth / 2 - 2
  );
  cursorY = Math.max(cursorY, savedY) + 2;

  // Annexes page (if present)
  if (shouldIncludeAnnex) {
    pdf.addPage();
    cursorY = marginY;
    renderAnnexHeader();
    addWrappedText(stripClinicalDocumentHtml(record.annexContent || ''), marginX, contentWidth);
  }

  return pdf.output('blob');
};

export const generateClinicalDocumentPdfBlob = async (
  record: ClinicalDocumentRecord,
  options: { annexMode?: ClinicalDocumentAnnexPrintMode } = {}
): Promise<Blob> => {
  try {
    const printStyled = await generateClinicalDocumentPrintStyledPdfBlob(record, options);
    if (printStyled) {
      return printStyled;
    }
  } catch (error) {
    clinicalDocumentPdfLogger.warn(
      'Print-style generation failed, falling back to structured PDF',
      error
    );
  }

  return generateStructuredClinicalDocumentPdfBlob(record, options);
};
