import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BEDS } from '@/constants/beds';
import { PatientBedConfig } from '@/features/census/components/patient-row/PatientBedConfig';
import {
  MEDICAL_DISCHARGE_DESCRIPTION,
  NURSING_DISCHARGE_DESCRIPTION,
} from '@/features/census/components/patient-row/RayenDischargeBadges';
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

  it('omits the amber location editor on box UEA beds', () => {
    const boxBed = BEDS.find(bed => bed.id === 'BOX1');
    if (!boxBed) throw new Error('BOX1 bed definition is missing');

    render(
      <table>
        <tbody>
          <tr>
            <PatientBedConfig
              bed={{ ...boxBed, isExtra: true }}
              data={DataFactory.createMockPatient('BOX1', {
                patientName: 'Paciente Box',
                admissionDate: '2026-07-20',
                location: 'AMQI / B1UEA',
              })}
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

    expect(screen.queryByPlaceholderText('Ubicación')).toBeNull();
  });

  it('keeps the amber location editor on regular extra beds', () => {
    const extraBed = BEDS.find(bed => bed.id === 'E1');
    if (!extraBed) throw new Error('E1 bed definition is missing');

    render(
      <table>
        <tbody>
          <tr>
            <PatientBedConfig
              bed={{ ...extraBed, isExtra: true }}
              data={DataFactory.createMockPatient('E1', {
                patientName: 'Paciente Extra',
                location: 'UEA / E1',
              })}
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
            />
          </tr>
        </tbody>
      </table>
    );

    expect(screen.getByPlaceholderText('Ubicación')).toHaveValue('UEA / E1');
  });

  it('marks the bed when Eloísa already registered the medical discharge', () => {
    render(
      <table>
        <tbody>
          <tr>
            <PatientBedConfig
              bed={BEDS[0]}
              data={DataFactory.createMockPatient('R1', {
                patientName: 'Paciente Con Alta Médica',
                admissionDate: '2026-07-20',
                dischargeVerification: {
                  medicalEpicrisis: 'confirmed',
                  nursingEpicrisis: 'not-detected',
                  encounterId: '8801',
                  registeredAt: '2026-07-25T09:45:00.000Z',
                },
              })}
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
            />
          </tr>
        </tbody>
      </table>
    );

    expect(screen.getByLabelText(new RegExp(MEDICAL_DISCHARGE_DESCRIPTION))).toBeInTheDocument();
    expect(screen.queryByLabelText(NURSING_DISCHARGE_DESCRIPTION)).toBeNull();
  });

  it('marks the bed when Eloísa already registered the nursing discharge', () => {
    render(
      <table>
        <tbody>
          <tr>
            <PatientBedConfig
              bed={BEDS[0]}
              data={DataFactory.createMockPatient('R1', {
                patientName: 'Paciente Con Alta de Enfermería',
                admissionDate: '2026-07-20',
                dischargeVerification: {
                  medicalEpicrisis: 'not-detected',
                  nursingEpicrisis: 'confirmed',
                },
              })}
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
            />
          </tr>
        </tbody>
      </table>
    );

    expect(screen.getByLabelText(NURSING_DISCHARGE_DESCRIPTION)).toBeInTheDocument();
    expect(screen.queryByLabelText(new RegExp(MEDICAL_DISCHARGE_DESCRIPTION))).toBeNull();
  });

  it('overlaps both discharge badges like stacked cards', () => {
    render(
      <table>
        <tbody>
          <tr>
            <PatientBedConfig
              bed={BEDS[0]}
              data={DataFactory.createMockPatient('R1', {
                patientName: 'Paciente Con Ambas Altas',
                admissionDate: '2026-07-20',
                dischargeVerification: {
                  medicalEpicrisis: 'confirmed',
                  nursingEpicrisis: 'confirmed',
                  encounterId: '8801',
                },
              })}
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
            />
          </tr>
        </tbody>
      </table>
    );

    const nursing = screen.getByLabelText(NURSING_DISCHARGE_DESCRIPTION);
    const medical = screen.getByLabelText(MEDICAL_DISCHARGE_DESCRIPTION);
    const container = screen.getByTestId('rayen-discharge-badges');
    // Orden pedido: primero el alta médica en verde, después la de enfermería.
    expect(container.firstElementChild).toBe(medical);
    expect(medical).toHaveClass('z-0');
    // La tarjeta de enfermería se superpone a la médica, como cartas encima una de otra.
    expect(nursing).toHaveClass('-ml-1', 'z-10');
    expect(container).toContainElement(nursing);
    // Ambas altas usan el mismo ícono: el color es lo único que las distingue.
    expect(nursing.querySelector('svg')?.getAttribute('class')).toBe(
      medical.querySelector('svg')?.getAttribute('class')
    );
    expect(nursing).toHaveClass('text-sky-700');
    expect(medical).toHaveClass('text-emerald-700');
  });

  it('omits the markers while Eloísa has not registered any discharge', () => {
    render(
      <table>
        <tbody>
          <tr>
            <PatientBedConfig
              bed={BEDS[0]}
              data={DataFactory.createMockPatient('R1', {
                patientName: 'Paciente Sin Altas',
                admissionDate: '2026-07-20',
                dischargeVerification: {
                  medicalEpicrisis: 'not-detected',
                  nursingEpicrisis: 'unknown',
                },
              })}
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
            />
          </tr>
        </tbody>
      </table>
    );

    expect(screen.queryByTestId('rayen-discharge-badges')).toBeNull();
  });
});
