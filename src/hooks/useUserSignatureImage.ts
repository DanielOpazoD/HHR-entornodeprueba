import { useContext, useEffect, useState } from 'react';
import { AuthContext } from '@/context/AuthContext';
import { BOOTSTRAP_PLACEHOLDER_UID } from '@/constants/security';
import { useSessionEpoch } from '@/hooks/useSessionEpoch';
import {
  userSignatureService,
  type UserSignatureService,
} from '@/services/user-profile/userSignatureService';

export type UserSignatureImage =
  | { status: 'none' | 'loading' | 'error'; url: null }
  | { status: 'ready'; url: string };

const NONE: UserSignatureImage = { status: 'none', url: null };
const LOADING: UserSignatureImage = { status: 'loading', url: null };

/**
 * The person's signature as an object URL, held only while the caller is mounted. A session
 * change or another uid drops it in the same render and revokes the URL, so on a shared
 * computer the next person never sees it. A failed read is `error`, never `none`.
 */
export const useUserSignatureImage = (
  uid: string | null | undefined,
  reloadToken = 0,
  service: UserSignatureService = userSignatureService
): UserSignatureImage => {
  const epoch = useSessionEpoch();
  const key = uid ? `${uid}|${epoch}|${reloadToken}` : '';
  const [loaded, setLoaded] = useState<{ key: string; image: UserSignatureImage }>({
    key: '',
    image: NONE,
  });

  useEffect(() => {
    if (!uid) return;
    let active = true;
    let objectUrl: string | null = null;
    service.load(uid).then(
      blob => {
        if (!active) return;
        if (blob) objectUrl = URL.createObjectURL(blob);
        setLoaded({ key, image: objectUrl ? { status: 'ready', url: objectUrl } : NONE });
      },
      () => {
        if (active) setLoaded({ key, image: { status: 'error', url: null } });
      }
    );
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [uid, key, service]);

  if (!uid) return NONE;
  return loaded.key === key ? loaded.image : LOADING;
};

/** The signed-in person's own signature; nobody else's is ever read. */
export const useCurrentUserSignatureImage = (): UserSignatureImage => {
  const uid = useContext(AuthContext)?.currentUser?.uid;
  return useUserSignatureImage(uid && uid !== BOOTSTRAP_PLACEHOLDER_UID ? uid : null);
};
