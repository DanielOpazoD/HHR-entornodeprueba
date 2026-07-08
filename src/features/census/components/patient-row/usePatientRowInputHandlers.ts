import { useCallback, useEffect, useMemo, useRef } from 'react';
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
  splitClinicalInitialBlockPatch,
} from '@/features/census/controllers/clinicalInitialBlockCoalescingController';
import { harmonizeEpisodeDemographicsHistorySafely } from '@/features/census/controllers/patientDemographicsEpisodeSyncController';
import { usePatientRowCommandHandlers } from '@/features/census/components/patient-row/usePatientRowCommandHandlers';

const CLINICAL_INITIAL_BLOCK_COALESCE_MS = 400;

interface UsePatientRowMainInputHandlersParams {
  bedId: string;
  currentDateString: string;
  data: PatientData;
  documentType?: PatientRowPatientDocumentType;
  updatePatient: (bedId: string, field: PatientRowPatientField, value: PatientFieldValue) => void;
  updatePatientMultiple: (bedId: string, fields: PatientRowPatientPatch) => void;
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
  updateClinicalCribMultiple: (bedId: string, fields: PatientRowPatientPatch) => void;
}

interface UsePatientRowUpdateAdapterParams {
  bedId: string;
  updateSingle: (bedId: string, field: PatientRowPatientField, value: PatientFieldValue) => void;
  updateMany: (bedId: string, fields: PatientRowPatientPatch) => void;
  coalesceClinicalInitialBlock?: boolean;
}

const usePatientRowUpdateAdapter = ({
  bedId,
  updateSingle,
  updateMany,
  coalesceClinicalInitialBlock = false,
}: UsePatientRowUpdateAdapterParams) => {
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
    if (hasPatientRowPatchFields(pendingFields)) {
      updateManyRef.current(bedId, pendingFields);
    }
  }, [bedId]);

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

  const updateField = useMemo(() => {
    const immediateUpdateField = buildPatientFieldUpdater({ bedId, updateSingle });
    if (!coalesceClinicalInitialBlock) {
      return immediateUpdateField;
    }

    return (field: PatientRowPatientField, value: PatientFieldValue) => {
      if (!isClinicalInitialBlockField(field)) {
        immediateUpdateField(field, value);
        return;
      }

      queueClinicalFields({ [field]: value });
    };
  }, [bedId, coalesceClinicalInitialBlock, queueClinicalFields, updateSingle]);

  const updateMultiple = useMemo(() => {
    const immediateUpdateMultiple = buildPatientMultipleUpdater({ bedId, updateMany });
    if (!coalesceClinicalInitialBlock) {
      return immediateUpdateMultiple;
    }

    return (fields: PatientRowPatientPatch) => {
      const { clinicalFields, immediateFields } = splitClinicalInitialBlockPatch(fields);

      if (hasPatientRowPatchFields(immediateFields)) {
        immediateUpdateMultiple(immediateFields);
      }

      if (hasPatientRowPatchFields(clinicalFields)) {
        queueClinicalFields(clinicalFields);
      }
    };
  }, [bedId, coalesceClinicalInitialBlock, queueClinicalFields, updateMany]);

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
      commandHandlers.handleDemographicsSave(updatedFields);
      harmonizeEpisodeDemographicsHistorySafely({
        currentDate: currentDateString,
        sourcePatient: data,
        updatedFields,
      });
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
  });

  const commands = useMemo(
    () => buildPatientRowInputCommands({ updateField, updateMultiple }),
    [updateField, updateMultiple]
  );
  const commandHandlers = usePatientRowCommandHandlers(commands);

  const handleCribDemographicsSave = useCallback(
    (updatedFields: PatientRowPatientPatch) => {
      commandHandlers.handleDemographicsSave(updatedFields);
      if (!data) {
        return;
      }

      harmonizeEpisodeDemographicsHistorySafely({
        currentDate: currentDateString,
        sourcePatient: data,
        updatedFields,
        isClinicalCribPatient: true,
      });
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
