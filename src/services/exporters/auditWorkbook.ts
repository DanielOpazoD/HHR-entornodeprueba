import type { Workbook, Worksheet } from 'exceljs';
import type { AuditTrailEvent, AuditTrailSession } from '@/types/auditTrailTypes';
import { createWorkbook } from './excelUtils';
import {
  AUDIT_TRAIL_EVENT_EXPORT_HEADERS,
  AUDIT_TRAIL_SESSION_EXPORT_HEADERS,
  buildAuditTrailEventExportRows,
  buildAuditTrailSessionExportRows,
} from '@/services/admin/auditTrail/auditTrailExportRows';

const addTable = (sheet: Worksheet, headers: string[], rows: string[][]): void => {
  const header = sheet.addRow(headers);
  header.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FF0F172A' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  });
  rows.forEach(row => sheet.addRow(row));
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.columns.forEach((column, index) => {
    const longest = Math.max(
      headers[index]?.length ?? 0,
      ...rows.map(row => (row[index] ?? '').length)
    );
    column.width = Math.min(Math.max(longest + 2, 10), 60);
  });
};

/** The visible audit trail of a period: events (one row per change) and connections. */
export const generateAuditWorkbook = async ({
  events,
  sessions,
}: {
  events: AuditTrailEvent[];
  sessions: AuditTrailSession[];
}): Promise<Workbook> => {
  const workbook = await createWorkbook();
  addTable(
    workbook.addWorksheet('Eventos'),
    AUDIT_TRAIL_EVENT_EXPORT_HEADERS,
    buildAuditTrailEventExportRows(events)
  );
  addTable(
    workbook.addWorksheet('Conexiones'),
    AUDIT_TRAIL_SESSION_EXPORT_HEADERS,
    buildAuditTrailSessionExportRows(sessions)
  );
  return workbook;
};
