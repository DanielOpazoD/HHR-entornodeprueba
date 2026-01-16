import { useState, useCallback } from 'react';
import { saveAs } from 'file-saver';
import { AuditLogEntry } from '@/types/audit';
import { generateAuditWorkbook } from '@/services/exporters/auditWorkbook';
import { generateAuditPdfHtml } from '../components/audit/utils/auditPdfUtils';

interface UseAuditExportParams {
    filteredLogs: AuditLogEntry[];
    stats: {
        activeUserCount: number;
        criticalCount: number;
    };
    startDate?: string;
    endDate?: string;
}

export const useAuditExport = ({
    filteredLogs,
    stats,
    startDate,
    endDate
}: UseAuditExportParams) => {
    const [isExporting, setIsExporting] = useState(false);

    const handleExcelExport = async () => {
        setIsExporting(true);
        try {
            const workbook = await generateAuditWorkbook(filteredLogs);
            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([new Uint8Array(buffer)], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });
            saveAs(blob, `auditoria_hospital_${new Date().toISOString().split('T')[0]}.xlsx`);
        } catch (error) {
            console.error('Excel Export failed:', error);
        } finally {
            setIsExporting(false);
        }
    };

    const handlePdfExport = useCallback(() => {
        const printContent = generateAuditPdfHtml({
            filteredLogs,
            stats,
            startDate,
            endDate
        });

        const printWindow = window.open('', '_blank');
        if (printWindow) {
            printWindow.document.write(printContent);
            printWindow.document.close();
            printWindow.onload = () => {
                printWindow.print();
            };
        }
    }, [filteredLogs, stats, startDate, endDate]);

    return {
        isExporting,
        handleExcelExport,
        handlePdfExport
    };
};
