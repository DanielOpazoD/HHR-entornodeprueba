import { useState, useCallback } from 'react';
import { AuditLogEntry } from '@/types/auditLogTypes';
import { generateAuditPdfHtml } from '@/features/admin/components/internal/audit/utils/auditPdfUtils';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';
import { createScopedLogger } from '@/services/utils/loggerScope';
import type { ClinicalAuditPatientPackage } from '@/services/admin/clinicalAuditPatientPackages';

interface UseAuditExportParams {
  filteredLogs: AuditLogEntry[];
  patientPackages?: ClinicalAuditPatientPackage[];
  exportMode?: 'raw-events' | 'patient-packages';
  stats: {
    activeUserCount: number;
    criticalCount: number;
  };
  startDate?: string;
  endDate?: string;
}

const auditExportLogger = createScopedLogger('AuditExportHook');

export const useAuditExport = ({
  filteredLogs,
  patientPackages = [],
  exportMode = 'raw-events',
  stats,
  startDate,
  endDate,
}: UseAuditExportParams) => {
  const [isExporting, setIsExporting] = useState(false);

  const handleExcelExport = async () => {
    setIsExporting(true);
    try {
      const { generateAuditWorkbook } = await import('@/services/exporters/auditWorkbook');
      const workbook = await generateAuditWorkbook(
        filteredLogs,
        exportMode === 'patient-packages' ? { patientPackages } : undefined
      );
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([new Uint8Array(buffer)], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const { saveAs } = await import('file-saver');
      saveAs(blob, `auditoria_hospital_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (error) {
      auditExportLogger.error('Excel export failed', error);
    } finally {
      setIsExporting(false);
    }
  };

  const handlePdfExport = useCallback(() => {
    const printContent = generateAuditPdfHtml({
      filteredLogs,
      patientPackages,
      exportMode,
      stats,
      startDate,
      endDate,
    });

    const printWindow = defaultBrowserWindowRuntime.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.onload = () => {
        printWindow.print();
      };
    }
  }, [filteredLogs, patientPackages, exportMode, stats, startDate, endDate]);

  return {
    isExporting,
    handleExcelExport,
    handlePdfExport,
  };
};
