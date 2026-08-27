import React from 'react';
import { BarChart3, Loader2, RotateCcw, Save } from 'lucide-react';
import { CudyrHeader } from './CudyrHeader';
import { CudyrRow, VerticalHeader } from './CudyrRow';
import { useCudyrLogic } from '../hooks/useCudyrLogic';
import { resolveNightShiftNurses } from '@/services/staff/dailyRecordStaffing';
import { buildCudyrViewShellModel } from '@/features/cudyr/controllers/cudyrViewController';

interface CudyrViewProps {
  readOnly?: boolean;
}

export const CudyrView: React.FC<CudyrViewProps> = ({ readOnly = false }) => {
  const {
    record,
    visibleBeds,
    stats,
    cudyrSummary,
    isEditingLocked,
    isCompletionLocked,
    persistedCompletion,
    pendingCudyrChangeCount,
    isSavingCudyrChanges,
    handleScoreChange,
    handleCribScoreChange,
    saveCudyrChanges,
    discardCudyrChanges,
    saveAdminCudyrResult,
    canAdminAdjustCudyrResult,
    adminCudyrMutationKey,
    resolveCudyrEligibility,
  } = useCudyrLogic(readOnly);

  if (!record) {
    return (
      <div className="p-8 text-center text-slate-500">
        Seleccione una fecha con registros para ver el CUDYR.
      </div>
    );
  }

  const isCalculatedComplete = Boolean(persistedCompletion?.isComplete);
  const completionTimestamp = record.cudyrCompletedAt;
  const completionOwner = record.cudyrCompletedBy;
  const hasConfirmedCompletion = Boolean(
    isCalculatedComplete &&
    record.cudyrLocked &&
    completionTimestamp &&
    !Number.isNaN(Date.parse(completionTimestamp)) &&
    completionOwner?.trim()
  );

  const responsibleNurses = resolveNightShiftNurses(record).filter(n => n && n.trim() !== '');
  const shellModel = buildCudyrViewShellModel({
    recordDate: record.date,
    responsibleNurses,
    occupiedCount: stats.occupiedCount,
    categorizedCount: stats.categorizedCount,
  });

  return (
    <div className="space-y-4 animate-fade-in pb-20 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 print:max-w-none print:px-0 print:space-y-2 print:pb-0 print:break-inside-avoid">
      {/* Print-only Header */}
      <div className="hidden print:block mb-2 pb-2 border-b border-slate-300">
        <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-1">
          <BarChart3 size={20} className="text-medical-600" />
          Instrumento CUDYR del último registro disponible
        </h1>
        <div className="flex items-center gap-4 text-sm text-slate-700">
          <span className="font-semibold">Fecha: {shellModel.formattedPrintDate}</span>
          <span className="text-slate-400">|</span>
          <span>
            <span className="font-semibold">Enfermeros/as: </span>
            {shellModel.hasResponsibleNurses ? (
              shellModel.responsibleNursesLabel
            ) : (
              <span className="italic text-slate-400">No registrados</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-600 mt-1">
          <span>
            Ocupadas: <strong>{stats.occupiedCount}</strong>
          </span>
          <span className="text-slate-400">|</span>
          <span>
            Categorizados: <strong>{stats.categorizedCount}</strong>
          </span>
          <span className="text-slate-400">|</span>
          <span>
            Índice: <strong>{shellModel.categorizationIndex}%</strong>
          </span>
        </div>
      </div>

      {/* Screen header — title, stats bar, actions (replaces old separate summary) */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 overflow-hidden print:shadow-none print:border-none print:p-0 print:break-inside-avoid">
        <div className="print:hidden">
          <CudyrHeader
            occupiedCount={stats.occupiedCount}
            categorizedCount={stats.categorizedCount}
            currentDate={record.date}
            updatedAt={record.cudyrUpdatedAt}
            updatedBy={record.cudyrUpdatedBy}
            completedAt={hasConfirmedCompletion ? completionTimestamp : undefined}
            completedBy={hasConfirmedCompletion ? completionOwner : undefined}
            isCompletionLocked={hasConfirmedCompletion}
            completedCount={persistedCompletion?.completedCount ?? 0}
            eligibleCount={persistedCompletion?.eligibleCount ?? 0}
            categoryCounts={cudyrSummary?.counts}
            currentRecord={record}
          />
        </div>

        {isCompletionLocked && hasConfirmedCompletion && (
          <div
            className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 print:hidden"
            data-testid="cudyr-completion-lock-notice"
          >
            <strong>CUDYR cerrado.</strong> Los resultados del turno noche {record.date} están
            sincronizados y en modo lectura para enfermería.
          </div>
        )}

        {isCompletionLocked && !hasConfirmedCompletion && (
          <div
            className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 print:hidden"
            data-testid="cudyr-legacy-lock-notice"
          >
            <strong>
              {isCalculatedComplete
                ? 'CUDYR completo sin cierre atribuido (registro legado).'
                : 'CUDYR bloqueado incompleto (registro legado).'}
            </strong>{' '}
            La planilla permanece en solo lectura y registra{' '}
            {persistedCompletion?.completedCount ?? 0} de {persistedCompletion?.eligibleCount ?? 0}{' '}
            pacientes elegibles completos.
          </div>
        )}

        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full text-left text-xs border-collapse border border-slate-300 min-w-[900px] print:table-auto print:min-w-0 print:text-[7px]">
            <thead>
              <tr>
                <th
                  colSpan={2}
                  className="bg-slate-100 border border-slate-300 p-2 text-center font-bold text-slate-700 print:bg-white print:p-1"
                >
                  PACIENTE
                </th>
                <th
                  colSpan={6}
                  className="bg-blue-50 border border-blue-200 p-2 text-center font-bold text-blue-800 print:bg-white print:text-black print:border-slate-300 print:p-1"
                >
                  PUNTOS DEPENDENCIA (0-3)
                </th>
                <th
                  colSpan={8}
                  className="bg-red-50 border border-red-200 p-2 text-center font-bold text-red-800 print:bg-white print:text-black print:border-slate-300 print:p-1"
                >
                  PUNTOS DE RIESGO (0-3)
                </th>
                <th
                  colSpan={3}
                  className="bg-slate-100 border border-slate-300 p-2 text-center font-bold text-slate-700 print:hidden"
                >
                  RESULTADOS
                </th>
                <th className="bg-slate-100 border border-slate-300 p-2 text-center font-bold text-slate-700 hidden print:table-cell print:bg-white print:p-1">
                  CAT
                </th>
              </tr>
              <tr className="text-center">
                <th className="border border-slate-300 p-1 w-10 bg-slate-50 align-middle print:w-auto">
                  CAMA
                </th>
                <th className="border border-slate-300 p-1 w-[100px] max-w-[100px] bg-slate-50 align-middle print:w-[88px] print:max-w-[88px]">
                  <span className="print:hidden">NOMBRE</span>
                  <span className="hidden print:inline">RUT</span>
                </th>
                <VerticalHeader text="Cuidados Cambio Ropa" colorClass="bg-blue-50/50" />
                <VerticalHeader text="Cuidados de Movilización" colorClass="bg-blue-50/50" />
                <VerticalHeader text="Cuidados de Alimentación" colorClass="bg-blue-50/50" />
                <VerticalHeader text="Cuidados de Eliminación" colorClass="bg-blue-50/50" />
                <VerticalHeader text="Apoyo Psicosocial y Emocional" colorClass="bg-blue-50/50" />
                <VerticalHeader text="Vigilancia" colorClass="bg-blue-50/50" />
                <VerticalHeader text="Medicición Signos Vitales" colorClass="bg-red-50/50" />
                <VerticalHeader text="Balance Hìdrico" colorClass="bg-red-50/50" />
                <VerticalHeader text="Cuidados de Oxigenoterapia" colorClass="bg-red-50/50" />
                <VerticalHeader text="Cuidados diarios de Vía Aérea" colorClass="bg-red-50/50" />
                <VerticalHeader text="Intervenciones Profesionales" colorClass="bg-red-50/50" />
                <VerticalHeader text="Cuidados de la Piel y Curaciones" colorClass="bg-red-50/50" />
                <VerticalHeader text="Administración Tto Farmacológico" colorClass="bg-red-50/50" />
                <VerticalHeader text="Presencia Elem. Invasivos" colorClass="bg-red-50/50" />
                <th className="border border-slate-300 p-1 w-12 bg-slate-50 text-blue-800 align-middle print:hidden">
                  P.DEP
                </th>
                <th className="border border-slate-300 p-1 w-12 bg-slate-50 text-red-800 align-middle print:hidden">
                  P.RIES
                </th>
                <th className="border border-slate-300 p-1 w-14 bg-slate-50 align-middle print:w-auto print:p-0.5 print:bg-white">
                  CAT
                </th>
              </tr>
            </thead>
            <tbody>
              {pendingCudyrChangeCount > 0 && (
                <tr data-testid="cudyr-pending-save-row" className="print:hidden">
                  <td colSpan={19} className="border border-amber-200 bg-amber-50/70 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="rounded-md border border-amber-200 bg-white/80 px-3 py-1.5 text-sm font-bold text-amber-800">
                        {pendingCudyrChangeCount}{' '}
                        {pendingCudyrChangeCount === 1 ? 'cambio pendiente' : 'cambios pendientes'}
                      </span>
                      <div className="flex-1" />
                      <button
                        type="button"
                        onClick={discardCudyrChanges}
                        disabled={isSavingCudyrChanges}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-[13px] font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
                      >
                        <RotateCcw size={14} />
                        Descartar
                      </button>
                      <button
                        type="button"
                        onClick={saveCudyrChanges}
                        disabled={isSavingCudyrChanges}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-[13px] font-extrabold text-white shadow-sm transition-all hover:bg-blue-700 active:scale-95 disabled:cursor-wait disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        {isSavingCudyrChanges ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Save size={14} />
                        )}
                        {isSavingCudyrChanges ? 'Guardando...' : 'Guardar CUDYR'}
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              {visibleBeds.map(bed => {
                const patient = record.beds[bed.id];
                const patientEligibility = resolveCudyrEligibility(patient);
                const hasCrib = !!patient?.clinicalCrib?.patientName;
                const cribPatient = patient?.clinicalCrib;
                const cribEligibility = resolveCudyrEligibility(cribPatient);

                return (
                  <React.Fragment key={bed.id}>
                    <CudyrRow
                      bed={bed}
                      patient={patient}
                      censusDate={record.date}
                      onScoreChange={handleScoreChange}
                      readOnly={isEditingLocked || patientEligibility.isBlocked}
                      eligibilityBlocked={patientEligibility.isBlocked}
                      eligibilityBlockedReason={patientEligibility.blockedReason}
                      adminBedId={bed.id}
                      canAdminAdjustResult={canAdminAdjustCudyrResult}
                      adminCudyrBusy={Boolean(adminCudyrMutationKey)}
                      onAdminCudyrResultSave={saveAdminCudyrResult}
                    />
                    {hasCrib && cribPatient && (
                      <CudyrRow
                        bed={{ ...bed, id: `${bed.id}-crib`, name: `${bed.name} (CC)` }}
                        patient={cribPatient}
                        censusDate={record.date}
                        onScoreChange={(_, field, value) =>
                          handleCribScoreChange(bed.id, field, value)
                        }
                        readOnly={isEditingLocked || cribEligibility.isBlocked}
                        eligibilityBlocked={cribEligibility.isBlocked}
                        eligibilityBlockedReason={cribEligibility.blockedReason}
                        isCrib={true}
                        adminBedId={bed.id}
                        canAdminAdjustResult={canAdminAdjustCudyrResult}
                        adminCudyrBusy={Boolean(adminCudyrMutationKey)}
                        onAdminCudyrResultSave={saveAdminCudyrResult}
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
