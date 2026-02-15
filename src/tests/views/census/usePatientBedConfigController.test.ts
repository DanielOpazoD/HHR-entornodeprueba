import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePatientBedConfigController } from '@/features/census/components/patient-row/usePatientBedConfigController';

const buildBaseParams = () => ({
  admissionDate: '2026-02-10',
  currentDateString: '2026-02-15',
  patientName: 'Paciente Test',
  isBlocked: false,
  hasCompanion: false,
  hasClinicalCrib: true,
  isCunaMode: false,
  readOnly: false,
  onToggleMode: vi.fn(),
  onToggleCompanion: vi.fn(),
  onToggleClinicalCrib: vi.fn(),
  onUpdateClinicalCrib: vi.fn(),
});

describe('usePatientBedConfigController', () => {
  it('builds expected view state flags and days counter', () => {
    const { result } = renderHook(() => usePatientBedConfigController(buildBaseParams()));

    expect(result.current.viewState.daysHospitalized).toBe(5);
    expect(result.current.viewState.showMenu).toBe(true);
    expect(result.current.viewState.showClinicalCribToggle).toBe(true);
    expect(result.current.viewState.showClinicalCribActions).toBe(true);
  });

  it('routes menu actions to callbacks', () => {
    const params = buildBaseParams();
    const { result } = renderHook(() => usePatientBedConfigController(params));

    act(() => {
      result.current.handleToggleMode();
      result.current.handleToggleCompanion();
      result.current.handleToggleClinicalCrib();
      result.current.handleRemoveClinicalCrib({ stopPropagation: vi.fn() } as any);
    });

    expect(params.onToggleMode).toHaveBeenCalledTimes(1);
    expect(params.onToggleCompanion).toHaveBeenCalledTimes(1);
    expect(params.onToggleClinicalCrib).toHaveBeenCalledTimes(1);
    expect(params.onUpdateClinicalCrib).toHaveBeenCalledWith('remove');
  });
});
