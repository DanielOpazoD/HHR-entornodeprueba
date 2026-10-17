import type { PatientRowSaveResult } from './inputCellTypes';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type {
  CesareanLabor,
  DeliveryRoute,
} from '@/features/census/contracts/censusObstetricContracts';
import type {
  PatientData,
  PatientRowPatientDocumentType,
  PatientRowPatientField,
  PatientRowPatientPatch,
} from '@/features/census/components/patient-row/patientRowContracts';
import { PatientFieldValue } from '@/types/valueTypes';
import {
  buildDeliveryRoutePatch,
  buildPatientRowSaveScopeKey,
  resolveNextDocumentType,
} from '@/features/census/controllers/patientRowInputController';
import {
  buildPatientFieldUpdater,
  buildPatientMultipleUpdater,
} from '@/features/census/controllers/patientRowInputUpdateController';
import { buildPatientRowInputCommands } from '@/features/census/controllers/patientRowInputHandlersController';
import {
  hasPatientRowPatchFields,
  isClinicalInitialBlockField,
} from '@/features/census/controllers/clinicalInitialBlockCoalescingController';
import { harmonizeEpisodeDemographicsHistorySafely } from '@/features/census/controllers/patientDemographicsEpisodeSyncController';
import { isFeatureEnabled } from '@/services/utils/featureFlags';
import { usePatientRowCommandHandlers } from '@/features/census/components/patient-row/usePatientRowCommandHandlers';

const CLINICAL_INITIAL_BLOCK_COALESCE_MS = 400;
const CLINICAL_SUBMISSION_FIELDS = new Set([
  'specialty',
  'pathology',
  'cie10Code',
  'cie10Description',
  'treatingPhysicianId',
  'treatingPhysicianName',
  'dismissedTreatingPhysician',
  'secondarySpecialty',
  'ginecobstetriciaType',
  'deliveryRoute',
  'deliveryDate',
  'deliveryCesareanLabor',
]);

interface UsePatientRowMainInputHandlersParams {
  bedId: string;
  currentDateString: string;
  data: PatientData;
  documentType?: PatientRowPatientDocumentType;
  updatePatient: (bedId: string, field: PatientRowPatientField, value: PatientFieldValue) => void;
  updatePatientMultiple: (bedId: string, fields: PatientRowPatientPatch) => PatientRowSaveResult;
}

interface UsePatientRowCribInputHandlersParams {
  bedId: string;
  currentDateString: string;
  data?: PatientData;
  updateClinicalCrib: (
    bedId: string,
    field: PatientRowPatientField,
    value: PatientFieldValue
  ) => void;
  updateClinicalCribMultiple: (
    bedId: string,
    fields: PatientRowPatientPatch
  ) => PatientRowSaveResult;
}

interface UsePatientRowUpdateAdapterParams {
  bedId: string;
  updateSingle: (bedId: string, field: PatientRowPatientField, value: PatientFieldValue) => void;
  updateMany: (bedId: string, fields: PatientRowPatientPatch) => PatientRowSaveResult;
  coalesceClinicalInitialBlock?: boolean;
  scopeKey: string;
}

const usePatientRowUpdateAdapter = ({
  bedId,
  updateSingle,
  updateMany,
  coalesceClinicalInitialBlock = false,
  scopeKey,
}: UsePatientRowUpdateAdapterParams) => {
  const currentScopeRef = useRef<string | null>(scopeKey);
  useLayoutEffect(() => {
    currentScopeRef.current = scopeKey;
  }, [scopeKey]);
  const pendingClinicalFieldsRef = useRef<PatientRowPatientPatch>({});
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateManyRef = useRef(updateMany);

  useEffect(() => {
    updateManyRef.current = updateMany;
  }, [updateMany]);

  const flushPendingClinicalFields = useCallback(() => {
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }

    const pendingFields = pendingClinicalFieldsRef.current;
    pendingClinicalFieldsRef.current = {};
    if (currentScopeRef.current === scopeKey && hasPatientRowPatchFields(pendingFields)) {
      updateManyRef.current(bedId, pendingFields);
    }
  }, [bedId, scopeKey]);

  const queueClinicalFields = useCallback(
    (fields: PatientRowPatientPatch) => {
      pendingClinicalFieldsRef.current = {
        ...pendingClinicalFieldsRef.current,
        ...fields,
      };

      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
      }

      pendingTimerRef.current = setTimeout(
        flushPendingClinicalFields,
        CLINICAL_INITIAL_BLOCK_COALESCE_MS
      );
    },
    [flushPendingClinicalFields]
  );

  useEffect(() => flushPendingClinicalFields, [flushPendingClinicalFields]);
  useEffect(() => {
    currentScopeRef.current = scopeKey;
    return () => {
      if (currentScopeRef.current === scopeKey) currentScopeRef.current = null;
    };
  }, [scopeKey]);

  const updateField = useMemo(() => {
    const immediateUpdateField = buildPatientFieldUpdater({ bedId, updateSingle });
    return (field: PatientRowPatientField, value: PatientFieldValue) => {
      if (currentScopeRef.current !== scopeKey) return;
      if (field === 'specialty') {
        void updateMany(bedId, { specialty: value as PatientData['specialty'] });
        return;
      }
      if (!coalesceClinicalInitialBlock || !isClinicalInitialBlockField(field)) {
        immediateUpdateField(field, value);
        return;
      }
      queueClinicalFields({ [field]: value });
    };
  }, [
    bedId,
    scopeKey,
    coalesceClinicalInitialBlock,
    queueClinicalFields,
    updateMany,
    updateSingle,
  ]);

  const updateMultiple = useMemo(() => {
    const immediateUpdateMultiple = buildPatientMultipleUpdater({ bedId, updateMany });
    return (fields: PatientRowPatientPatch): PatientRowSaveResult => {
      if (currentScopeRef.current !== scopeKey) return false;
      // A submitted diagnosis supersedes any older inline draft still waiting for its timer.
      if (Object.prototype.hasOwnProperty.call(fields, 'pathology')) {
        delete pendingClinicalFieldsRef.current.pathology;
        if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      // Identity/admission forms retain their atomic command and existing replacement guards.
      // Only the clinical editor may separate an explicit specialty from its clinical companions.
      if (
        typeof fields.specialty !== 'string' ||
        Object.keys(fields).some(field => !CLINICAL_SUBMISSION_FIELDS.has(field))
      ) {
        return immediateUpdateMultiple(fields);
      }
      const { specialty, ...remainingFields } = fields;
      if (isFeatureEnabled('SPECIALTY_EPISODE_ASSIGNMENT')) {
        // The authority applies these derived clears atomically with the scalar decision.
        for (const key of [
          'secondarySpecialty',
          'ginecobstetriciaType',
          'deliveryRoute',
          'deliveryDate',
          'deliveryCesareanLabor',
        ] as const) {
          if (remainingFields[key] === undefined) delete remainingFields[key];
        }
      }
      return (async () => {
        const saved = await immediateUpdateMultiple({ specialty });
        if (saved !== true || currentScopeRef.current !== scopeKey) return false;
        if (!hasPatientRowPatchFields(remainingFields)) return true;
        return (await immediateUpdateMultiple(remainingFields)) === true;
      })();
    };
  }, [bedId, scopeKey, updateMany]);

  return {
    updateField,
    updateMultiple,
  };
};

export const usePatientRowMainInputHandlers = ({
  bedId,
  currentDateString,
  data,
  documentType,
  updatePatient,
  updatePatientMultiple,
}: UsePatientRowMainInputHandlersParams) => {
  const { updateField, updateMultiple } = usePatientRowUpdateAdapter({
    bedId,
    updateSingle: updatePatient,
    updateMany: updatePatientMultiple,
    coalesceClinicalInitialBlock: true,
    scopeKey: buildPatientRowSaveScopeKey(currentDateString, data, bedId),
  });

  const commands = useMemo(
    () => buildPatientRowInputCommands({ updateField, updateMultiple }),
    [updateField, updateMultiple]
  );
  const commandHandlers = usePatientRowCommandHandlers(commands);

  const toggleDocumentType = useCallback(() => {
    const nextDocumentType = resolveNextDocumentType(documentType);
    updateField('documentType', nextDocumentType);
  }, [documentType, updateField]);

  const handleDeliveryRouteChange = useCallback(
    (
      route: DeliveryRoute | undefined,
      date: string | undefined,
      cesareanLabor: CesareanLabor | undefined
    ) => {
      updateMultiple(buildDeliveryRoutePatch(route, date, cesareanLabor));
    },
    [updateMultiple]
  );

  const handleDemographicsSave = useCallback(
    (updatedFields: PatientRowPatientPatch) => {
      const result = commandHandlers.handleDemographicsSave(updatedFields);
      harmonizeEpisodeDemographicsHistorySafely({
        currentDate: currentDateString,
        sourcePatient: data,
        updatedFields,
      });
      return result;
    },
    [commandHandlers, currentDateString, data]
  );

  return {
    ...commandHandlers,
    handleDemographicsSave,
    toggleDocumentType,
    handleDeliveryRouteChange,
  };
};

export const usePatientRowCribInputHandlers = ({
  bedId,
  currentDateString,
  data,
  updateClinicalCrib,
  updateClinicalCribMultiple,
}: UsePatientRowCribInputHandlersParams) => {
  const { updateField, updateMultiple } = usePatientRowUpdateAdapter({
    bedId,
    updateSingle: updateClinicalCrib,
    updateMany: updateClinicalCribMultiple,
    scopeKey: buildPatientRowSaveScopeKey(currentDateString, data, bedId, true),
  });

  const commands = useMemo(
    () => buildPatientRowInputCommands({ updateField, updateMultiple }),
    [updateField, updateMultiple]
  );
  const commandHandlers = usePatientRowCommandHandlers(commands);

  const handleCribDemographicsSave = useCallback(
    (updatedFields: PatientRowPatientPatch) => {
      const result = commandHandlers.handleDemographicsSave(updatedFields);
      if (!data) {
        return result;
      }

      harmonizeEpisodeDemographicsHistorySafely({
        currentDate: currentDateString,
        sourcePatient: data,
        updatedFields,
        isClinicalCribPatient: true,
      });
      return result;
    },
    [commandHandlers, currentDateString, data]
  );

  return {
    handleCribTextChange: commandHandlers.handleTextChange,
    handleCribCheckboxChange: commandHandlers.handleCheckboxChange,
    handleCribDevicesChange: commandHandlers.handleDevicesChange,
    handleCribDeviceDetailsChange: commandHandlers.handleDeviceDetailsChange,
    handleCribDeviceHistoryChange: commandHandlers.handleDeviceHistoryChange,
    handleCribDemographicsSave,
  };
};
