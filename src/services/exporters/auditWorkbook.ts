import type { Workbook } from 'exceljs';
import { AuditLogEntry } from '@/types/auditLogTypes';
import { createWorkbook } from './excelUtils';
import { buildClinicalAuditExportRows } from '@/services/admin/clinicalAuditExportRows';
import {
  PATIENT_PACKAGE_EXPORT_HEADERS,
  buildClinicalAuditPatientPackageExportRows,
} from '@/services/admin/clinicalAuditPatientPackageExportRows';
import type { ClinicalAuditPatientPackage } from '@/services/admin/clinicalAuditPatientPackages';

interface GenerateAuditWorkbookOptions {
  patientPackages?: ClinicalAuditPatientPackage[];
}

const styleHeaderRow = (row: ReturnType<Workbook['addWorksheet']>['lastRow']): void => {
  row?.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4F46E5' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
};

const autoFitColumns = (sheet: ReturnType<Workbook['addWorksheet']>): void => {
  sheet.columns.forEach(col => {
    let maxLen = 0;
    if (col && typeof col.eachCell === 'function') {
      col.eachCell({ includeEmpty: true }, cell => {
        const len = cell.value ? cell.value.toString().length : 0;
        if (len > maxLen) maxLen = len;
      });
    }
    col.width = Math.min(Math.max(maxLen + 2, 12), 50);
  });
};

/**
 * Generates an Excel workbook for audit logs
 */
export const generateAuditWorkbook = async (
  logs: AuditLogEntry[],
  options: GenerateAuditWorkbookOptions = {}
): Promise<Workbook> => {
  const workbook = await createWorkbook();
  const hasPatientPackages = Boolean(options.patientPackages?.length);

  if (hasPatientPackages && options.patientPackages) {
    const patientSheet = workbook.addWorksheet('Auditoría por Paciente');
    styleHeaderRow(patientSheet.addRow(PATIENT_PACKAGE_EXPORT_HEADERS));

    buildClinicalAuditPatientPackageExportRows(options.patientPackages).forEach(row => {
      patientSheet.addRow([
        row.censusDate,
        row.timeRange,
        row.patientName,
        row.patientRut,
        row.bedLabel,
        row.actionSummary,
        row.moduleLabel,
        row.beforeValue,
        row.afterValue,
        row.responsible,
        row.ipAddress,
        row.source,
        row.clinicalSummary,
      ]);
    });

    autoFitColumns(patientSheet);
  }

  const sheet = workbook.addWorksheet(
    hasPatientPackages ? 'Eventos Crudos Clínicos' : 'Auditoría Clínica Legal'
  );

  // Header styling
  const headerRow = sheet.addRow([
    'ID',
    'PAQUETE',
    'EPISODIO',
    'FECHA/HORA',
    'RESPONSABLE',
    'IDENTIFICADOR RESPONSABLE',
    'EVENTO CLÍNICO',
    'RELATO CLÍNICO',
    'AFECTADO',
    'RUT/ID PACIENTE',
    'ORIGEN/IP',
    'ÁREA',
    'IMPACTO',
    'CAMBIOS RELEVANTES',
    'RESUMEN LEGAL',
  ]);

  styleHeaderRow(headerRow);

  buildClinicalAuditExportRows(logs).forEach(row => {
    sheet.addRow([
      row.id,
      row.packageKindLabel,
      row.episodeId || 'Sin episodio explícito',
      row.timestamp,
      row.responsible,
      row.responsibleDetail,
      row.eventTitle,
      row.narrative,
      row.affected,
      row.patientIdentifier,
      row.origin,
      row.clinicalArea,
      row.impact,
      row.relevantChanges,
      row.legalTraceSummary,
    ]);
  });

  autoFitColumns(sheet);

  return workbook;
};
