import type { User } from 'firebase/auth';

import type { AuthSessionState } from '@/types/authSessionTypes';
import type { AuthUser } from '@/types/authRoleTypes';
import { toAuthUser } from '@/services/auth/authShared';
import {
  createUnauthorizedAuthSessionState,
  toAnonymousSignatureAuthSessionState,
  toResolvedAuthSessionState,
} from '@/services/auth/authSessionState';

export interface AuthSessionResolverDependencies {
  signOutUnauthorizedUser(): Promise<void>;
  resolveFirebaseUserRole(user: User): Promise<AuthUser['role'] | null>;
}

export const toAnonymousAuthUser = (firebaseUser: User): AuthUser => ({
  uid: firebaseUser.uid,
  email: null,
  displayName: 'Anonymous Doctor',
  role: 'viewer',
});

export const resolveAuthSessionState = async (
  firebaseUser: User,
  dependencies: AuthSessionResolverDependencies
): Promise<AuthSessionState> => {
  if (firebaseUser.isAnonymous) {
    return toAnonymousSignatureAuthSessionState(toAnonymousAuthUser(firebaseUser));
  }

  const role = await dependencies.resolveFirebaseUserRole(firebaseUser);
  if (!role) {
    await dependencies.signOutUnauthorizedUser();
    return createUnauthorizedAuthSessionState('role_not_resolved', {
      email: firebaseUser.email,
    });
  }

  return toResolvedAuthSessionState(toAuthUser(firebaseUser, role));
};
