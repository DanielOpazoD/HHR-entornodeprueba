import { defaultAuthRuntime } from '@/services/firebase-runtime/authRuntime';
import type { AuthRuntime } from '@/services/firebase-runtime/authRuntime';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import type { FunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import { sharedCensusAuthLogger } from '@/services/auth/authLoggers';

type SharedCensusAccessResult = {
  authorized: boolean;
  role: 'viewer' | 'downloader';
};

const SHARED_CENSUS_ROUTE_PREFIXES = ['/censo-compartido', '/censo-publico'] as const;
const normalizeEmail = (email: string): string => {
  if (!email) return '';
  return String(email).toLowerCase().replace(/\s+/g, '').trim();
};

const isSharedCensusPath = (pathname: string): boolean =>
  SHARED_CENSUS_ROUTE_PREFIXES.some(prefix => pathname.startsWith(prefix));

export const isSharedCensusMode = (): boolean =>
  typeof window !== 'undefined' && isSharedCensusPath(window.location.pathname);

export const createSharedCensusAuthService = (
  authRuntime: Pick<AuthRuntime, 'ready' | 'getCurrentUser'> = defaultAuthRuntime,
  functionsRuntime: Pick<FunctionsRuntime, 'getFunctions'> = defaultFunctionsRuntime
) => {
  const resolveSharedCensusEmail = async (email?: string | null): Promise<string> => {
    await authRuntime.ready;
    return normalizeEmail(email || authRuntime.getCurrentUser()?.email || '');
  };

  return {
    checkSharedCensusAccess: async (email?: string | null): Promise<SharedCensusAccessResult> => {
      const currentEmail = await resolveSharedCensusEmail(email);
      if (!currentEmail) {
        return { authorized: false, role: 'viewer' };
      }
      try {
        const functions = await functionsRuntime.getFunctions();
        const { httpsCallable } = await import('firebase/functions');
        const checkSharedAccess = httpsCallable<Record<string, never>, SharedCensusAccessResult>(
          functions,
          'checkSharedCensusAccess'
        );
        const response = await checkSharedAccess({});

        if (!response.data?.authorized) {
          return { authorized: false, role: 'viewer' };
        }
        return {
          authorized: true,
          role: response.data.role === 'downloader' ? 'downloader' : 'viewer',
        };
      } catch (error) {
        sharedCensusAuthLogger.error('Shared census authorization check failed', error);
        return { authorized: false, role: 'viewer' };
      }
    },
  };
};

const sharedCensusAuthService = createSharedCensusAuthService();
export const checkSharedCensusAccess = sharedCensusAuthService.checkSharedCensusAccess;
