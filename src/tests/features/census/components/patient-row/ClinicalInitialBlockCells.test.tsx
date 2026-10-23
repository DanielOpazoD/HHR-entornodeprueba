import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClinicalInitialBlockCells } from '@/features/census/components/patient-row/ClinicalInitialBlockCells';
import { DataFactory } from '@/tests/factories/DataFactory';
import { Specialty } from '@/types/domain/patientClassification';

describe('ClinicalInitialBlockCells', () => {
  it('keeps one current diagnosis when changing census days and the bed occupant', () => {
    const patient = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente obstétrica sintética',
      clinicalEpisodeId: 'episode-obstetric',
      pathology: 'Diagnóstico obstétrico sintético',
      specialty: Specialty.GINECOBSTETRICIA,
      ginecobstetriciaType: 'Obstétrica',
    });
    const cells = (date: string, data = patient) => (
      <table>
        <tbody>
          <tr>
            <ClinicalInitialBlockCells
              currentDateString={date}
              data={data}
              onChange={() => vi.fn()}
              onMultipleUpdate={vi.fn()}
            />
          </tr>
        </tbody>
      </table>
    );
    const { rerender } = render(cells('2026-10-17'));

    for (const date of ['2026-10-16', '2026-10-17', '2026-10-16', '2026-10-17']) {
      rerender(cells(date));
      expect(screen.getAllByRole('button', { name: 'Editar diagnóstico' })).toHaveLength(1);
      expect(screen.getAllByText(patient.pathology)).toHaveLength(1);
    }

    rerender(
      cells('2026-10-16', {
        ...patient,
        patientName: 'Otro paciente sintético',
        clinicalEpisodeId: 'episode-medical',
        pathology: 'Diagnóstico médico sintético',
        specialty: Specialty.MEDICINA,
      })
    );
    expect(screen.getAllByRole('button', { name: 'Editar diagnóstico' })).toHaveLength(1);
    expect(screen.queryByText(patient.pathology)).not.toBeInTheDocument();
    expect(screen.getByText('Diagnóstico médico sintético')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Editar diagnóstico' }));
    expect(screen.getByTestId('clinical-block-pathology-R1')).toHaveValue(
      'Diagnóstico médico sintético'
    );
  });

  it('uses one deterministic padding class when all diagnosis controls are visible', () => {
    render(
      <table>
        <tbody>
          <tr>
            <ClinicalInitialBlockCells
              data={DataFactory.createMockPatient('R1', {
                patientName: 'Paciente Test',
                pathology: 'Embarazo de término',
                specialty: Specialty.GINECOBSTETRICIA,
                ginecobstetriciaType: 'Obstétrica',
                cie10Code: 'Z34.9',
                cie10Description: 'Supervisión de embarazo normal',
              })}
              onChange={() => vi.fn()}
              onMultipleUpdate={vi.fn()}
              onDeliveryRouteChange={vi.fn()}
            />
          </tr>
        </tbody>
      </table>
    );

    const diagnosis = screen.getByText('Embarazo de término');
    expect(diagnosis).toHaveClass('pr-32');
    expect(diagnosis).not.toHaveClass('pr-28', 'pr-14', 'pr-8');
  });

  it('wraps a long diagnosis into a second line instead of clipping it in one line', () => {
    const longDiagnosis =
      'Neumonía adquirida en la comunidad con derrame pleural paraneumónico en tratamiento antibiótico';

    render(
      <table>
        <tbody>
          <tr>
            <ClinicalInitialBlockCells
              data={DataFactory.createMockPatient('R1', {
                patientName: 'Paciente Test',
                pathology: longDiagnosis,
              })}
              onChange={() => vi.fn()}
              onMultipleUpdate={vi.fn()}
            />
          </tr>
        </tbody>
      </table>
    );

    const diagnosis = screen.getByText(longDiagnosis);
    expect(diagnosis).toHaveClass('line-clamp-2');
    expect(diagnosis).not.toHaveClass('truncate');
    expect(diagnosis).not.toHaveAttribute('title');
    fireEvent.click(screen.getByRole('button', { name: 'Editar diagnóstico' }));
    expect(screen.getByTestId('clinical-block-pathology-R1')).toHaveValue(longDiagnosis);
  });
});
