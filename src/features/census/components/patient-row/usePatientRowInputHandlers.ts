import { useCallback } from 'react';
import { DeviceDetails, DeviceInstance, PatientData, PatientFieldValue } from '@/types';
import {
    buildDeliveryRoutePatch,
    resolveNextDocumentType
} from '@/features/census/controllers/patientRowInputController';

interface UsePatientRowMainInputHandlersParams {
    bedId: string;
    documentType?: PatientData['documentType'];
    updatePatient: (bedId: string, field: keyof PatientData, value: PatientFieldValue) => void;
    updatePatientMultiple: (bedId: string, fields: Partial<PatientData>) => void;
}

interface UsePatientRowCribInputHandlersParams {
    bedId: string;
    updateClinicalCrib: (bedId: string, field: keyof PatientData, value: PatientFieldValue) => void;
    updateClinicalCribMultiple: (bedId: string, fields: Partial<PatientData>) => void;
}

interface UseCommonPatientInputHandlersParams {
    updateField: (field: keyof PatientData, value: PatientFieldValue) => void;
    updateMultiple: (fields: Partial<PatientData>) => void;
}

const useCommonPatientInputHandlers = ({
    updateField,
    updateMultiple
}: UseCommonPatientInputHandlersParams) => {
    const handleTextChange = useCallback((field: keyof PatientData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        updateField(field, e.target.value);
    }, [updateField]);

    const handleCheckboxChange = useCallback((field: keyof PatientData) => (e: React.ChangeEvent<HTMLInputElement>) => {
        updateField(field, e.target.checked);
    }, [updateField]);

    const handleDevicesChange = useCallback((newDevices: string[]) => {
        updateField('devices', newDevices);
    }, [updateField]);

    const handleDeviceDetailsChange = useCallback((details: DeviceDetails) => {
        updateField('deviceDetails', details);
    }, [updateField]);

    const handleDeviceHistoryChange = useCallback((history: DeviceInstance[]) => {
        updateField('deviceInstanceHistory', history);
    }, [updateField]);

    const handleDemographicsSave = useCallback((updatedFields: Partial<PatientData>) => {
        updateMultiple(updatedFields);
    }, [updateMultiple]);

    return {
        handleTextChange,
        handleCheckboxChange,
        handleDevicesChange,
        handleDeviceDetailsChange,
        handleDeviceHistoryChange,
        handleDemographicsSave
    };
};

export const usePatientRowMainInputHandlers = ({
    bedId,
    documentType,
    updatePatient,
    updatePatientMultiple
}: UsePatientRowMainInputHandlersParams) => {
    const updateField = useCallback((field: keyof PatientData, value: PatientFieldValue) => {
        updatePatient(bedId, field, value);
    }, [bedId, updatePatient]);
    const updateMultiple = useCallback((fields: Partial<PatientData>) => {
        updatePatientMultiple(bedId, fields);
    }, [bedId, updatePatientMultiple]);

    const {
        handleTextChange,
        handleCheckboxChange,
        handleDevicesChange,
        handleDeviceDetailsChange,
        handleDeviceHistoryChange,
        handleDemographicsSave
    } = useCommonPatientInputHandlers({
        updateField,
        updateMultiple
    });

    const toggleDocumentType = useCallback(() => {
        const nextDocumentType = resolveNextDocumentType(documentType);
        updateField('documentType', nextDocumentType);
    }, [documentType, updateField]);

    const handleDeliveryRouteChange = useCallback((route: 'Vaginal' | 'Cesárea' | undefined, date: string | undefined) => {
        updateMultiple(buildDeliveryRoutePatch(route, date));
    }, [updateMultiple]);

    return {
        handleTextChange,
        handleCheckboxChange,
        handleDevicesChange,
        handleDeviceDetailsChange,
        handleDeviceHistoryChange,
        handleDemographicsSave,
        toggleDocumentType,
        handleDeliveryRouteChange
    };
};

export const usePatientRowCribInputHandlers = ({
    bedId,
    updateClinicalCrib,
    updateClinicalCribMultiple
}: UsePatientRowCribInputHandlersParams) => {
    const updateField = useCallback((field: keyof PatientData, value: PatientFieldValue) => {
        updateClinicalCrib(bedId, field, value);
    }, [bedId, updateClinicalCrib]);
    const updateMultiple = useCallback((fields: Partial<PatientData>) => {
        updateClinicalCribMultiple(bedId, fields);
    }, [bedId, updateClinicalCribMultiple]);

    const {
        handleTextChange,
        handleCheckboxChange,
        handleDevicesChange,
        handleDeviceDetailsChange,
        handleDeviceHistoryChange,
        handleDemographicsSave
    } = useCommonPatientInputHandlers({
        updateField,
        updateMultiple
    });

    return {
        handleCribTextChange: handleTextChange,
        handleCribCheckboxChange: handleCheckboxChange,
        handleCribDevicesChange: handleDevicesChange,
        handleCribDeviceDetailsChange: handleDeviceDetailsChange,
        handleCribDeviceHistoryChange: handleDeviceHistoryChange,
        handleCribDemographicsSave: handleDemographicsSave
    };
};
