import { describe, expect, it, vi } from 'vitest';
import {
  buildPatientFieldUpdater,
  buildPatientMultipleUpdater,
} from '@/features/census/controllers/patientRowInputUpdateController';
import { PatientStatus } from '@/types';

describe('patientRowInputUpdateController', () => {
  it('buildPatientFieldUpdater binds bed id for single field updates', () => {
    const updateSingle = vi.fn();
    const updateField = buildPatientFieldUpdater({ bedId: 'A1', updateSingle });

    updateField('patientName', 'Ana');

    expect(updateSingle).toHaveBeenCalledWith('A1', 'patientName', 'Ana');
  });

  it('buildPatientMultipleUpdater binds bed id for bulk updates', () => {
    const updateMany = vi.fn();
    const updateMultiple = buildPatientMultipleUpdater({ bedId: 'A1', updateMany });

    updateMultiple({ patientName: 'Ana', status: PatientStatus.GRAVE });

    expect(updateMany).toHaveBeenCalledWith('A1', {
      patientName: 'Ana',
      status: PatientStatus.GRAVE,
    });
  });
});
