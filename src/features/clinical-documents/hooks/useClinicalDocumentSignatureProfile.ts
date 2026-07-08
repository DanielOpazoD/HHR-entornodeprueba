import { useCallback, useEffect, useState } from 'react';

import {
  clinicalDocumentSignatureProfileService,
  type ClinicalDocumentSignatureProfile,
  type ClinicalDocumentSignatureProfileInput,
} from '@/features/clinical-documents/services/clinicalDocumentSignatureProfileService';

interface UseClinicalDocumentSignatureProfileParams {
  user: {
    uid?: string;
    email?: string | null;
    displayName?: string | null;
  } | null;
  isActive: boolean;
}

export const useClinicalDocumentSignatureProfile = ({
  user,
  isActive,
}: UseClinicalDocumentSignatureProfileParams) => {
  const [signatureProfile, setSignatureProfile] = useState<ClinicalDocumentSignatureProfile | null>(
    null
  );

  useEffect(() => {
    const uid = String(user?.uid || '').trim();
    if (!isActive || !uid) {
      return;
    }

    let isCancelled = false;
    void clinicalDocumentSignatureProfileService
      .getProfile(uid)
      .then(profile => {
        if (!isCancelled) {
          setSignatureProfile(profile);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setSignatureProfile(null);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isActive, user?.uid]);

  const saveSignatureProfile = useCallback(
    async (input: Omit<ClinicalDocumentSignatureProfileInput, 'uid' | 'email'>) => {
      const uid = String(user?.uid || '').trim();
      if (!uid) {
        throw new Error('No se pudo identificar la cuenta para guardar la firma.');
      }

      const profile = await clinicalDocumentSignatureProfileService.saveProfile({
        ...input,
        uid,
        email: user?.email || '',
      });
      setSignatureProfile(profile);
      return profile;
    },
    [user?.email, user?.uid]
  );

  return {
    signatureProfile:
      isActive && user?.uid && signatureProfile?.uid === user.uid ? signatureProfile : null,
    saveSignatureProfile,
  };
};
