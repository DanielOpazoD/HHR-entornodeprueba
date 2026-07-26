import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BEDS } from '@/constants/beds';
import { PatientBedConfig } from '@/features/census/components/patient-row/PatientBedConfig';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('PatientBedConfig', () => {
  it('places the isolation badge in the bed column below hospitalization days', () => {
    const data = DataFactory.createMockPatient(BEDS[0].id, {
      patientName: 'Paciente Aislado',
      admissionDate: '2026-07-20',
      isIsolated: true,
      isolationType: 'Contacto y gotitas',
    });

    render(
      <table>
        <tbody>
          <tr>
            <PatientBedConfig
              bed={BEDS[0]}
              data={data}
              currentDateString="2026-07-25"
              isBlocked={false}
              hasCompanion={false}
              hasClinicalCrib={false}
              isCunaMode={false}
              onToggleMode={vi.fn()}
              onToggleCompanion={vi.fn()}
              onToggleClinicalCrib={vi.fn()}
              onTextChange={() => vi.fn()}
              onUpdateClinicalCrib={vi.fn()}
              readOnly
            />
          </tr>
        </tbody>
      </table>
    );

    const days = screen.getByText('5d');
    const badge = screen.getByLabelText('Aislamiento: Contacto y gotitas');
    expect(days.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
