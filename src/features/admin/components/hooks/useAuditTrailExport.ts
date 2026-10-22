import { useCallback, useState } from 'react';
import type { AuditTrailEvent, AuditTrailSession } from '@/types/auditTrailTypes';
import type { AuditTrailPeriod } from '@/services/admin/auditTrail/auditTrailPeriod';
import { formatClinicalDayMonthYear } from '@/utils/clinicalTimeFormat';
import { createScopedLogger } from '@/services/utils/loggerScope';

const auditExportLogger = createScopedLogger('AuditTrailExport');

interface UseAuditTrailExportParams {
  events: AuditTrailEvent[];
  sessions: AuditTrailSession[];
  period: AuditTrailPeriod;
  /** Exporting the trail is itself an access to patient data. */
  onExported: (detail: { startDate: string; endDate: string; eventCount: number }) => void;
}

const fileLabel = (period: AuditTrailPeriod): string =>
  period.startDate === period.endDate
    ? formatClinicalDayMonthYear(period.endDate)
    : `${formatClinicalDayMonthYear(period.startDate)}_${formatClinicalDayMonthYear(period.endDate)}`;

export const useAuditTrailExport = ({
  events,
  sessions,
  period,
  onExported,
}: UseAuditTrailExportParams) => {
  const [isExporting, setIsExporting] = useState(false);

  const exportExcel = useCallback(async () => {
    setIsExporting(true);
    try {
      const { generateAuditWorkbook } = await import('@/services/exporters/auditWorkbook');
      const workbook = await generateAuditWorkbook({ events, sessions });
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([new Uint8Array(buffer)], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const { saveAs } = await import('file-saver');
      saveAs(blob, `auditoria_${fileLabel(period)}.xlsx`);
      onExported({
        startDate: period.startDate,
        endDate: period.endDate,
        eventCount: events.length,
      });
    } catch (error) {
      auditExportLogger.error('Excel export failed', error);
    } finally {
      setIsExporting(false);
    }
  }, [events, sessions, period, onExported]);

  return { isExporting, exportExcel };
};
