import { sanitizeAppModuleForRole } from '@/shared/access/operationalAccessPolicy';
import type { AuthContextType } from '@/context/AuthContext';
import type { UseUIStateReturn } from '@/hooks/useUIState';

export const resolveSanitizedCurrentModule = ({
  role,
  currentModule,
}: {
  role: AuthContextType['role'];
  currentModule: UseUIStateReturn['currentModule'];
}): UseUIStateReturn['currentModule'] => sanitizeAppModuleForRole(role, currentModule);

export const buildAppShellReadyTelemetry = ({
  role,
  currentModule,
}: {
  role: AuthContextType['role'];
  currentModule: UseUIStateReturn['currentModule'];
}) => ({
  category: 'daily_record' as const,
  operation: 'app_shell_ready' as const,
  status: 'success' as const,
  context: {
    module: currentModule,
    role: role || 'viewer',
  },
});
