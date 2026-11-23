import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { ConsentUploadModal } from '@/features/wound-care/components/ConsentUploadModal';

const uploadConsentMock = vi.fn();

vi.mock('@/features/wound-care/hooks/useWoundCareUpload', () => ({
  useWoundCareUpload: () => ({
    uploadConsent: uploadConsentMock,
    isUploading: false,
  }),
}));

const episodeContext = {
  episodeKey: '11.111.111-1__2026-04-01',
  patientRut: '11.111.111-1',
  patientName: 'Paciente Sintético',
};

describe('ConsentUploadModal object URL lifecycle', () => {
  let createObjectUrlSpy: ReturnType<typeof vi.spyOn>;
  let revokeObjectUrlSpy: ReturnType<typeof vi.spyOn>;
  let counter = 0;

  beforeEach(() => {
    counter = 0;
    uploadConsentMock.mockReset();
    createObjectUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(() => `blob:consent-preview-${++counter}`);
    revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    createObjectUrlSpy.mockRestore();
    revokeObjectUrlSpy.mockRestore();
  });

  it('revokes preview object URLs on replacement, PDF switch, close, and unmount', () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <ConsentUploadModal
        isOpen
        onClose={onClose}
        episodeContext={episodeContext}
        existingConsent={null}
      />
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const firstImage = new File(['img-1'], 'consent-1.png', { type: 'image/png' });
    const secondImage = new File(['img-2'], 'consent-2.png', { type: 'image/png' });
    const pdfFile = new File(['%PDF'], 'consent.pdf', { type: 'application/pdf' });

    fireEvent.change(input, { target: { files: [firstImage] } });
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlSpy).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { files: [secondImage] } });
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(2);
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:consent-preview-1');

    fireEvent.change(input, { target: { files: [pdfFile] } });
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:consent-preview-2');

    fireEvent.change(input, { target: { files: [firstImage] } });
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(3);

    unmount();
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:consent-preview-3');
  });
});
