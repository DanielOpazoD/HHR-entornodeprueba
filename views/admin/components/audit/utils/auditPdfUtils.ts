import { AuditLogEntry } from '@/types/audit';
import { AUDIT_ACTION_LABELS } from '@/services/admin/auditService';
import { formatTimestamp } from '../auditUIUtils';

interface AuditPdfReportParams {
    filteredLogs: AuditLogEntry[];
    stats: {
        activeUserCount: number;
        criticalCount: number;
    };
    startDate?: string;
    endDate?: string;
}

export const generateAuditPdfHtml = ({
    filteredLogs,
    stats,
    startDate,
    endDate
}: AuditPdfReportParams): string => {
    return `
        <!DOCTYPE html>
        <html>
            <head>
                <meta charset="UTF-8">
                <title>Reporte de Auditoría - Hospital de Hanga Roa</title>
                <style>
                    @page {size: landscape; margin: 1.5cm; }
                    body {font-family: Arial, sans-serif; font-size: 10px; color: #333; }
                    h1 {font-size: 16px; margin-bottom: 5px; }
                    h2 {font-size: 12px; color: #666; margin-bottom: 20px; font-weight: normal; }
                    table {width: 100%; border-collapse: collapse; margin-top: 10px; }
                    th {background: #f1f5f9; padding: 8px; text-align: left; font-weight: bold; border-bottom: 2px solid #e2e8f0; font-size: 9px; text-transform: uppercase; }
                    td {padding: 6px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
                    tr:nth-child(even) {background: #f8fafc; }
                    .critical {background: #fee2e2 !important; }
                    .header-info {display: flex; justify-content: space-between; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #e2e8f0; }
                    .stats {display: flex; gap: 30px; }
                    .stat {text-align: center; }
                    .stat-value {font-size: 18px; font-weight: bold; color: #4f46e5; }
                    .stat-label {font-size: 9px; color: #64748b; }
                    .footer {margin-top: 20px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 8px; color: #94a3b8; text-align: center; }
                </style>
            </head>
            <body>
                <div class="header-info">
                    <div>
                        <h1>📋 Reporte de Auditoría</h1>
                        <h2>Hospital de Hanga Roa - Sistema de Gestión Clínica</h2>
                    </div>
                    <div class="stats">
                        <div class="stat">
                            <div class="stat-value">${filteredLogs.length}</div>
                            <div class="stat-label">Registros</div>
                        </div>
                        <div class="stat">
                            <div class="stat-value">${stats.activeUserCount}</div>
                            <div class="stat-label">Usuarios</div>
                        </div>
                        <div class="stat">
                            <div class="stat-value">${stats.criticalCount}</div>
                            <div class="stat-label">Críticos</div>
                        </div>
                    </div>
                </div>
                <p><strong>Período:</strong> ${startDate || 'Inicio'} al ${endDate || 'Actual'} | <strong>Generado:</strong> ${new Date().toLocaleString('es-CL')}</p>
                <table>
                    <thead>
                        <tr>
                            <th>Fecha/Hora</th>
                            <th>Operador</th>
                            <th>Acción</th>
                            <th>Resumen</th>
                            <th>Paciente</th>
                            <th>Cama</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filteredLogs.slice(0, 200).map(log => {
        const isCritical = ['PATIENT_ADMITTED', 'PATIENT_DISCHARGED', 'PATIENT_TRANSFERRED', 'DAILY_RECORD_DELETED'].includes(log.action);
        const patientName = (log.details?.patientName as string) || '-';
        const bedId = (log.details?.bedId as string) || '-';
        return `<tr class="${isCritical ? 'critical' : ''}">
                                <td>${formatTimestamp(log.timestamp)}</td>
                                <td>${log.userDisplayName || (log.userId || '-').split('@')[0]}</td>
                                <td>${AUDIT_ACTION_LABELS[log.action] || log.action}</td>
                                <td>${log.summary || '-'}</td>
                                <td>${patientName}</td>
                                <td>${bedId}</td>
                            </tr>`;
    }).join('')}
                    </tbody>
                </table>
                ${filteredLogs.length > 200 ? '<p style="text-align: center; color: #94a3b8; margin-top: 10px;">Mostrando primeros 200 de ' + filteredLogs.length + ' registros</p>' : ''}
                <div class="footer">
                    Este documento fue generado automáticamente por el Sistema de Auditoría del Hospital de Hanga Roa.<br>
                    Los registros de auditoría no pueden ser modificados ni eliminados para cumplir con la Ley 20.584.
                </div>
            </body>
        </html>
    `;
};
