import { authorizeRoleRequest, extractBearerToken } from './firebase-auth';
import { getFirebaseServer } from './firebase-server';

export const authorizeAdminAIRequest = async (
  authorizationHeader: string | undefined,
  allowedRoles: ReadonlySet<string>
): Promise<void> => {
  extractBearerToken(authorizationHeader);
  const { db } = getFirebaseServer();
  await authorizeRoleRequest(db, authorizationHeader, allowedRoles);
};
