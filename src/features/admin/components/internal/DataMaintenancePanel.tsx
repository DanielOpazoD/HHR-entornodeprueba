import React, { useState } from 'react';
import { Download, FileJson, Info, Upload } from 'lucide-react';
import {
  exportMonthRecordsWithOutcome,
  exportYearToDateRecordsWithOutcome,
} from '@/services/admin/dataMaintenanceService';
import {
  auditAdmissionDateBackfill,
  applyAdmissionDateBackfill,
  type AdmissionDateBackfillResult,
} from '@/services/admin/admissionDateBackfillService';
import { DataImportModal } from './DataImportModal';
import { DataMaintenanceExportCard } from './DataMaintenanceExportCard';
import { DataMaintenanceImportCard } from './DataMaintenanceImportCard';
import { AdmissionDateBackfillPanel } from './AdmissionDateBackfillPanel';

interface DataMaintenancePanelProps {
  onDailyExport?: () => void;
  onDailyImport?: () => void;
}

export const DataMaintenancePanel: React.FC<DataMaintenancePanelProps> = ({
  onDailyExport,
  onDailyImport,
}) => {
  const [isExporting, setIsExporting] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportWarning, setExportWarning] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [exportingScope, setExportingScope] = useState<'month' | 'year' | null>(null);
  const [isAuditingAdmissionDates, setIsAuditingAdmissionDates] = useState(false);
  const [isApplyingAdmissionDates, setIsApplyingAdmissionDates] = useState(false);
  const [admissionDateBackfillResult, setAdmissionDateBackfillResult] =
    useState<AdmissionDateBackfillResult | null>(null);
  const [admissionDateBackfillError, setAdmissionDateBackfillError] = useState<string | null>(null);
  const [backfillProgress, setBackfillProgress] = useState({ current: 0, total: 0 });

  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);
  const months = [
    { value: 1, label: 'Enero' },
    { value: 2, label: 'Febrero' },
    { value: 3, label: 'Marzo' },
    { value: 4, label: 'Abril' },
    { value: 5, label: 'Mayo' },
    { value: 6, label: 'Junio' },
    { value: 7, label: 'Julio' },
    { value: 8, label: 'Agosto' },
    { value: 9, label: 'Septiembre' },
    { value: 10, label: 'Octubre' },
    { value: 11, label: 'Noviembre' },
    { value: 12, label: 'Diciembre' },
  ];

  const handleExport = async (scope: 'month' | 'year') => {
    setIsExporting(true);
    setExportingScope(scope);
    setExportError(null);
    setExportWarning(null);
    setExportSuccess(false);
    try {
      const result =
        scope === 'month'
          ? await exportMonthRecordsWithOutcome(selectedYear, selectedMonth)
          : await exportYearToDateRecordsWithOutcome(selectedYear);

      // Partial: the file was downloaded, but some split days lack their episode documents.
      if (result.status === 'partial' && result.data) {
        setExportWarning(result.userSafeMessage || result.data.userSafeMessage);
        return;
      }

      if (result.status !== 'success' || !result.data) {
        setExportError(
          result.userSafeMessage || result.issues[0]?.message || 'No se pudo exportar.'
        );
        return;
      }

      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 5000);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Error desconocido al exportar');
    } finally {
      setIsExporting(false);
      setExportingScope(null);
    }
  };

  const handleAuditAdmissionDates = async () => {
    setIsAuditingAdmissionDates(true);
    setAdmissionDateBackfillError(null);
    try {
      const result = await auditAdmissionDateBackfill();
      setAdmissionDateBackfillResult(result);
    } catch (err) {
      setAdmissionDateBackfillError(err instanceof Error ? err.message : 'No se pudo auditar.');
    } finally {
      setIsAuditingAdmissionDates(false);
    }
  };

  const handleApplyAdmissionDates = async () => {
    setIsApplyingAdmissionDates(true);
    setAdmissionDateBackfillError(null);
    setBackfillProgress({ current: 0, total: 0 });
    try {
      const result = await applyAdmissionDateBackfill((current, total) => {
        setBackfillProgress({ current, total });
      });
      setAdmissionDateBackfillResult(result);
    } catch (err) {
      setAdmissionDateBackfillError(
        err instanceof Error ? err.message : 'No se pudo aplicar la corrección.'
      );
    } finally {
      setIsApplyingAdmissionDates(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <DataMaintenanceExportCard
          isExporting={isExporting}
          exportError={exportError}
          exportWarning={exportWarning}
          exportSuccess={exportSuccess}
          exportingScope={exportingScope}
          selectedYear={selectedYear}
          selectedMonth={selectedMonth}
          years={years}
          months={months}
          onSelectYear={setSelectedYear}
          onSelectMonth={setSelectedMonth}
          onExport={scope => void handleExport(scope)}
        />

        <DataMaintenanceImportCard onOpenImport={() => setShowImportModal(true)} />

        {/* Daily Backup - New Section */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 hover:shadow-md transition-all flex flex-col md:col-span-2">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
                <FileJson className="text-blue-600" size={20} />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-800 leading-none mb-1.5">
                  Respaldo de Seguridad Instantáneo
                </h3>
                <p className="text-[11px] text-slate-500 max-w-md">
                  Respalda o restaura el censo completo del día actual de forma rápida.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={onDailyExport}
                className="px-6 py-3 rounded-xl bg-blue-600 text-white font-bold text-sm flex items-center gap-2 hover:bg-blue-700 transition-all shadow-md shadow-blue-100"
              >
                <Download size={16} />
                Exportar Día
              </button>
              <button
                onClick={onDailyImport}
                className="px-6 py-3 rounded-xl bg-slate-100 text-slate-700 font-bold text-sm flex items-center gap-2 hover:bg-slate-200 transition-all border border-slate-200"
              >
                <Upload size={16} />
                Importar día
              </button>
            </div>
          </div>
        </div>
      </div>

      <AdmissionDateBackfillPanel
        isAuditing={isAuditingAdmissionDates}
        isApplying={isApplyingAdmissionDates}
        result={admissionDateBackfillResult}
        error={admissionDateBackfillError}
        progress={backfillProgress}
        onAudit={() => void handleAuditAdmissionDates()}
        onApply={() => void handleApplyAdmissionDates()}
      />

      {/* Warning Section */}
      <div className="bg-amber-50 border-2 border-amber-100 rounded-3xl p-6 flex items-start gap-4">
        <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
          <Info className="text-amber-600" size={20} />
        </div>
        <div>
          <h4 className="text-sm font-bold text-amber-900 mb-1">Información Importante</h4>
          <p className="text-xs text-amber-800 leading-relaxed">
            Estos archivos JSON contienen información clínica sensible. Deben ser almacenados en
            ubicaciones seguras y protegidas. Al importar, el sistema sincronizará automáticamente
            los datos con la base de datos central de Firebase, lo que actualizará la información
            para todos los usuarios.
          </p>
        </div>
      </div>

      {/* Modals */}
      <DataImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onSuccess={() => {
          // Could trigger a global refresh if needed
        }}
      />
    </div>
  );
};
