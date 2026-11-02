import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UserAvatarModal } from '@/components/layout/UserAvatarModal';
import { USER_AVATAR_PRESETS } from '@/services/user-profile/userAvatarPresets';
import { existsSync } from 'node:fs';

const renderModal = () => {
  const onSelectPreset = vi.fn(async () => undefined);
  const onClose = vi.fn();
  render(
    <UserAvatarModal
      isOpen
      userEmail="enfermera@hospital.cl"
      onClose={onClose}
      onUpload={vi.fn()}
      onSelectPreset={onSelectPreset}
      onRemove={vi.fn()}
    />
  );
  return { onSelectPreset, onClose };
};

describe('UserAvatarModal preset icons', () => {
  it('saves the icon the person chose', async () => {
    const { onSelectPreset, onClose } = renderModal();
    const save = screen.getByRole('button', { name: 'Guardar' });
    expect(save).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Corazón' }));
    expect(screen.getByRole('button', { name: 'Corazón' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(save);

    await waitFor(() => expect(onSelectPreset).toHaveBeenCalledWith('corazon'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('keeps the modal open and explains when the icon cannot be saved', async () => {
    const { onSelectPreset, onClose } = renderModal();
    onSelectPreset.mockRejectedValueOnce(new Error('No se pudo guardar el ícono.'));

    fireEvent.click(screen.getByRole('button', { name: 'Sol' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('No se pudo guardar el ícono.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ships a file for every icon', () => {
    for (const preset of USER_AVATAR_PRESETS) {
      expect(existsSync(`public${preset.url}`)).toBe(true);
    }
  });
});
