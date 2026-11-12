import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SicSignatureField,
  useSicSignature,
} from '@/features/clinical-library/components/tools/forms/SicSignatureField';
import { useUserSignatureImage } from '@/hooks/useUserSignatureImage';
vi.mock('@/hooks/useUserSignatureImage', () => ({ useUserSignatureImage: vi.fn() }));
const Wrapper = ({ uid }: { uid: string }) => (
  <SicSignatureField signature={useSicSignature(uid)} />
);
describe('SIC signature selection', () => {
  beforeEach(() => {
    vi.mocked(useUserSignatureImage).mockReturnValue({ status: 'ready', url: 'blob:saved' });
    URL.createObjectURL = vi.fn(() => 'blob:local');
    URL.revokeObjectURL = vi.fn();
  });
  it('uses the own saved signature, allows opting out, and never persists a local attachment', () => {
    const view = render(<Wrapper uid="one" />);
    expect(useUserSignatureImage).toHaveBeenCalledWith('one');
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:saved');
    fireEvent.click(screen.getByLabelText('Adjuntar firma al documento'));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Adjuntar imagen de firma/), {
      target: { files: [new File(['png'], 'test.png', { type: 'image/png' })] },
    });
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:local');
    fireEvent.click(screen.getByRole('button', { name: 'Usar mi firma guardada' }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local');
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:saved');
    view.unmount();
  });
  it('surfaces failed saved reads and rejects invalid or oversized attachments', () => {
    vi.mocked(useUserSignatureImage).mockReturnValue({ status: 'error', url: null });
    render(<Wrapper uid="one" />);
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar');
    for (const file of [
      new File(['x'], 'bad.svg', { type: 'image/svg+xml' }),
      new File([new Uint8Array(512001)], 'large.png', { type: 'image/png' }),
    ]) {
      fireEvent.change(screen.getByLabelText(/Adjuntar imagen de firma/), {
        target: { files: [file] },
      });
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    }
  });
  it('revokes local bytes on a session-keyed remount', () => {
    const view = render(<Wrapper key="one:1" uid="one" />);
    fireEvent.change(screen.getByLabelText(/Adjuntar imagen de firma/), {
      target: { files: [new File(['png'], 'test.png', { type: 'image/png' })] },
    });
    vi.mocked(useUserSignatureImage).mockReturnValue({ status: 'none', url: null });
    view.rerender(<Wrapper key="two:2" uid="two" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local');
  });
});
