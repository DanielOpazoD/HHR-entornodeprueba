import type { ModuleType } from '@/constants/navigationConfig';

const MODULES_FROM_URL: readonly ModuleType[] = [
  'CENSUS',
  'ANALYTICS',
  'CUDYR',
  'NURSING_HANDOFF',
  'MEDICAL_HANDOFF',
  'AUDIT',
  'WHATSAPP',
  'TRANSFER_MANAGEMENT',
  'BACKUP_FILES',
  'PATIENT_MASTER_INDEX',
  'DATA_MAINTENANCE',
  'DIAGNOSTICS',
  'FUNCTIONS_TELEMETRY',
  'CONFIGURATION',
  'DATA',
  'COMMUNICATIONS',
  'ROLE_MANAGEMENT',
  'REMINDERS',
] as const;

export const MODULE_PATH_SEGMENTS: Record<ModuleType, string> = {
  CENSUS: 'census',
  ANALYTICS: 'statistics',
  CUDYR: 'cudyr',
  NURSING_HANDOFF: 'nursing-handoff',
  MEDICAL_HANDOFF: 'medical-handoff',
  AUDIT: 'audit',
  WHATSAPP: 'whatsapp',
  TRANSFER_MANAGEMENT: 'transfer-management',
  BACKUP_FILES: 'backup-files',
  PATIENT_MASTER_INDEX: 'patient-master-index',
  DATA_MAINTENANCE: 'data-maintenance',
  DIAGNOSTICS: 'diagnostics',
  FUNCTIONS_TELEMETRY: 'functions-telemetry',
  CONFIGURATION: 'configuration',
  DATA: 'data',
  COMMUNICATIONS: 'communications',
  ROLE_MANAGEMENT: 'role-management',
  REMINDERS: 'reminders',
};

const MODULE_FROM_PATH_SEGMENT = Object.fromEntries(
  Object.entries(MODULE_PATH_SEGMENTS).map(([module, segment]) => [segment, module])
) as Record<string, ModuleType>;

export const resolveModuleFromPathname = (pathname: string | undefined): ModuleType | null => {
  const pathSegment = (pathname ?? '/').replace(/^\/+|\/+$/g, '');
  if (!pathSegment) {
    return 'CENSUS';
  }

  if (pathSegment && MODULE_FROM_PATH_SEGMENT[pathSegment]) {
    return MODULE_FROM_PATH_SEGMENT[pathSegment];
  }

  return null;
};

export const resolveInitialModuleFromLocation = ({
  pathname,
  search,
}: {
  pathname: string | undefined;
  search: string | undefined;
}): ModuleType => {
  const normalizedPath = (pathname ?? '/').replace(/^\/+|\/+$/g, '');

  if (normalizedPath) {
    const moduleFromPath = resolveModuleFromPathname(pathname);
    if (moduleFromPath) {
      return moduleFromPath;
    }
  }

  const params = new URLSearchParams(search ?? '');
  const rawModule = params.get('module');
  if (rawModule && MODULES_FROM_URL.includes(rawModule as ModuleType)) {
    return rawModule as ModuleType;
  }

  return 'CENSUS';
};

const shouldPreserveDateParamForModule = (module: ModuleType, url: URL): boolean =>
  module === 'CENSUS' && url.searchParams.has('date');

export const resolveSyncedModuleUrl = ({
  module,
  href,
}: {
  module: ModuleType;
  href: string;
}): URL => {
  const url = new URL(href);
  url.pathname = `/${MODULE_PATH_SEGMENTS[module]}`;
  url.searchParams.delete('module');
  if (!shouldPreserveDateParamForModule(module, url)) {
    url.searchParams.delete('date');
  }
  return url;
};

export const syncModuleToUrl = (module: ModuleType): void => {
  if (typeof window === 'undefined') {
    return;
  }

  const url = resolveSyncedModuleUrl({
    module,
    href: window.location.href,
  });
  window.history.replaceState(window.history.state, '', url);
};

export const shouldShowPrintButtonForModule = (module: ModuleType): boolean =>
  module === 'CUDYR' || module === 'NURSING_HANDOFF' || module === 'MEDICAL_HANDOFF';
