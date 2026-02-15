import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChangeEvent } from 'react';
import {
    usePatientRowCribInputHandlers,
    usePatientRowMainInputHandlers
} from '@/features/census/components/patient-row/usePatientRowInputHandlers';

describe('usePatientRowInputHandlers', () => {
    it('maps main row handlers to daily record actions', () => {
        const updatePatient = vi.fn();
        const updatePatientMultiple = vi.fn();

        const { result } = renderHook(() =>
            usePatientRowMainInputHandlers({
                bedId: 'R1',
                documentType: 'RUT',
                updatePatient,
                updatePatientMultiple
            })
        );

        act(() => {
            result.current.handleTextChange('patientName')({ target: { value: 'Paciente X' } } as ChangeEvent<HTMLInputElement>);
            result.current.handleCheckboxChange('isUPC')({ target: { checked: true } } as ChangeEvent<HTMLInputElement>);
            result.current.toggleDocumentType();
            result.current.handleDemographicsSave({ age: '40' });
            result.current.handleDeliveryRouteChange('Vaginal', '2026-02-12');
        });

        expect(updatePatient).toHaveBeenCalledWith('R1', 'patientName', 'Paciente X');
        expect(updatePatient).toHaveBeenCalledWith('R1', 'isUPC', true);
        expect(updatePatient).toHaveBeenCalledWith('R1', 'documentType', 'Pasaporte');
        expect(updatePatientMultiple).toHaveBeenCalledWith('R1', { age: '40' });
        expect(updatePatientMultiple).toHaveBeenCalledWith('R1', { deliveryRoute: 'Vaginal', deliveryDate: '2026-02-12' });
    });

    it('maps clinical crib handlers to clinical crib actions', () => {
        const updateClinicalCrib = vi.fn();
        const updateClinicalCribMultiple = vi.fn();

        const { result } = renderHook(() =>
            usePatientRowCribInputHandlers({
                bedId: 'R1',
                updateClinicalCrib,
                updateClinicalCribMultiple
            })
        );

        act(() => {
            result.current.handleCribTextChange('patientName')({ target: { value: 'RN X' } } as ChangeEvent<HTMLInputElement>);
            result.current.handleCribCheckboxChange('isUPC')({ target: { checked: true } } as ChangeEvent<HTMLInputElement>);
            result.current.handleCribDevicesChange(['VVP#1']);
            result.current.handleCribDemographicsSave({ age: '2d' });
        });

        expect(updateClinicalCrib).toHaveBeenCalledWith('R1', 'patientName', 'RN X');
        expect(updateClinicalCrib).toHaveBeenCalledWith('R1', 'isUPC', true);
        expect(updateClinicalCrib).toHaveBeenCalledWith('R1', 'devices', ['VVP#1']);
        expect(updateClinicalCribMultiple).toHaveBeenCalledWith('R1', { age: '2d' });
    });

    it('defaults document type toggle to Pasaporte when current type is undefined', () => {
        const updatePatient = vi.fn();
        const updatePatientMultiple = vi.fn();

        const { result } = renderHook(() =>
            usePatientRowMainInputHandlers({
                bedId: 'R5',
                documentType: undefined,
                updatePatient,
                updatePatientMultiple
            })
        );

        act(() => {
            result.current.toggleDocumentType();
            result.current.handleDeliveryRouteChange(undefined, undefined);
        });

        expect(updatePatient).toHaveBeenCalledWith('R5', 'documentType', 'Pasaporte');
        expect(updatePatientMultiple).toHaveBeenCalledWith('R5', {
            deliveryRoute: undefined,
            deliveryDate: undefined
        });
    });
});
