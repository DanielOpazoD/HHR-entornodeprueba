import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DicomCineControls } from '@/features/radiology/dicom-viewer/DicomCineControls';
import { DicomVideoPreview } from '@/features/radiology/dicom-viewer/DicomVideoPreview';
import type { DicomRuntime } from '@/features/radiology/services/dicomRuntimeTypes';

describe('DICOM media controls', () => {
  it('never silently expands the selected partial cine playback bounds as availability grows', () => {
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

  it.each([false, true])('offers a playable MP4 directly with identified=%s', identified => {
    const failed = vi.fn();
    render(
      <DicomVideoPreview
        preview={{
          url: 'blob:synthetic-video',
          identified,
          filename: 'secuencia-dicom.mp4',
          summary: '720×720 · 6 cuadros',
        }}
        discard={vi.fn()}
        failed={failed}
      />
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText(/Revisa el video completo/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Descargar MP4' })).toBeNull();
    const video = screen.getByLabelText('Vista previa MP4');
    fireEvent.loadedData(video);
    expect(screen.getByRole('link', { name: 'Descargar MP4' })).toHaveAttribute(
      'download',
      'secuencia-dicom.mp4'
    );
    fireEvent.error(video);
    expect(screen.queryByRole('link', { name: 'Descargar MP4' })).toBeNull();
    expect(failed).toHaveBeenCalledOnce();
  });
});
