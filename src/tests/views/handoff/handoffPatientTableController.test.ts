import type { PatientData } from '@/types/domain/patient';

import { describe, expect, it, vi } from 'vitest';
import { BedType } from '@/types/domain/beds';
import type { BedDefinition } from '@/types/domain/beds';
import { PatientStatus, Specialty } from '@/domain/handoff/patientContracts';
import { resolveHandoffPatientRowPlan } from '@/features/handoff/controllers/handoffPatientTableController';

describe('handoffPatientTableController', () => {
  const bed: BedDefinition = {
    id: 'R1',
    name: 'R1',
    type: BedType.MEDIA,
    isCuna: false,
  };

  const basePatient: PatientData = {
    bedId: 'R1',
    isBlocked: false,
    bedMode: 'Cama',
    hasCompanionCrib: false,
    patientName: 'Paciente',
    rut: '1-9',
    age: '40',
    pathology: 'Dx',
    specialty: Specialty.EMPTY,
    status: PatientStatus.EMPTY,
    admissionDate: '2026-03-17',
    hasWristband: false,
    devices: [],
    surgicalComplication: false,
    isUPC: false,
  };

  it('renders an empty placeholder row when the bed has no patient', () => {
    const shouldShowPatient = vi.fn();

    expect(
      resolveHandoffPatientRowPlan(bed, undefined, {
        isMedical: false,
        shouldShowPatient,
      })
    ).toMatchObject({
      shouldRender: true,
      shouldRenderMainRow: true,
      shouldRenderClinicalCrib: false,
    });
    expect(shouldShowPatient).not.toHaveBeenCalled();
  });

  it('hides blocked beds in medical view', () => {
    expect(
      resolveHandoffPatientRowPlan(
        bed,
        { ...basePatient, isBlocked: true },
        {
          isMedical: true,
          shouldShowPatient: vi.fn(),
        }
      )
    ).toMatchObject({
      shouldRender: false,
      shouldRenderMainRow: false,
      shouldRenderClinicalCrib: false,
    });
  });

  it('falls back to an empty row when a patient should not be shown for the shift', () => {
    const shouldShowPatient = vi.fn().mockReturnValue(false);

    const plan = resolveHandoffPatientRowPlan(bed, basePatient, {
      isMedical: false,
      shouldShowPatient,
    });

    expect(plan.shouldRender).toBe(true);
    expect(plan.shouldRenderMainRow).toBe(true);
    expect(plan.basePatient.patientName).toBe('');
    expect(shouldShowPatient).toHaveBeenCalledWith('R1');
  });

  it('includes a clinical crib row when the visible patient has one', () => {
    const plan = resolveHandoffPatientRowPlan(
      bed,
      {
        ...basePatient,
        clinicalCrib: {
          ...basePatient,
          bedId: 'R1-crib',
          patientName: 'RN',
        },
      },
      {
        isMedical: false,
        shouldShowPatient: vi.fn().mockReturnValue(true),
      }
    );

    expect(plan.shouldRender).toBe(true);
    expect(plan.shouldRenderMainRow).toBe(true);
    expect(plan.shouldRenderClinicalCrib).toBe(true);
  });
});
