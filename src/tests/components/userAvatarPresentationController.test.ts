import { describe, expect, it } from 'vitest';

import {
  buildUserAvatarFeedback,
  resolveVisibleUserAvatarUrl,
} from '@/components/layout/userAvatarPresentationController';

describe('userAvatarPresentationController', () => {
  it('builds concise toast feedback for save and delete outcomes', () => {
    expect(buildUserAvatarFeedback('saved')).toEqual({
      title: 'Foto de perfil actualizada',
      message: 'Tu foto quedó sincronizada para este usuario.',
    });
    expect(buildUserAvatarFeedback('removed')).toEqual({
      title: 'Foto de perfil eliminada',
      message: 'Se restauró la visualización por defecto.',
    });
  });

  it('keeps the default initial view after deleting the in-app avatar, even if Google has a photo', () => {
    expect(resolveVisibleUserAvatarUrl(null)).toBeNull();
    expect(resolveVisibleUserAvatarUrl('https://storage.test/user-avatar.png')).toBe(
      'https://storage.test/user-avatar.png'
    );
  });
});
