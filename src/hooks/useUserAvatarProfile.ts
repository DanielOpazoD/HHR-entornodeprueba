import { useCallback, useEffect, useState } from 'react';
import { useChangedOnRender } from '@/hooks/useChangedOnRender';
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
  selectPresetAvatar: (presetId: string) => Promise<UserAvatarProfile>;
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
  const userUid = user?.uid;
  const userEmail = user?.email;

  if (useChangedOnRender([userUid])) {
    const uid = userUid?.trim();
    setProfile(uid ? readCachedUserAvatarProfile(uid) : null);
    setIsLoading(Boolean(uid));
    if (uid) setError(null);
  }

  useEffect(() => {
    const uid = userUid?.trim();
    if (!uid) return undefined;

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
  }, [userUid]);

  const uploadAvatar = useCallback(
    async (file: File) => {
      if (!userUid) {
        throw new Error('No se pudo identificar al usuario actual.');
      }

      setIsSaving(true);
      setError(null);
      try {
        const service = await loadUserAvatarProfileService();
        const nextProfile = await service.uploadAvatar({
          uid: userUid,
          email: userEmail,
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
    [userEmail, userUid]
  );

  const selectPresetAvatar = useCallback(
    async (presetId: string) => {
      if (!userUid) {
        throw new Error('No se pudo identificar al usuario actual.');
      }

      setIsSaving(true);
      setError(null);
      try {
        const service = await loadUserAvatarProfileService();
        const nextProfile = await service.selectPresetAvatar({
          uid: userUid,
          email: userEmail,
          presetId,
        });
        setProfile(nextProfile);
        return nextProfile;
      } catch (selectError) {
        const message = resolveErrorMessage(selectError);
        setError(message);
        throw new Error(message);
      } finally {
        setIsSaving(false);
      }
    },
    [userEmail, userUid]
  );

  const removeAvatar = useCallback(async () => {
    if (!userUid) {
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const service = await loadUserAvatarProfileService();
      await service.removeAvatar(userUid);
      setProfile(null);
    } catch (removeError) {
      const message = resolveErrorMessage(removeError);
      setError(message);
      throw new Error(message);
    } finally {
      setIsSaving(false);
    }
  }, [userUid]);

  return {
    profile,
    isLoading,
    isSaving,
    error,
    uploadAvatar,
    selectPresetAvatar,
    removeAvatar,
    clearError: () => setError(null),
  };
};
