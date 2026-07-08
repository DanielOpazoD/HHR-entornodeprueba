export type UserAvatarFeedbackKind = 'saved' | 'removed';

export const buildUserAvatarFeedback = (kind: UserAvatarFeedbackKind) =>
  kind === 'saved'
    ? {
        title: 'Foto de perfil actualizada',
        message: 'Tu foto quedó sincronizada para este usuario.',
      }
    : {
        title: 'Foto de perfil eliminada',
        message: 'Se restauró la visualización por defecto.',
      };

export const resolveVisibleUserAvatarUrl = (inAppAvatarUrl?: string | null): string | null =>
  inAppAvatarUrl || null;
