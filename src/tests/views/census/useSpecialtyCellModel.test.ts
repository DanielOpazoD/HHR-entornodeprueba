import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSpecialtyCellModel } from '@/features/census/components/patient-row/useSpecialtyCellModel';
import { DataFactory } from '@/tests/factories/DataFactory';
import { Specialty } from '@/types/domain/patientClassification';

describe('useSpecialtyCellModel', () => {
  it('exposes derived primary labels/state without secondary specialty handlers', () => {
    const data = DataFactory.createMockPatient('R1', {
      specialty: Specialty.MEDICINA,
      secondarySpecialty: Specialty.CIRUGIA,
    });

    const { result } = renderHook(() =>
      useSpecialtyCellModel({
        data,
      })
    );

    expect(result.current.state.isPrimaryOther).toBe(false);
    expect(typeof result.current.primaryLabel).toBe('string');
  });
});
