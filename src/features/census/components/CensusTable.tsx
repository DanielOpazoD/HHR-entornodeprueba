import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CensusTableHeader } from '@/features/census/components/CensusTableHeader';
import { CensusTableBody } from '@/features/census/components/CensusTableBody';
import { useCensusTableBindingsModel } from '@/features/census/hooks/useCensusTableBindingsModel';
import { DragDropConfirmation } from '@/features/census/drag-drop/DragDropConfirmation';
import { useCensusTableDragDrop } from '@/features/census/drag-drop/useCensusTableDragDrop';
import { useDailyRecordBeds, useDailyRecordData } from '@/context/DailyRecordContext';
import { useDailyRecordBedActions } from '@/context/useDailyRecordScopedActions';
import { ViewLoader } from '@/components/ui/ViewLoader';
import type { CensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { resolveEmptyBedSaveAction } from '@/features/census/controllers/admitPatientGate';
import { useAdmitPatient } from '@/hooks/useAdmitPatient';
import { useNotification } from '@/context/UIContext';
import { isFeatureEnabled } from '@/services/utils/featureFlags';
import { createScopedLogger } from '@/services/utils/loggerScope';
import type { PatientData } from '@/features/census/components/patient-row/patientRowContracts';
import { useDailyRecordFreshnessUi } from '@/hooks/useDailyRecordFreshnessUi';
import { Eye } from 'lucide-react';
import {
  filterCensusRowsByAttention,
  getCensusAttentionFilterLabel,
  type CensusAttentionFilter,
} from '@/features/census/controllers/rowAcuityController';
import {
  buildEloisaPatientDisplayName,
  findManualPatientDuplicate,
  type EloisaManualPatientPayload,
} from '@/features/rayen-manual-import';
import { mapRayenInvasiveDeviceEntries, mergeReportDevices } from '@/features/rayen-import';

const censusTableAdmitLogger = createScopedLogger('CensusTableAdmit');
export type { DiagnosisMode } from '@/features/census/types/censusTableTypes';

const LazyDemographicsModal = lazy(() =>
  import('@/components/modals/DemographicsModal').then(module => ({
    default: module.DemographicsModal,
  }))
);
const LazyEloisaPatientCodeImportModal = lazy(() =>
  import('@/features/rayen-manual-import').then(module => ({
    default: module.EloisaPatientCodeImportModal,
  }))
);

interface CensusTableProps {
  currentDateString: string;
  readOnly?: boolean;
  accessProfile?: CensusAccessProfile;
  attentionFilter?: CensusAttentionFilter;
  onClearAttentionFilter?: () => void;
}

export const CensusTable: React.FC<CensusTableProps> = ({
  currentDateString,
  readOnly = false,
  accessProfile = 'default',
  attentionFilter = 'all',
  onClearAttentionFilter,
}) => {
  const [activeEmptyBedId, setActiveEmptyBedId] = useState<string | null>(null);
  const [isEloisaCodeImportOpen, setIsEloisaCodeImportOpen] = useState(false);
  const tableRootRef = useRef<HTMLDivElement>(null);
  const freshnessUi = useDailyRecordFreshnessUi(currentDateString);
  const clinicalEditingDisabled = freshnessUi.isClinicalEditingBlocked;
  const { isReady, bindings, clinicalDocumentInfoByBedId } = useCensusTableBindingsModel({
    currentDateString,
    readOnly,
    clinicalEditingDisabled,
    clinicalFieldLocksByBedId: freshnessUi.clinicalFieldLocksByBedId,
    accessProfile,
  });

  const { moveOrCopyPatient, updatePatientMultiple } = useDailyRecordBedActions();
  const { record } = useDailyRecordData();
  const beds = useDailyRecordBeds();
  const admitPatient = useAdmitPatient();
  const { error: notifyError, success: notifySuccess } = useNotification();

  const handleMoveToBed = useCallback(
    (sourceBedId: string, targetBedId: string) => {
      moveOrCopyPatient('move', sourceBedId, targetBedId);
    },
    [moveOrCopyPatient]
  );

  const dragDrop = useCensusTableDragDrop(handleMoveToBed, beds ?? {});

  useEffect(() => {
    const hasHardContextReset = Object.values(freshnessUi.clinicalFieldLocksByBedId).some(
      locks => locks.allClinical
    );
    const activeElement = document.activeElement;
    if (
      hasHardContextReset &&
      activeElement instanceof HTMLElement &&
      tableRootRef.current?.contains(activeElement)
    ) {
      activeElement.blur();
    }
  }, [freshnessUi.clinicalFieldLocksByBedId]);

  const emptyBedData = useMemo(
    () => (activeEmptyBedId ? createEmptyPatient(activeEmptyBedId) : null),
    [activeEmptyBedId]
  );

  const closeEmptyBedDemographics = useCallback(() => {
    setActiveEmptyBedId(null);
  }, []);

  const openEmptyBedDemographics = useCallback(
    (bedId: string) => {
      if (clinicalEditingDisabled) {
        return;
      }
      setActiveEmptyBedId(bedId);
    },
    [clinicalEditingDisabled]
  );

  const openEloisaCodeImport = useCallback(() => {
    setActiveEmptyBedId(null);
    setIsEloisaCodeImportOpen(true);
  }, []);

  const emptyBedOptions = useMemo(
    () =>
      Object.entries(beds ?? {})
        .filter(([, patient]) => !patient?.patientName?.trim() && !patient?.isBlocked)
        .map(([bedId, patient]) => ({ id: bedId, label: patient?.bedName || bedId })),
    [beds]
  );

  const importEloisaPatient = useCallback(
    async (payload: EloisaManualPatientPayload, targetBedId: string): Promise<string | null> => {
      const target = record?.beds?.[targetBedId];
      if (!target || target.patientName?.trim() || target.isBlocked) {
        return 'La cama seleccionada ya no está disponible. Actualiza la selección.';
      }
      const duplicate = findManualPatientDuplicate(record, payload);
      if (duplicate) {
        return duplicate.kind === 'rut'
          ? `Este RUT ya está presente en la cama ${duplicate.bedId}. No se creó otro ingreso.`
          : `Este episodio de Eloísa ya está presente en la cama ${duplicate.bedId}.`;
      }
      const patientName = buildEloisaPatientDisplayName(payload);
      const patientWithDevices = mergeReportDevices(
        {
          ...createEmptyPatient(targetBedId),
          patientName,
          rut: payload.rut,
          clinicalEpisodeId: payload.encounterId,
        },
        mapRayenInvasiveDeviceEntries(payload.deviceEntries),
        {
          now: new Date(),
          createId: () => globalThis.crypto.randomUUID(),
        }
      );
      const outcome = await admitPatient({
        bedId: targetBedId,
        patientName,
        firstName: [payload.firstName, payload.middleNames].filter(Boolean).join(' '),
        lastName: payload.lastName,
        secondLastName: payload.secondLastName,
        rut: payload.rut,
        birthDate: payload.birthDate,
        biologicalSex: payload.biologicalSex,
        admissionDate: payload.admissionDate,
        admissionTime: payload.admissionTime,
        pathology: payload.diagnosis,
        devices: patientWithDevices.devices.length ? patientWithDevices.devices : payload.devices,
        deviceDetails: patientWithDevices.deviceDetails,
        deviceInstanceHistory: patientWithDevices.deviceInstanceHistory,
        clinicalEpisodeId: payload.encounterId,
        eloisaManualAdmissionSource: {
          method: 'eloisa_manual_code',
          capturedAt: payload.capturedAt,
          formatVersion: payload.version,
          encounterId: payload.encounterId,
          encounterRoute: payload.encounterRoute,
        },
        recordDate: currentDateString,
        baseRecord: record,
      });
      if (outcome.status.status === 'ready' || outcome.status.status === 'degraded') {
        setIsEloisaCodeImportOpen(false);
        notifySuccess('Paciente incorporado', `Se agregó a la cama ${targetBedId}.`);
        return null;
      }
      return (
        outcome.applicationOutcome.userSafeMessage ||
        outcome.applicationOutcome.issues[0]?.message ||
        'No se pudo guardar el paciente. No se realizó una escritura parcial.'
      );
    },
    [admitPatient, currentDateString, notifySuccess, record]
  );

  const saveEmptyBedDemographics = useCallback(
    async (updatedFields: Partial<PatientData>) => {
      if (!activeEmptyBedId) {
        return;
      }

      const action = resolveEmptyBedSaveAction({
        updatedFields,
        isAdmitCommandEnabled: isFeatureEnabled('USE_ADMIT_PATIENT_COMMAND'),
      });

      switch (action.kind) {
        case 'noop':
          closeEmptyBedDemographics();
          return;
        case 'admit-command': {
          const outcome = await admitPatient({
            bedId: activeEmptyBedId,
            patientName: action.input.patientName,
            rut: action.input.rut,
            admissionDate: action.input.admissionDate,
            pathology: action.input.pathology,
            recordDate: currentDateString,
            baseRecord: record,
          });
          if (outcome.status.status === 'ready' || outcome.status.status === 'degraded') {
            closeEmptyBedDemographics();
            return;
          }
          // Command rejected the input (blocked / failed). Surface the
          // typed userSafeMessage to the clinician; do NOT fall back to
          // the legacy dispatch, otherwise we would silently bypass the
          // command's guard (e.g., anonymous actor) the user is trying
          // to enforce.
          censusTableAdmitLogger.warn('admitPatientCommand rejected', {
            bedId: activeEmptyBedId,
            outcomeStatus: outcome.status.status,
            issues: outcome.applicationOutcome.issues,
          });
          notifyError(
            'No se pudo registrar la admisión',
            outcome.applicationOutcome.userSafeMessage ||
              outcome.applicationOutcome.issues[0]?.message ||
              'Revisa los datos e intenta nuevamente.'
          );
          return;
        }
        case 'legacy-dispatch':
          updatePatientMultiple(activeEmptyBedId, action.input);
          closeEmptyBedDemographics();
          return;
      }
    },
    [
      activeEmptyBedId,
      admitPatient,
      closeEmptyBedDemographics,
      currentDateString,
      notifyError,
      record,
      updatePatientMultiple,
    ]
  );

  if (!isReady || !bindings) return <ViewLoader />;

  const { headerProps, bodyProps, tableStyle } = bindings;
  const filteredUnifiedRows = filterCensusRowsByAttention(
    bodyProps.unifiedRows,
    currentDateString,
    attentionFilter
  );
  const activeAttentionLabel =
    attentionFilter === 'all' ? null : getCensusAttentionFilterLabel(attentionFilter);

  return (
    <div
      ref={tableRootRef}
      className="overflow-visible rounded-xl bg-white print:shadow-none"
    >
      <div className="relative overflow-visible">
        {freshnessUi.userMessage ? (
          <div
            className={`mb-2 rounded-md border px-3 py-2 text-sm ${
              freshnessUi.messageLevel === 'warning'
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-sky-100 bg-sky-50 text-sky-700'
            }`}
            role="status"
            aria-live="polite"
          >
            {freshnessUi.userMessage}
          </div>
        ) : null}
        {activeAttentionLabel ? (
          <div
            className="flex min-h-8 items-center justify-between gap-3 rounded-t-xl border-b border-slate-200 bg-slate-50/90 px-3 py-1 text-xs text-slate-700"
            data-testid="census-vigilance-mode-banner"
            role="status"
          >
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <Eye size={14} className="text-amber-600" aria-hidden="true" />
              {activeAttentionLabel}
              <span className="font-normal text-slate-500">
                · {filteredUnifiedRows.length}{' '}
                {filteredUnifiedRows.length === 1 ? 'paciente visible' : 'pacientes visibles'}
              </span>
            </span>
            {onClearAttentionFilter ? (
              <button
                type="button"
                onClick={onClearAttentionFilter}
                className="rounded-md px-2 py-1 font-semibold text-teal-700 transition-colors hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-600"
              >
                Ver censo completo
              </button>
            ) : null}
          </div>
        ) : null}
        <div
          className="census-table-scroll"
          role="region"
          aria-label="Censo de pacientes, tabla desplazable"
          tabIndex={0}
          onKeyDown={event => {
            if (event.target !== event.currentTarget) return;
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.scrollBy({ left: event.key === 'ArrowRight' ? 240 : -240 });
          }}
        >
          <table
            data-testid="census-table"
            className="text-left border-collapse print:text-xs relative text-[12px] leading-tight table-fixed"
            style={
              {
                ...tableStyle,
                '--census-table-width': parseFloat(String(tableStyle.width)),
              } as React.CSSProperties
            }
          >
            <CensusTableHeader {...headerProps} />
            <CensusTableBody
              {...bodyProps}
              recordLastUpdated={record?.lastUpdated}
              unifiedRows={filteredUnifiedRows}
              onActivateEmptyBed={openEmptyBedDemographics}
              dragDrop={readOnly || clinicalEditingDisabled ? undefined : dragDrop}
              clinicalDocumentInfoByBedId={clinicalDocumentInfoByBedId}
            />
          </table>
        </div>
      </div>

      {dragDrop.state.pendingMove && (
        <DragDropConfirmation
          move={dragDrop.state.pendingMove}
          onConfirm={dragDrop.confirmationHandlers.onConfirm}
          onCancel={dragDrop.confirmationHandlers.onCancel}
        />
      )}

      {activeEmptyBedId && emptyBedData ? (
        <Suspense fallback={null}>
          <LazyDemographicsModal
            isOpen
            onClose={closeEmptyBedDemographics}
            onCancel={closeEmptyBedDemographics}
            onEmptySave={closeEmptyBedDemographics}
            data={emptyBedData}
            onSave={saveEmptyBedDemographics}
            bedId={activeEmptyBedId}
            recordDate={currentDateString}
            requiresCompleteDemographics
            onImportEloisaCode={openEloisaCodeImport}
          />
        </Suspense>
      ) : null}

      {isEloisaCodeImportOpen ? (
        <Suspense fallback={null}>
          <LazyEloisaPatientCodeImportModal
            isOpen
            emptyBeds={emptyBedOptions}
            onClose={() => setIsEloisaCodeImportOpen(false)}
            onConfirm={importEloisaPatient}
          />
        </Suspense>
      ) : null}
    </div>
  );
};
