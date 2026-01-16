import type { Workbook } from 'exceljs';
import { AuditLogEntry } from '../../types/audit';
import { AUDIT_ACTION_LABELS } from '../admin/auditService';
import { createWorkbook } from './excelUtils';

/**
 * Generates an Excel workbook for audit logs
 */
export const generateAuditWorkbook = async (logs: AuditLogEntry[]): Promise<Workbook> => {
    const workbook = await createWorkbook();
    const sheet = workbook.addWorksheet('Registros de Auditoría');

    // Header styling
    const headerRow = sheet.addRow([
        'ID',
        'FECHA/HORA',
        'USUARIO',
        'ACCIÓN',
        'CAMA',
        'PACIENTE',
        'RUT',
        'DETALLES'
    ]);

    headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4F46E5' } // indigo-600
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    // Add data
    logs.forEach((log) => {
        const detailsStr = Object.entries(log.details)
            .filter(([k]) => k !== '_metadata')
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ');

        const bedId = (log.details.bedId as string) || log.entityId;
        const patientName = (log.details.patientName as string) || '';

        sheet.addRow([
            log.id,
            new Date(log.timestamp).toLocaleString('es-CL'),
            log.userId,
            AUDIT_ACTION_LABELS[log.action] || log.action,
            bedId && (bedId as string).length < 15 ? bedId : '-',
            patientName || '-',
            log.patientIdentifier || '-',
            detailsStr
        ]);
    });

    // Auto-fit columns
    sheet.columns.forEach((col) => {
        let maxLen = 0;
        if (col && typeof col.eachCell === 'function') {
            col.eachCell({ includeEmpty: true }, (cell) => {
                const len = cell.value ? cell.value.toString().length : 0;
                if (len > maxLen) maxLen = len;
            });
        }
        col.width = Math.min(Math.max(maxLen + 2, 12), 50);
    });

    return workbook;
};
