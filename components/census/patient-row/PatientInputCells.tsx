/**
 * PatientInputCells - Orchestrator component for patient data input cells
 * 
 * This component composes atomic sub-components for each input field.
 * Each sub-component is independently testable and maintainable.
 */

import React from 'react';
import { PatientData, DeviceDetails } from '../../../types';
import { DiagnosisMode } from '../../../views/census/CensusTable';

// Atomic sub-components
import { NameInput } from './NameInput';
import { RutPassportInput } from './RutPassportInput';
import { AgeInput } from './AgeInput';
import { DiagnosisInput } from './DiagnosisInput';
import { SpecialtySelect } from './SpecialtySelect';
import { StatusSelect } from './StatusSelect';
import { AdmissionInput } from './AdmissionInput';
import { DevicesCell } from './DevicesCell';
import { CheckboxCell } from './CheckboxCell';
import { PatientInputSchema } from '../../../schemas/inputSchemas';

interface PatientInputCellsProps {
    data: PatientData;
    currentDateString: string;
    isSubRow?: boolean;
    isEmpty?: boolean;
    onChange: {
        text: (field: keyof PatientData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
        check: (field: keyof PatientData) => (e: React.ChangeEvent<HTMLInputElement>) => void;
        devices: (newDevices: string[]) => void;
        deviceDetails: (details: DeviceDetails) => void;
        toggleDocType?: () => void;
        deliveryRoute?: (route: 'Vaginal' | 'Cesárea' | undefined, date: string | undefined) => void;
        multiple?: (fields: Partial<PatientData>) => void;
    };
    onDemo: () => void;
    readOnly?: boolean;
    diagnosisMode?: DiagnosisMode;
}

export const PatientInputCells: React.FC<PatientInputCellsProps> = ({
    data,
    currentDateString,
    isSubRow = false,
    isEmpty = false,
    onChange,
    onDemo,
    readOnly = false,
    diagnosisMode = 'free'
}) => {
    // Adapter: convert event-based handler to debounced value handler
    const handleDebouncedText = (field: keyof PatientData) => (value: string) => {
        const syntheticEvent = { target: { value } } as React.ChangeEvent<HTMLInputElement>;
        onChange.text(field)(syntheticEvent);
    };

    // Common props for all cells
    const commonProps = {
        data,
        isSubRow,
        isEmpty,
        readOnly
    };

    return (
        <>
            {/* Name */}
            <NameInput
                {...commonProps}
                onChange={handleDebouncedText}
            />

            {/* RUT / Passport */}
            <RutPassportInput
                value={data.rut || ''}
                documentType={data.documentType || 'RUT'}
                isSubRow={isSubRow}
                isEmpty={isEmpty}
                hasName={!!data.patientName && !isEmpty}
                onChange={handleDebouncedText('rut')}
                onToggleType={onChange.toggleDocType}
                readOnly={readOnly}
                hasError={!PatientInputSchema.pick({ rut: true }).safeParse({ rut: data.rut }).success && !!data.rut}
                onAutofill={onChange.multiple}
            />

            {/* Age */}
            <AgeInput
                {...commonProps}
                onOpenDemographics={onDemo}
            />

            {/* Diagnosis */}
            <DiagnosisInput
                {...commonProps}
                diagnosisMode={diagnosisMode}
                onChange={handleDebouncedText}
                onMultipleUpdate={onChange.multiple}
                onDeliveryRouteChange={onChange.deliveryRoute}
            />

            {/* Specialty */}
            <SpecialtySelect
                {...commonProps}
                onChange={onChange.text}
            />

            {/* Status */}
            <StatusSelect
                {...commonProps}
                onChange={onChange.text}
            />

            {/* Admission */}
            <AdmissionInput
                {...commonProps}
                onChange={handleDebouncedText}
                onMultipleUpdate={onChange.multiple}
            />

            {/* Devices */}
            <DevicesCell
                {...commonProps}
                currentDateString={currentDateString}
                onDevicesChange={onChange.devices}
                onDeviceDetailsChange={onChange.deviceDetails}
            />

            {/* Surgical Complication */}
            <CheckboxCell
                {...commonProps}
                field="surgicalComplication"
                onChange={onChange.check}
                title="Comp. Qx"
                colorClass="text-red-600"
            />

            {/* UPC */}
            <CheckboxCell
                {...commonProps}
                field="isUPC"
                onChange={onChange.check}
                title="UPC"
                colorClass="text-purple-600"
                isLastColumn
            />
        </>
    );
};
