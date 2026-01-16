/** @vitest-environment jsdom */
import '../../setup';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MovementsSummary } from '@/views/handoff/MovementsSummary';
import { createMockRecord } from '../../integration/setup';

describe('MovementsSummary', () => {
    it('renders empty messages for day shift', () => {
        const record = createMockRecord('2024-12-11');
        render(<MovementsSummary record={record} selectedShift="day" />);

        expect(screen.getByText(/No hay altas registradas en este turno/i)).toBeInTheDocument();
        expect(screen.getByText(/No hay traslados registrados en este turno/i)).toBeInTheDocument();
        expect(screen.getByText(/No hay pacientes de CMA hoy/i)).toBeInTheDocument();
    });

    it('renders empty messages for night shift', () => {
        const record = createMockRecord('2024-12-11');
        render(<MovementsSummary record={record} selectedShift="night" />);

        expect(screen.getByText(/No hay altas registradas durante la noche/i)).toBeInTheDocument();
        expect(screen.getByText(/No hay traslados registrados durante la noche/i)).toBeInTheDocument();
        expect(screen.getByText(/CMA solo aplica para turno de día/i)).toBeInTheDocument();
    });

    it('filters discharges and transfers by shift time', () => {
        const record = createMockRecord('2024-12-11');

        // 10:00 is Day Shift (08:00-20:00)
        // 22:00 is Night Shift (20:00-08:00)

        record.discharges = [
            { id: 'd1', bedId: 'B1', bedName: 'B1', bedType: 'Adulto', patientName: 'Day Discharge', rut: '1', time: '10:00', diagnosis: 'D1', dischargeType: 'Domicilio (Habitual)', status: 'Vivo' },
            { id: 'd2', bedId: 'B2', bedName: 'B2', bedType: 'Adulto', patientName: 'Night Discharge', rut: '2', time: '22:00', diagnosis: 'D2', dischargeType: 'Domicilio (Habitual)', status: 'Vivo' },
            { id: 'd3', bedId: 'B3', bedName: 'B3', bedType: 'Adulto', patientName: 'No Time Discharge', rut: '3', time: '', diagnosis: 'D3', dischargeType: 'Domicilio (Habitual)', status: 'Vivo' },
        ];

        record.transfers = [
            { id: 't1', bedId: 'T1', bedName: 'T1', bedType: 'Adulto', patientName: 'Day Transfer', rut: '4', time: '14:00', diagnosis: 'D4', evacuationMethod: 'Ambulancia', receivingCenter: 'H1' },
            { id: 't2', bedId: 'T2', bedName: 'T2', bedType: 'Adulto', patientName: 'Night Transfer', rut: '5', time: '02:00', diagnosis: 'D5', evacuationMethod: 'Ambulancia', receivingCenter: 'H2' },
        ];

        const { rerender } = render(<MovementsSummary record={record} selectedShift="day" />);

        expect(screen.getByText('Day Discharge')).toBeInTheDocument();
        expect(screen.getByText('No Time Discharge')).toBeInTheDocument();
        expect(screen.queryByText('Night Discharge')).not.toBeInTheDocument();

        expect(screen.getByText('Day Transfer')).toBeInTheDocument();
        expect(screen.queryByText('Night Transfer')).not.toBeInTheDocument();

        // Switch to Night
        rerender(<MovementsSummary record={record} selectedShift="night" />);

        expect(screen.getByText('Night Discharge')).toBeInTheDocument();
        expect(screen.queryByText('Day Discharge')).not.toBeInTheDocument();
        expect(screen.queryByText('No Time Discharge')).not.toBeInTheDocument();

        expect(screen.getByText('Night Transfer')).toBeInTheDocument();
        expect(screen.queryByText('Day Transfer')).not.toBeInTheDocument();
    });

    it('renders CMA patients only on day shift', () => {
        const record = createMockRecord('2024-12-11');
        record.cma = [
            { id: 'c1', bedName: 'C1', patientName: 'CMA Patient', rut: '6', age: '40', diagnosis: 'D6', specialty: 'Medicina', interventionType: 'Cirugía Mayor Ambulatoria' }
        ];

        const { rerender } = render(<MovementsSummary record={record} selectedShift="day" />);
        expect(screen.getByText('CMA Patient')).toBeInTheDocument();

        rerender(<MovementsSummary record={record} selectedShift="night" />);
        expect(screen.queryByText('CMA Patient')).not.toBeInTheDocument();
        expect(screen.getByText(/CMA solo aplica para turno de día/i)).toBeInTheDocument();
    });

    it('handles special values like receivingCenterOther', () => {
        const record = createMockRecord('2024-12-11');
        record.transfers = [
            {
                id: 't1',
                bedId: 'T1',
                bedName: 'T1',
                bedType: 'Adulto',
                patientName: 'Other Transfer',
                rut: '7',
                time: '12:00',
                diagnosis: 'D4',
                evacuationMethod: 'Ambulancia',
                receivingCenter: 'Otro',
                receivingCenterOther: 'Especial Hospital'
            },
        ];

        render(<MovementsSummary record={record} selectedShift="day" />);
        expect(screen.getByText('Especial Hospital')).toBeInTheDocument();
        expect(screen.queryByText('Otro')).not.toBeInTheDocument();
    });
});
