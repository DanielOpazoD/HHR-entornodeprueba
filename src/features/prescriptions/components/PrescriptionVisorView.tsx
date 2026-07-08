import React, { useCallback, useState } from 'react';
import { ArrowLeft, FileDown, Grid3x3, Inbox, List, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { executeReassignPrescriptionPatient } from '@/application/prescriptions/reassignPrescriptionPatientUseCase';
import { executeDeletePrescription } from '@/application/prescriptions/deletePrescriptionUseCase';
import { executeUpdatePrescriptionType } from '@/application/prescriptions/updatePrescriptionTypeUseCase';
import { type PrescriptionRecord, type PrescriptionType } from '@/types/prescriptionTypes';
import { usePrescriptionListController } from '@/features/prescriptions/hooks/usePrescriptionListController';
import {
  exportMonthlyPrescriptionsPdf,
  type PrescriptionMonthlyPdfColorMode,
  type PrescriptionMonthlyPdfImageQuality,
  type PrescriptionsPerPageOption,
} from '@/features/prescriptions/services/prescriptionMonthlyPdfService';
import { PrescriptionListItem } from '@/features/prescriptions/components/PrescriptionListItem';
import { PrescriptionDetailModal } from '@/features/prescriptions/components/PrescriptionDetailModal';
import { PrescriptionDateStrip } from '@/features/prescriptions/components/PrescriptionDateStrip';
import { PrescriptionBedGridView } from '@/features/prescriptions/components/PrescriptionBedGridView';
import { PrescriptionMonthlyPdfOptionsPanel } from '@/features/prescriptions/components/PrescriptionMonthlyPdfOptionsPanel';
import {
  buildMonthlyPdfOptions,
  loadStoredMonthlyPdfOptions,
  persistMonthlyPdfOptions,
} from '@/features/prescriptions/components/prescriptionVisorPdfOptions';

type VisorMode = 'list' | 'bed-grid';

export const PrescriptionVisorView: React.FC = () => {
  const auth = useAuth();
  const controller = usePrescriptionListController();
  const [storedPdfOptions] = useState(loadStoredMonthlyPdfOptions);
  const [selected, setSelected] = useState<PrescriptionRecord | null>(null);
  const [mode, setMode] = useState<VisorMode>('bed-grid');
  const [isExportingMonthlyPdf, setIsExportingMonthlyPdf] = useState(false);
  const [showPdfOptions, setShowPdfOptions] = useState(false);
  const [monthlyPdfError, setMonthlyPdfError] = useState<string | null>(null);
  const [monthlyPdfWarning, setMonthlyPdfWarning] = useState<string | null>(null);
  const initialPdfOptions = buildMonthlyPdfOptions(storedPdfOptions);
  const [prescriptionsPerPage, setPrescriptionsPerPage] = useState<PrescriptionsPerPageOption>(
    initialPdfOptions.prescriptionsPerPage
  );
  const [pdfColorMode, setPdfColorMode] = useState<PrescriptionMonthlyPdfColorMode>(
    initialPdfOptions.colorMode
  );
  const [pdfImageQuality, setPdfImageQuality] = useState<PrescriptionMonthlyPdfImageQuality>(
    initialPdfOptions.imageQuality
  );

  const canEdit = auth.role === 'admin' || auth.role === 'nurse_hospital' || auth.isEditor;
  const canDelete = auth.role === 'admin' || auth.role === 'nurse_hospital';

  const handleReassign = useCallback(
    async (patch: {
      bedId?: string;
      patientName?: string;
      patientRut?: string;
      clear: boolean;
    }) => {
      if (!selected) return;
      const reassignedBy = auth.currentUser?.email ?? auth.currentUser?.uid ?? 'desconocido';
      const updated = await executeReassignPrescriptionPatient({
        prescriptionId: selected.id,
        bedId: patch.clear ? undefined : patch.bedId,
        patientName: patch.clear ? undefined : patch.patientName,
        patientRut: patch.clear ? undefined : patch.patientRut,
        reassignedBy,
      });
      setSelected(updated);
    },
    [auth.currentUser, selected]
  );

  const handleUpdateType = useCallback(
    async (nextType: PrescriptionType) => {
      if (!selected) return;
      const updatedBy = auth.currentUser?.email ?? auth.currentUser?.uid ?? 'desconocido';
      const updated = await executeUpdatePrescriptionType({
        prescriptionId: selected.id,
        prescriptionType: nextType,
        updatedBy,
      });
      setSelected(updated);
    },
    [auth.currentUser, selected]
  );

  const handleGridAssign = useCallback(
    async (
      record: PrescriptionRecord,
      target: { bedId: string; patientName: string; patientRut: string }
    ) => {
      const reassignedBy = auth.currentUser?.email ?? auth.currentUser?.uid ?? 'desconocido';
      await executeReassignPrescriptionPatient({
        prescriptionId: record.id,
        bedId: target.bedId,
        patientName: target.patientName || undefined,
        patientRut: target.patientRut || undefined,
        reassignedBy,
      });
    },
    [auth.currentUser]
  );

  const handleGridReassign = useCallback(
    async (
      record: PrescriptionRecord,
      patch: {
        bedId?: string;
        patientName?: string;
        patientRut?: string;
        clear: boolean;
      }
    ) => {
      const reassignedBy = auth.currentUser?.email ?? auth.currentUser?.uid ?? 'desconocido';
      await executeReassignPrescriptionPatient({
        prescriptionId: record.id,
        bedId: patch.clear ? undefined : patch.bedId,
        patientName: patch.clear ? undefined : patch.patientName,
        patientRut: patch.clear ? undefined : patch.patientRut,
        reassignedBy,
      });
    },
    [auth.currentUser]
  );

  const handleGridAssignStock = useCallback(
    async (record: PrescriptionRecord) => {
      const reassignedBy = auth.currentUser?.email ?? auth.currentUser?.uid ?? 'desconocido';
      await executeReassignPrescriptionPatient({
        prescriptionId: record.id,
        assignmentScope: 'hospitalized_stock',
        reassignedBy,
      });
    },
    [auth.currentUser]
  );

  const handleGridUpdateType = useCallback(
    async (record: PrescriptionRecord, nextType: PrescriptionType) => {
      const updatedBy = auth.currentUser?.email ?? auth.currentUser?.uid ?? 'desconocido';
      await executeUpdatePrescriptionType({
        prescriptionId: record.id,
        prescriptionType: nextType,
        updatedBy,
      });
    },
    [auth.currentUser]
  );

  const handleGridDelete = useCallback(
    async (record: PrescriptionRecord) => {
      const deletedBy = auth.currentUser?.email ?? auth.currentUser?.uid ?? 'anon';
      await executeDeletePrescription({ prescriptionId: record.id, deletedBy });
    },
    [auth.currentUser]
  );

  const handleDelete = useCallback(async () => {
    if (!selected) return;
    const deletedBy = auth.currentUser?.email ?? auth.currentUser?.uid ?? 'anon';
    await executeDeletePrescription({ prescriptionId: selected.id, deletedBy });
  }, [auth.currentUser, selected]);

  const handleExportMonthlyPdf = useCallback(async () => {
    setIsExportingMonthlyPdf(true);
    setMonthlyPdfError(null);
    setMonthlyPdfWarning(null);
    const selectedPdfOptions = {
      prescriptionsPerPage,
      colorMode: pdfColorMode,
      imageQuality: pdfImageQuality,
    };
    persistMonthlyPdfOptions(selectedPdfOptions);
    try {
      const result = await exportMonthlyPrescriptionsPdf({
        records: controller.records,
        selectedDateIso: controller.filters.selectedDate,
        options: selectedPdfOptions,
      });
      if (result.optimizationFallbackCount > 0) {
        const imageLabel = result.optimizationFallbackCount === 1 ? 'imagen' : 'imágenes';
        const verb = result.optimizationFallbackCount === 1 ? 'se imprimirá' : 'se imprimirán';
        setMonthlyPdfWarning(
          `${result.optimizationFallbackCount} ${imageLabel} ${verb} en calidad original por error de optimización.`
        );
      }
    } catch (caught) {
      setMonthlyPdfError(
        caught instanceof Error ? caught.message : 'No se pudo generar el PDF mensual.'
      );
    } finally {
      setIsExportingMonthlyPdf(false);
      setShowPdfOptions(false);
    }
  }, [
    controller.filters.selectedDate,
    controller.records,
    pdfColorMode,
    pdfImageQuality,
    prescriptionsPerPage,
  ]);

  return (
    <main
      data-module="prescriptions-visor"
      className="min-h-screen bg-slate-100 px-3 py-4 sm:px-4 sm:py-6 print:bg-white"
    >
      <div className="mx-auto max-w-3xl space-y-3 sm:space-y-4">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <a
              href="/"
              className="mb-3 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm hover:bg-slate-50"
            >
              <ArrowLeft size={14} /> Volver al censo diario
            </a>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
              Hospitalizados · Recetas
            </p>
            <h1 className="text-lg font-bold text-slate-800 sm:text-xl">Visor de respaldos</h1>
            <p className="text-xs text-slate-500">
              {controller.totalCount === 0
                ? 'Aún no hay recetas registradas.'
                : `${controller.filteredRecords.length} de ${controller.totalCount} receta(s)`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto sm:justify-end">
            <button
              type="button"
              onClick={() => setShowPdfOptions(prev => !prev)}
              disabled={isExportingMonthlyPdf || controller.phase === 'loading'}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800 shadow-sm transition-colors hover:bg-sky-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
              aria-label="Grabar PDF mensual"
              title="Grabar PDF mensual"
            >
              {isExportingMonthlyPdf ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <FileDown size={14} />
              )}
              PDF mensual
            </button>
            <div
              role="tablist"
              aria-label="Modo de vista"
              className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm"
            >
              <button
                role="tab"
                type="button"
                aria-selected={mode === 'list'}
                onClick={() => setMode('list')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  mode === 'list' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                <List size={14} /> Lista
              </button>
              <button
                role="tab"
                type="button"
                aria-selected={mode === 'bed-grid'}
                onClick={() => setMode('bed-grid')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  mode === 'bed-grid'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                <Grid3x3 size={14} /> Por cama
              </button>
            </div>
          </div>
        </header>

        {showPdfOptions && (
          <PrescriptionMonthlyPdfOptionsPanel
            colorMode={pdfColorMode}
            imageQuality={pdfImageQuality}
            isExporting={isExportingMonthlyPdf}
            onCancel={() => setShowPdfOptions(false)}
            onColorModeChange={setPdfColorMode}
            onExport={handleExportMonthlyPdf}
            onImageQualityChange={setPdfImageQuality}
            onPrescriptionsPerPageChange={setPrescriptionsPerPage}
            prescriptionsPerPage={prescriptionsPerPage}
          />
        )}

        {monthlyPdfError && (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
          >
            {monthlyPdfError}
          </p>
        )}

        {monthlyPdfWarning && (
          <p
            role="status"
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800"
          >
            {monthlyPdfWarning}
          </p>
        )}

        <PrescriptionDateStrip
          selectedDate={controller.filters.selectedDate}
          onSelectDate={isoDate => controller.setFilter('selectedDate', isoDate)}
          records={controller.records}
        />

        {mode === 'list' ? (
          <section className="space-y-2">
            {controller.phase === 'loading' ? (
              <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
                Cargando respaldos…
              </p>
            ) : controller.filteredRecords.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
                <Inbox size={28} className="text-slate-300" />
                {controller.totalCount === 0
                  ? 'Todavía no hay recetas en el respaldo.'
                  : 'No hay recetas para el día seleccionado.'}
              </div>
            ) : (
              controller.filteredRecords.map(record => (
                <PrescriptionListItem key={record.id} record={record} onSelect={setSelected} />
              ))
            )}
          </section>
        ) : (
          <PrescriptionBedGridView
            records={controller.filteredRecords}
            dayIso={controller.filters.selectedDate}
            onAssign={canEdit ? handleGridAssign : undefined}
            onReassign={canEdit ? handleGridReassign : undefined}
            onAssignStock={canEdit ? handleGridAssignStock : undefined}
            onUpdateType={canEdit ? handleGridUpdateType : undefined}
            onDelete={canDelete ? handleGridDelete : undefined}
          />
        )}
      </div>

      {selected && (
        <PrescriptionDetailModal
          record={selected}
          canEdit={canEdit}
          canDelete={canDelete}
          onClose={() => setSelected(null)}
          onReassign={handleReassign}
          onDelete={handleDelete}
          onUpdateType={handleUpdateType}
          selectedDate={controller.filters.selectedDate}
        />
      )}
    </main>
  );
};

export default PrescriptionVisorView;
