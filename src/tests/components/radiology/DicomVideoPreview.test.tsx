import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DicomVideoPreview } from '@/components/radiology/DicomVideoPreview';

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
