import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PatientIdentityCell } from '@/features/census/components/patient-row/PatientIdentityCell';
import { PatientLaboratoryTrigger } from '@/features/census/components/patient-row/PatientLaboratoryTrigger';
import { UIProvider } from '@/context/UIContext';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import type { DebouncedTextHandler } from '@/features/census/components/patient-row/inputCellTypes';
import type { PatientData } from '@/types/domain/patient';
import { IDENTITY_REVIEW_DATE as DATE, storedDay } from '@/tests/fixtures/identityReviewDayFixture';

vi.mock('@/context/StaffContext', () => ({
  useStaffContext: () => ({ professionalsCatalog: [] }),
}));
vi.mock('@/features/laboratory', () => ({ LabResultsViewerModal: () => null }));
vi.mock('@/components/modals/ExamRequestModal', () => ({ ExamRequestModal: () => null }));

const noopChange: DebouncedTextHandler = () => vi.fn();

const renderCell = (data: PatientData) =>
  render(
    <UIProvider>
      <table>
        <tbody>
          <tr>
            <PatientIdentityCell
              data={data}
              hasRutError={false}
              onNameChange={noopChange}
              onOpenDemographics={vi.fn()}
            />
          </tr>
        </tbody>
      </table>
    </UIProvider>
  );

// The stored document number reads as a valid RUT, but the stored document type could not be read.
const readR1 = (documentType: string) =>
  docToRecord(storedDay({ documentType, rut: '12.345.678-5' }), DATE).beds.R1;

describe('a census bed whose stored identity is under review', () => {
  it('shows the patient with a warning that names the bed and the field', () => {
    renderCell(readR1('Cedula'));

    expect(screen.getByText('PACIENTE UNO')).toBeInTheDocument();
    expect(screen.getByText('12.345.678-5')).toBeInTheDocument();
    expect(screen.getByText('Identidad por revisar')).toHaveAttribute(
      'title',
      'Identidad de la cama R1 por revisar: tipo de documento.'
    );
  });

  it('names every identity field that could not be read by its own label', () => {
    const labels: Record<string, string> = {
      documentType: 'tipo de documento',
      rut: 'RUT o pasaporte',
      clinicalEpisodeId: 'episodio',
      identityStatus: 'estado',
      patientName: 'nombre',
      firstName: 'nombres',
      lastName: 'primer apellido',
      secondLastName: 'segundo apellido',
      admissionDate: 'fecha de ingreso',
      admissionTime: 'hora',
    };
    const unreadable = Object.fromEntries(
      Object.keys(labels).map((field, index) => [field, index])
    );
    const patient = docToRecord(storedDay(unreadable), DATE).beds.R1;
    renderCell(patient);

    const fields = patient.identityReview?.fields ?? [];
    expect(fields).toHaveLength(10);
    expect(screen.getByText('Identidad por revisar')).toHaveAttribute(
      'title',
      `Identidad de la cama R1 por revisar: ${fields.map(field => labels[field]).join(', ')}.`
    );
  });

  it('treats the document as neither RUT nor passport, and offers no RUT lookups', () => {
    renderCell(readR1('Cedula'));

    expect(screen.queryByTitle('RUT válido')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Documento pasaporte')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Abrir MMRAD/ })).not.toBeInTheDocument();
  });

  it('shows a readable RUT as before', () => {
    renderCell(readR1('RUT'));

    expect(screen.queryByText('Identidad por revisar')).not.toBeInTheDocument();
    expect(screen.getByTitle('RUT válido')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Abrir MMRAD/ })).toBeVisible();
  });
});

describe('the laboratory lookup of a bed whose stored identity is under review', () => {
  it('is not offered, since it would look the document up as a RUT', () => {
    render(<PatientLaboratoryTrigger patient={readR1('Cedula')} censusDate={DATE} />);

    expect(screen.queryByRole('button', { name: /Abrir laboratorio/ })).not.toBeInTheDocument();
  });

  it('is offered for a readable RUT', () => {
    render(<PatientLaboratoryTrigger patient={readR1('RUT')} censusDate={DATE} />);

    expect(screen.getByRole('button', { name: /Abrir laboratorio/ })).toBeInTheDocument();
  });
});
