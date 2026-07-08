import { useCallback, useEffect, useState } from 'react';
import type { AuthUser } from '@/types/authRoleTypes';
import {
  readCachedUserAvatarProfile,
  type UserAvatarProfile,
} from '@/services/user-profile/userAvatarProfileCache';

export interface UseUserAvatarProfileResult {
  profile: UserAvatarProfile | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  uploadAvatar: (file: File) => Promise<UserAvatarProfile>;
  removeAvatar: () => Promise<void>;
  clearError: () => void;
}

const resolveErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'No se pudo actualizar la foto de perfil.';

const loadUserAvatarProfileService = () =>
  import('@/services/user-profile/userAvatarProfileService').then(
    module => module.userAvatarProfileService
  );

export const useUserAvatarProfile = (
  user: AuthUser | null | undefined
): UseUserAvatarProfileResult => {
  const [profile, setProfile] = useState<UserAvatarProfile | null>(() =>
    readCachedUserAvatarProfile(user?.uid)
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const uid = user?.uid?.trim();
    if (!uid) {
      setProfile(null);
      setIsLoading(false);
      return undefined;
    }

    setProfile(readCachedUserAvatarProfile(uid));
    setIsLoading(true);
    setError(null);
    let isDisposed = false;
    let unsubscribe: (() => void) | undefined;

    void loadUserAvatarProfileService()
      .then(service => {
        if (isDisposed) {
          return;
        }
        unsubscribe = service.subscribeProfile(
          uid,
          nextProfile => {
            if (isDisposed) {
              return;
            }
            setProfile(nextProfile);
            setIsLoading(false);
          },
          subscriptionError => {
            if (isDisposed) {
              return;
            }
            setError(resolveErrorMessage(subscriptionError));
            setIsLoading(false);
          }
        );
      })
      .catch(subscriptionError => {
        if (isDisposed) {
          return;
        }
        setError(resolveErrorMessage(subscriptionError));
        setIsLoading(false);
      });

    return () => {
      isDisposed = true;
      unsubscribe?.();
    };
  }, [user?.uid]);

  const uploadAvatar = useCallback(
    async (file: File) => {
      if (!user?.uid) {
        throw new Error('No se pudo identificar al usuario actual.');
      }

      setIsSaving(true);
      setError(null);
      try {
        const service = await loadUserAvatarProfileService();
        const nextProfile = await service.uploadAvatar({
          uid: user.uid,
          email: user.email,
          file,
        });
        setProfile(nextProfile);
        return nextProfile;
      } catch (uploadError) {
        const message = resolveErrorMessage(uploadError);
        setError(message);
        throw new Error(message);
      } finally {
        setIsSaving(false);
      }
    },
    [user?.email, user?.uid]
  );

  const removeAvatar = useCallback(async () => {
    if (!user?.uid) {
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const service = await loadUserAvatarProfileService();
      await service.removeAvatar(user.uid);
      setProfile(null);
    } catch (removeError) {
      const message = resolveErrorMessage(removeError);
      setError(message);
      throw new Error(message);
    } finally {
      setIsSaving(false);
    }
  }, [user?.uid]);

  return {
    profile,
    isLoading,
    isSaving,
    error,
    uploadAvatar,
    removeAvatar,
    clearError: () => setError(null),
  };
};
