import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import UserSignatureDialog from '@/components/layout/UserSignatureDialog';
import type { UserSignatureService } from '@/services/user-profile/userSignatureService';

vi.mock('@/hooks/useScrollLock', () => ({ useScrollLock: () => {}, default: () => {} }));

const service = {
  load: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
};

const pick = (file: File) =>
  fireEvent.change(screen.getByLabelText('Imagen de la firma'), { target: { files: [file] } });

describe('UserSignatureDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => 'blob:vista-previa');
    URL.revokeObjectURL = vi.fn();
    service.save.mockResolvedValue(undefined);
    service.remove.mockResolvedValue(undefined);
  });
  afterEach(() => {
    cleanup();
  });

  const renderDialog = () =>
    render(
      <UserSignatureDialog
        uid="uid-1"
        onClose={vi.fn()}
        service={service as unknown as UserSignatureService}
      />
    );

  it('refuses a file of another type or over 500 KB without uploading it', async () => {
    service.load.mockResolvedValue(null);
    renderDialog();
    expect(await screen.findByText('Aún no tiene una firma guardada.')).toBeInTheDocument();

    pick(new File(['<svg/>'], 'firma.svg', { type: 'image/svg+xml' }));
    expect(screen.getByRole('alert')).toHaveTextContent('PNG, JPG o WEBP');
    pick(new File([new Uint8Array(500 * 1024 + 1)], 'firma.png', { type: 'image/png' }));
    expect(screen.getByRole('alert')).toHaveTextContent('500 KB');
    expect(service.save).not.toHaveBeenCalled();
  });

  it('uploads a valid signature and then previews the saved one', async () => {
    service.load.mockResolvedValueOnce(null);
    service.load.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    renderDialog();
    await screen.findByText('Aún no tiene una firma guardada.');

    const image = new File(['png'], 'firma.png', { type: 'image/png' });
    pick(image);

    expect(await screen.findByRole('img', { name: 'Vista previa de mi firma' })).toHaveAttribute(
      'src',
      'blob:vista-previa'
    );
    expect(service.save).toHaveBeenCalledWith('uid-1', image);
    expect(screen.getByRole('button', { name: /Reemplazar/ })).toBeInTheDocument();
  });

  it('does not show a failed upload as saved', async () => {
    service.load.mockResolvedValue(null);
    service.save.mockRejectedValue(new Error('network'));
    renderDialog();
    await screen.findByText('Aún no tiene una firma guardada.');

    pick(new File(['png'], 'firma.png', { type: 'image/png' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar la firma.');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('deletes the saved signature', async () => {
    service.load.mockResolvedValueOnce(new Blob(['png'], { type: 'image/png' }));
    service.load.mockResolvedValue(null);
    renderDialog();
    await screen.findByRole('img', { name: 'Vista previa de mi firma' });

    fireEvent.click(screen.getByRole('button', { name: /Eliminar/ }));

    await waitFor(() => expect(service.remove).toHaveBeenCalledWith('uid-1'));
    expect(await screen.findByText('Aún no tiene una firma guardada.')).toBeInTheDocument();
  });
});
