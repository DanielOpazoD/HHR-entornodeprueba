import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useHospitalFloorMapModel } from '@/features/census/components/3d/useHospitalFloorMapModel';
import type {
  HospitalFloorMapRuntime,
  SavedLayout,
} from '@/features/census/controllers/hospitalFloorMapRuntimeController';
import { BedType, type BedDefinition } from '@/types';

const buildRuntime = (
  overrides: Partial<HospitalFloorMapRuntime> = {}
): HospitalFloorMapRuntime => ({
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  confirm: vi.fn().mockReturnValue(true),
  ...overrides,
});

const beds: BedDefinition[] = [{ id: 'R1', name: 'R1', type: BedType.UTI, isCuna: false }];

describe('useHospitalFloorMapModel', () => {
  it('hydrates layout from runtime payload and resolves bed items', () => {
    const persisted: SavedLayout = {
      beds: {
        R1: { x: 10, z: 15, rotation: 0.5 },
      },
      config: {
        bedWidth: 2,
        bedLength: 2.5,
        colorOccupied: '#000000',
        colorFree: '#ffffff',
      },
    };
    const runtime = buildRuntime({
      getItem: vi.fn().mockReturnValue(JSON.stringify(persisted)),
    });

    const { result } = renderHook(() => useHospitalFloorMapModel({ beds, runtime }));

    expect(result.current.layout.beds.R1).toEqual(persisted.beds.R1);
    expect(result.current.layout.config).toEqual(persisted.config);
    expect(result.current.bedItems[0].transform).toEqual(persisted.beds.R1);
  });

  it('saves current layout and exits edit mode', () => {
    const runtime = buildRuntime();
    const { result } = renderHook(() => useHospitalFloorMapModel({ beds, runtime }));

    act(() => {
      result.current.toggleEditMode();
      result.current.handleTransformChange('R1', { x: 2, z: 3, rotation: 1 });
    });

    act(() => {
      result.current.saveLayout();
    });

    expect(runtime.setItem).toHaveBeenCalledWith(
      'hhr_3d_layout_v2',
      expect.stringContaining('"R1":{"x":2,"z":3,"rotation":1}')
    );
    expect(result.current.isEditMode).toBe(false);
  });

  it('resets layout to defaults only when confirmed', () => {
    const runtime = buildRuntime();
    const { result } = renderHook(() => useHospitalFloorMapModel({ beds, runtime }));

    act(() => {
      result.current.handleTransformChange('R1', { x: 3, z: 4, rotation: 1 });
      result.current.resetLayout();
    });

    expect(runtime.confirm).toHaveBeenCalled();
    expect(runtime.removeItem).toHaveBeenCalledWith('hhr_3d_layout_v2');
    expect(result.current.layout.beds).toEqual({});
  });

  it('does not reset layout when confirmation is rejected', () => {
    const runtime = buildRuntime({
      confirm: vi.fn().mockReturnValue(false),
    });
    const { result } = renderHook(() => useHospitalFloorMapModel({ beds, runtime }));

    act(() => {
      result.current.handleTransformChange('R1', { x: 3, z: 4, rotation: 1 });
      result.current.resetLayout();
    });

    expect(runtime.removeItem).not.toHaveBeenCalled();
    expect(result.current.layout.beds.R1).toEqual({ x: 3, z: 4, rotation: 1 });
  });

  it('ignores invalid bed dimensions and applies valid config updates', () => {
    const runtime = buildRuntime();
    const { result } = renderHook(() => useHospitalFloorMapModel({ beds, runtime }));

    act(() => {
      result.current.setBedWidth(0);
      result.current.setBedLength(Number.NaN);
      result.current.setColorFree('#123456');
      result.current.setColorOccupied('#abcdef');
    });

    expect(result.current.layout.config.bedWidth).toBe(1.5);
    expect(result.current.layout.config.bedLength).toBe(2.2);
    expect(result.current.layout.config.colorFree).toBe('#123456');
    expect(result.current.layout.config.colorOccupied).toBe('#abcdef');

    act(() => {
      result.current.setBedWidth(2.4);
      result.current.setBedLength(3.1);
    });

    expect(result.current.layout.config.bedWidth).toBe(2.4);
    expect(result.current.layout.config.bedLength).toBe(3.1);
  });

  it('updates zoom value from controls events and zoom buttons', () => {
    const runtime = buildRuntime();
    const { result } = renderHook(() => useHospitalFloorMapModel({ beds, runtime }));
    const multiplyScalar = vi.fn();
    const getDistance = vi.fn(() => 20);
    const update = vi.fn();

    act(() => {
      result.current.controlsRef.current = {
        object: {
          position: {
            multiplyScalar,
          },
        },
        update,
        getDistance,
      } as never;
    });

    act(() => {
      result.current.handleZoomUpdateFromControls();
    });
    expect(result.current.zoomValue).toBe(60);

    getDistance.mockReturnValueOnce(10).mockReturnValueOnce(40);
    act(() => {
      result.current.handleZoomIn();
      result.current.handleZoomOut();
    });

    expect(multiplyScalar).toHaveBeenNthCalledWith(1, 0.9);
    expect(multiplyScalar).toHaveBeenNthCalledWith(2, 1.1);
    expect(result.current.zoomValue).toBe(30);
  });
});
