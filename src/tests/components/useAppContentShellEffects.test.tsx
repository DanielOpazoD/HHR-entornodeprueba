import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppContentShellEffects } from '@/components/layout/app-content/useAppContentShellEffects';

const mockRecordOperationalTelemetry = vi.fn();

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: (...args: unknown[]) => mockRecordOperationalTelemetry(...args),
}));

describe('useAppContentShellEffects', () => {
  const createBaseParams = (): Parameters<typeof useAppContentShellEffects>[0] => ({
    role: 'admin',
    currentModule: 'CENSUS',
    setCurrentModule: vi.fn(),
    setSelectedShift: vi.fn(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sanitizes invalid modules for restricted roles', () => {
    const baseParams = createBaseParams();

    renderHook(() =>
      useAppContentShellEffects({
        ...baseParams,
        role: 'doctor_specialist',
        currentModule: 'AUDIT',
      })
    );

    expect(baseParams.setCurrentModule).toHaveBeenCalledWith('CENSUS');
  });

  it('sanitizes direct statistics entry for roles without analytics access', () => {
    const baseParams = createBaseParams();

    renderHook(() =>
      useAppContentShellEffects({
        ...baseParams,
        role: 'doctor_specialist',
        currentModule: 'ANALYTICS',
      })
    );

    expect(baseParams.setCurrentModule).toHaveBeenCalledWith('CENSUS');
  });

  it('forwards navigate-module and set-shift events', () => {
    const baseParams = createBaseParams();

    renderHook(() => useAppContentShellEffects(baseParams));

    act(() => {
      window.dispatchEvent(new CustomEvent('navigate-module', { detail: 'CUDYR' }));
      window.dispatchEvent(new CustomEvent('set-shift', { detail: 'night' }));
    });

    expect(baseParams.setCurrentModule).toHaveBeenCalledWith('CUDYR');
    expect(baseParams.setSelectedShift).toHaveBeenCalledWith('night');
  });

  it('records app shell telemetry only once per mount', () => {
    const baseParams = createBaseParams();

    const { rerender } = renderHook(props => useAppContentShellEffects(props), {
      initialProps: baseParams,
    });

    rerender({
      ...baseParams,
      currentModule: 'CUDYR',
    });

    expect(mockRecordOperationalTelemetry).toHaveBeenCalledTimes(1);
    expect(mockRecordOperationalTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'app_shell_ready',
        context: expect.objectContaining({
          module: 'CENSUS',
          role: 'admin',
        }),
      }),
      { allowSuccess: true }
    );
  });

  it('falls back to viewer role in telemetry when auth role is undefined', () => {
    renderHook(() =>
      useAppContentShellEffects({
        ...createBaseParams(),
        role: undefined as never,
      })
    );

    expect(mockRecordOperationalTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'app_shell_ready',
        context: expect.objectContaining({
          module: 'CENSUS',
          role: 'viewer',
        }),
      }),
      { allowSuccess: true }
    );
  });
});
