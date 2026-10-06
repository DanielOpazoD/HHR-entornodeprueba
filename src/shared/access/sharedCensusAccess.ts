import type { CensusAccessUser } from '@/types/censusAccess';

const SHARED_CENSUS_BASE_PATHS = ['/censo-compartido', '/censo-publico'] as const;
const SHARED_ACCESS_EXPIRATION_DAYS = 60;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

export interface SharedCensusPathInfo {
  isSharedCensusMode: boolean;
  invitationId: string | null;
}

interface BuildAuthorizedSharedAccessUserParams {
  uid: string;
  email: string;
  displayName?: string | null;
  now?: Date;
}

const normalizePathname = (pathname: string): string => {
  if (!pathname) {
    return '/';
  }

  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1);
  }

  return pathname;
};

const resolveInvitationIdForBasePath = (pathname: string, basePath: string): string | null => {
  if (!pathname.startsWith(basePath)) {
    return null;
  }

  const suffix = pathname.slice(basePath.length).replace(/^\/+/, '');
  if (!suffix) {
    return null;
  }

  return suffix.split('/')[0] || null;
};

export const resolveSharedCensusPathInfo = (pathname: string): SharedCensusPathInfo => {
  const normalizedPathname = normalizePathname(pathname);
  const matchingBasePath = SHARED_CENSUS_BASE_PATHS.find(
    basePath => normalizedPathname === basePath || normalizedPathname.startsWith(`${basePath}/`)
  );

  if (!matchingBasePath) {
    return {
      isSharedCensusMode: false,
      invitationId: null,
    };
  }

  return {
    isSharedCensusMode: true,
    invitationId: resolveInvitationIdForBasePath(normalizedPathname, matchingBasePath),
  };
};

export const buildAuthorizedSharedAccessUser = ({
  uid,
  email,
  displayName,
  now = new Date(),
}: BuildAuthorizedSharedAccessUserParams): CensusAccessUser => {
  const expiresAt = new Date(now.getTime() + SHARED_ACCESS_EXPIRATION_DAYS * DAY_IN_MS);

  return {
    id: uid,
    email: email.toLowerCase(),
    displayName: displayName || email.split('@')[0],
    role: 'viewer',
    createdAt: now,
    createdBy: 'local-auth',
    expiresAt,
    isActive: true,
  };
};
