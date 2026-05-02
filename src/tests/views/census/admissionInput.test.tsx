import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataFactory } from '@/tests/factories/DataFactory';
import { AdmissionInput } from '@/features/census/components/patient-row/AdmissionInput';

describe('AdmissionInput', () => {
  it('renders admission date as read-only in the census table', () => {
    const data = DataFactory.createMockPatient('R1', {
      admissionDate: '2026-02-20',
      admissionTime: '10:00',
      patientName: 'Paciente Prueba',
    });

    const onChange = vi.fn((_: string) => vi.fn());

    render(
      <table>
        <tbody>
          <tr>
            <AdmissionInput
              data={data}
              currentDateString="2026-02-20"
              isNewAdmission
              onChange={onChange}
            />
          </tr>
        </tbody>
      </table>
    );

    expect(screen.getByText('20/02/2026')).toBeInTheDocument();
    expect(screen.queryByLabelText('Editar fecha y hora de ingreso')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: 'Configurar fecha y hora de ingreso' })
    ).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps next clinical day admissions visible without exposing an inline editor', () => {
    const data = DataFactory.createMockPatient('R1', {
      admissionDate: '2026-03-11',
      admissionTime: '02:15',
      patientName: 'Paciente Madrugada',
      firstSeenDate: '2026-03-10',
    });

    const onChange = vi.fn((_: string) => vi.fn());

    render(
      <table>
        <tbody>
          <tr>
            <AdmissionInput
              data={data}
              currentDateString="2026-03-10"
              isNewAdmission
              onChange={onChange}
            />
          </tr>
        </tbody>
      </table>
    );

    expect(screen.getByText('11/03/2026')).toBeInTheDocument();
    expect(screen.queryByLabelText('Editar fecha y hora de ingreso')).not.toBeInTheDocument();
  });

  it('shows suspicious admission dates without offering inline correction', () => {
    const data = DataFactory.createMockPatient('R1', {
      admissionDate: '2024-01-01',
      admissionTime: '',
      patientName: 'Paciente Prueba',
      firstSeenDate: '2026-03-10',
    });

    const onChange = vi.fn((_: string) => vi.fn());
    const onMultipleUpdate = vi.fn();

    render(
      <table>
        <tbody>
          <tr>
            <AdmissionInput
              data={data}
              currentDateString="2026-03-10"
              isNewAdmission
              onChange={onChange}
              onMultipleUpdate={onMultipleUpdate}
            />
          </tr>
        </tbody>
      </table>
    );

    expect(screen.getByText('01/01/2024')).toBeInTheDocument();
    expect(screen.queryByLabelText('Corregir fecha de ingreso sugerida')).not.toBeInTheDocument();
    expect(onMultipleUpdate).not.toHaveBeenCalled();
  });

  it('keeps same-day admission date visible when firstSeenDate is missing', () => {
    const data = DataFactory.createMockPatient('R1', {
      admissionDate: '2026-03-10',
      admissionTime: '08:30',
      patientName: 'Paciente Prueba',
    });

    const onChange = vi.fn((_: string) => vi.fn());

    render(
      <table>
        <tbody>
          <tr>
            <AdmissionInput
              data={data}
              currentDateString="2026-03-10"
              isNewAdmission
              onChange={onChange}
            />
          </tr>
        </tbody>
      </table>
    );

    expect(screen.getByText('10/03/2026')).toBeInTheDocument();
    expect(screen.queryByLabelText('Editar fecha y hora de ingreso')).not.toBeInTheDocument();
  });

  it('locks admission date editing when firstSeenDate is missing and the patient is no longer a same-day admission', () => {
    const data = DataFactory.createMockPatient('R1', {
      admissionDate: '2024-03-10',
      admissionTime: '08:30',
      patientName: 'Paciente Prueba',
    });

    const onChange = vi.fn((_: string) => vi.fn());

    render(
      <table>
        <tbody>
          <tr>
            <AdmissionInput
              data={data}
              currentDateString="2026-03-11"
              isNewAdmission={false}
              onChange={onChange}
            />
          </tr>
        </tbody>
      </table>
    );

    expect(screen.getByText('10/03/2024')).toBeInTheDocument();
    expect(screen.queryByLabelText('Editar fecha y hora de ingreso')).not.toBeInTheDocument();
  });

  it('locks admission date editing after the first observed day when firstSeenDate anchors the episode', () => {
    const data = DataFactory.createMockPatient('R1', {
      admissionDate: '2026-03-10',
      firstSeenDate: '2026-03-10',
      admissionTime: '08:30',
      patientName: 'Paciente Prueba',
    });

    const onChange = vi.fn((_: string) => vi.fn());

    render(
      <table>
        <tbody>
          <tr>
            <AdmissionInput
              data={data}
              currentDateString="2026-03-11"
              isNewAdmission={false}
              onChange={onChange}
            />
          </tr>
        </tbody>
      </table>
    );

    expect(screen.getByText('10/03/2026')).toBeInTheDocument();
    expect(screen.queryByLabelText('Editar fecha y hora de ingreso')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Corregir fecha de ingreso sugerida')).not.toBeInTheDocument();
  });
});
