// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { resolvePatientRowDemographicsBinding } from '@/features/census/controllers/patientRowModalController';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('patientRowModalController', () => {
  it('uses main demographics target for parent rows', () => {
    const onSaveDemographics = vi.fn();
    const onSaveCribDemographics = vi.fn();

    const result = resolvePatientRowDemographicsBinding({
      bedId: 'R1',
      isSubRow: false,
      data: DataFactory.createMockPatient('R1', { bedMode: 'Cama' }),
      onSaveDemographics,
      onSaveCribDemographics,
    });

    expect(result.targetBedId).toBe('R1');
    expect(result.isRnIdentityContext).toBe(false);
    expect(result.onSave).toBe(onSaveDemographics);
  });

  it('uses crib demographics target for sub rows', () => {
    const onSaveDemographics = vi.fn();
    const onSaveCribDemographics = vi.fn();

    const result = resolvePatientRowDemographicsBinding({
      bedId: 'R1',
      isSubRow: true,
      data: DataFactory.createMockPatient('R1', { bedMode: 'Cama' }),
      onSaveDemographics,
      onSaveCribDemographics,
    });

    expect(result.targetBedId).toBe('R1-cuna');
    expect(result.isRnIdentityContext).toBe(true);
    expect(result.onSave).toBe(onSaveCribDemographics);
  });
});
