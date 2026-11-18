import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DicomCineControls } from '@/features/radiology/dicom-viewer/DicomCineControls';
import type { DicomRuntime } from '@/features/radiology/services/dicomRuntimeTypes';

describe('partial cine range selection', () => {
  it('never silently expands the selected playback bounds as availability grows', () => {
    const runtime = { sessionId: 'synthetic' } as DicomRuntime;
    const props = { runtime, total: 24, disabled: false, complete: false, busyChanged: vi.fn() };
    const view = render(<DicomCineControls {...props} available={[[4, 8]]} />);
    expect(screen.getByLabelText('Velocidad cine')).toHaveValue('20');
    fireEvent.change(screen.getByLabelText('Intervalo cine parcial'), { target: { value: '4,8' } });
    expect(screen.getByLabelText('Corte inicial')).toHaveValue(5);
    expect(screen.getByLabelText('Corte final')).toHaveValue(9);
    view.rerender(<DicomCineControls {...props} available={[[4, 12]]} />);
    expect(screen.getByLabelText('Intervalo cine parcial')).toHaveValue('');
    expect(screen.getByLabelText('Corte final')).toHaveValue(9);
    fireEvent.change(screen.getByLabelText('Intervalo cine parcial'), {
      target: { value: '4,12' },
    });
    expect(screen.getByLabelText('Corte final')).toHaveValue(13);
  });
});
