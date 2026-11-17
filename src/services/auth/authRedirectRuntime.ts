import { getAuthRedirectEnvironment } from '@/services/auth/authRedirectEnvironment';
import {
  buildAuthRedirectRuntimeSupport,
  type AuthRedirectRuntimeSupport,
} from '@/services/auth/authRedirectSupportController';

export type { AuthRedirectRuntimeSupport } from '@/services/auth/authRedirectSupportController';

export const getAuthRedirectRuntimeSupport = (): AuthRedirectRuntimeSupport =>
  buildAuthRedirectRuntimeSupport(getAuthRedirectEnvironment());
