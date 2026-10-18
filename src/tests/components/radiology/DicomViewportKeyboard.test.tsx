import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DicomViewportGrid } from '@/components/radiology/DicomViewportGrid';
import type { DicomRuntime } from '@/services/radiology/dicomRuntimeTypes';
describe('scoped DICOM keyboard', () => {
  it('navigates slices and planes, undoes measurements, and respects disabled shortcuts and busy state', () => {
    const step = vi.fn(),
      undoMeasurement = vi.fn(),
      activate = vi.fn();
    const runtime = { step, undoMeasurement } as unknown as DicomRuntime;
    const props = {
      mode: 'mpr' as const,
      title: 'Synthetic',
      busy: false,
      error: '',
      pending: false,
      activePlane: 0,
      expanded: null,
      orientations: [],
      runtime,
      elements: { current: [] },
      activate,
      expand: vi.fn(),
    };
    const view = render(<DicomViewportGrid {...props} />);
    const axial = screen.getByRole('img', { name: 'Axial · Synthetic' });
    const nativeKey = vi.fn();
    axial.addEventListener('keydown', nativeKey);
    fireEvent.keyDown(axial, { key: 'ArrowDown' });
    expect(step).toHaveBeenLastCalledWith(0, 1);
    fireEvent.keyDown(axial, { key: 'PageUp' });
    expect(step).toHaveBeenLastCalledWith(0, -10);
    fireEvent.keyDown(axial, { key: 'ArrowRight' });
    expect(screen.getByRole('img', { name: 'Coronal · Synthetic' })).toHaveFocus();
    fireEvent.keyDown(axial, { key: 'z', metaKey: true });
    expect(undoMeasurement).toHaveBeenCalledTimes(1);
    expect(nativeKey).not.toHaveBeenCalled();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    axial.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    view.rerender(<DicomViewportGrid {...props} keyboard={false} />);
    fireEvent.keyDown(axial, { key: 'ArrowDown' });
    expect(step).toHaveBeenCalledTimes(2);
    view.rerender(<DicomViewportGrid {...props} busy />);
    fireEvent.keyDown(axial, { key: 'z', ctrlKey: true });
    expect(undoMeasurement).toHaveBeenCalledTimes(1);
  });
});
