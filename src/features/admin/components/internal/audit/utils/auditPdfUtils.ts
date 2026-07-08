import { AuditLogEntry } from '@/types/auditLogTypes';
import { formatAuditTimestamp } from '@/services/admin/utils/auditUtils';
import { buildClinicalAuditExportRows } from '@/services/admin/clinicalAuditExportRows';
import {
  PATIENT_PACKAGE_EXPORT_HEADERS,
  buildClinicalAuditPatientPackageExportRows,
} from '@/services/admin/clinicalAuditPatientPackageExportRows';
import type { ClinicalAuditPatientPackage } from '@/services/admin/clinicalAuditPatientPackages';
import { escapeHtml } from '@/utils/htmlEscape';

interface AuditPdfReportParams {
  filteredLogs: AuditLogEntry[];
  stats: {
    activeUserCount: number;
    criticalCount: number;
  };
  startDate?: string;
  endDate?: string;
  patientPackages?: ClinicalAuditPatientPackage[];
  exportMode?: 'raw-events' | 'patient-packages';
}

export const generateAuditPdfHtml = ({
  filteredLogs,
  stats,
  startDate,
  endDate,
  patientPackages,
  exportMode = 'raw-events',
}: AuditPdfReportParams): string => {
  if (exportMode === 'patient-packages' && patientPackages?.length) {
    return generatePatientAuditPdfHtml({
      filteredLogs,
      patientPackages,
      stats,
      startDate,
      endDate,
    });
  }

  const rows = buildClinicalAuditExportRows(filteredLogs).slice(0, 200);

  return `
        <!DOCTYPE html>
        <html>
            <head>
                <meta charset="UTF-8">
                <title>Reporte de Auditoría Clínica/Legal - Hospital de Hanga Roa</title>
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
                    .legal-summary {font-size: 9px; color: #475569; line-height: 1.35; }
                    .footer {margin-top: 20px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 8px; color: #94a3b8; text-align: center; }
                </style>
            </head>
            <body>
                <div class="header-info">
                    <div>
                        <h1>Reporte de Auditoría Clínica/Legal</h1>
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
                <p><strong>Período:</strong> ${startDate || 'Inicio'} al ${endDate || 'Actual'} | <strong>Generado:</strong> ${formatAuditTimestamp(new Date().toISOString())}</p>
                <table>
                    <thead>
                        <tr>
                            <th>Fecha/Hora</th>
                            <th>Paquete clínico/legal</th>
                            <th>Responsable</th>
                            <th>Evento clínico</th>
                            <th>Relato clínico</th>
                            <th>Afectado</th>
                            <th>Origen/IP</th>
                            <th>Cambios relevantes</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows
                          .map((row, index) => {
                            const isCritical = filteredLogs[index]
                              ? [
                                  'PATIENT_ADMITTED',
                                  'PATIENT_DISCHARGED',
                                  'PATIENT_TRANSFERRED',
                                  'DAILY_RECORD_DELETED',
                                ].includes(filteredLogs[index].action)
                              : false;
                            return `<tr class="${isCritical ? 'critical' : ''}">
                                <td>${escapeHtml(row.timestamp)}</td>
                                <td>${escapeHtml(row.packageKindLabel)}<br><span style="color:#64748b">${escapeHtml(row.episodeId || row.packageSubject)}</span></td>
                                <td>${escapeHtml(row.responsible)}<br><span style="color:#64748b">${escapeHtml(row.responsibleDetail)}</span></td>
                                <td>${escapeHtml(row.eventTitle)}</td>
                                <td>${escapeHtml(row.narrative)}</td>
                                <td>${escapeHtml(row.affected)}<br><span style="color:#64748b">${escapeHtml(row.patientIdentifier)}</span></td>
                                <td>${escapeHtml(row.origin)}</td>
                                <td>${escapeHtml(row.relevantChanges)}<br><span class="legal-summary"><strong>Resumen legal:</strong> ${escapeHtml(row.legalTraceSummary)}</span></td>
                            </tr>`;
                          })
                          .join('')}
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

const generatePatientAuditPdfHtml = ({
  filteredLogs,
  patientPackages,
  stats,
  startDate,
  endDate,
}: Required<Pick<AuditPdfReportParams, 'filteredLogs' | 'patientPackages' | 'stats'>> &
  Pick<AuditPdfReportParams, 'startDate' | 'endDate'>): string => {
  const rows = buildClinicalAuditPatientPackageExportRows(patientPackages).slice(0, 200);

  return `
        <!DOCTYPE html>
        <html>
            <head>
                <meta charset="UTF-8">
                <title>Reporte de Auditoría por Paciente - Hospital de Hanga Roa</title>
                <style>
                    @page {size: landscape; margin: 1.4cm; }
                    body {font-family: Arial, sans-serif; font-size: 9px; color: #334155; }
                    h1 {font-size: 16px; margin-bottom: 5px; color: #0f172a; }
                    h2 {font-size: 12px; color: #64748b; margin-bottom: 18px; font-weight: normal; }
                    table {width: 100%; border-collapse: collapse; margin-top: 10px; }
                    th {background: #e0f2fe; color: #075985; padding: 7px; text-align: left; font-weight: bold; border-bottom: 2px solid #bae6fd; font-size: 8px; text-transform: uppercase; }
                    td {padding: 6px 7px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
                    tr:nth-child(even) {background: #f8fafc; }
                    .header-info {display: flex; justify-content: space-between; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #e2e8f0; }
                    .stats {display: flex; gap: 24px; }
                    .stat {text-align: center; }
                    .stat-value {font-size: 18px; font-weight: bold; color: #0284c7; }
                    .stat-label {font-size: 9px; color: #64748b; }
                    .summary {font-size: 8px; color: #475569; line-height: 1.35; }
                    .footer {margin-top: 20px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 8px; color: #94a3b8; text-align: center; }
                </style>
            </head>
            <body>
                <div class="header-info">
                    <div>
                        <h1>Reporte de Auditoría por Paciente</h1>
                        <h2>Hospital de Hanga Roa - Vista operativa paciente-céntrica</h2>
                    </div>
                    <div class="stats">
                        <div class="stat">
                            <div class="stat-value">${patientPackages.length}</div>
                            <div class="stat-label">Paquetes</div>
                        </div>
                        <div class="stat">
                            <div class="stat-value">${filteredLogs.length}</div>
                            <div class="stat-label">Eventos crudos</div>
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
                <p><strong>Período:</strong> ${startDate || 'Inicio'} al ${endDate || 'Actual'} | <strong>Generado:</strong> ${formatAuditTimestamp(new Date().toISOString())}</p>
                <table>
                    <thead>
                        <tr>
                            ${PATIENT_PACKAGE_EXPORT_HEADERS.map(header => `<th>${escapeHtml(header)}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${rows
                          .map(
                            row => `<tr>
                                <td>${escapeHtml(row.censusDate)}</td>
                                <td>${escapeHtml(row.timeRange)}</td>
                                <td>${escapeHtml(row.patientName)}</td>
                                <td>${escapeHtml(row.patientRut)}</td>
                                <td>${escapeHtml(row.bedLabel)}</td>
                                <td>${escapeHtml(row.actionSummary)}</td>
                                <td>${escapeHtml(row.moduleLabel)}</td>
                                <td>${escapeHtml(row.beforeValue)}</td>
                                <td>${escapeHtml(row.afterValue)}</td>
                                <td>${escapeHtml(row.responsible)}</td>
                                <td>${escapeHtml(row.ipAddress)}</td>
                                <td>${escapeHtml(row.source)}</td>
                                <td><span class="summary">${escapeHtml(row.clinicalSummary)}</span></td>
                            </tr>`
                          )
                          .join('')}
                    </tbody>
                </table>
                ${rows.length > 200 ? '<p style="text-align: center; color: #94a3b8; margin-top: 10px;">Mostrando primeros 200 registros exportables.</p>' : ''}
                <div class="footer">
                    Este documento prioriza la verdad operacional por paciente; los eventos crudos siguen disponibles en la exportación técnica.<br>
                    Los registros de auditoría no pueden ser modificados ni eliminados para cumplir con la Ley 20.584.
                </div>
            </body>
        </html>
    `;
};
