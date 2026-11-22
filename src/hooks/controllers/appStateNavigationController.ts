import type { ModuleType } from '@/constants/navigationConfig';

// MEDICAL_HANDOFF is only the permission behind the census Excel button: it has no screen, so no
// path or `?module=` opens it.
const MODULES_FROM_URL: readonly ModuleType[] = [
  'CENSUS',
  'ANALYTICS',
  'CUDYR',
  'NURSING_HANDOFF',
  'AUDIT',
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
  'AUDIT_DOCUMENTS',
  'ADMISSION_AUDIT',
] as const;

export const MODULE_PATH_SEGMENTS: Record<ModuleType, string> = {
  CENSUS: 'census',
  ANALYTICS: 'statistics',
  CUDYR: 'cudyr',
  NURSING_HANDOFF: 'nursing-handoff',
  MEDICAL_HANDOFF: 'census', // no screen: see MODULES_FROM_URL
  AUDIT: 'audit',
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
  AUDIT_DOCUMENTS: 'audit-documents',
  ADMISSION_AUDIT: 'admission-audit',
};

const MODULE_FROM_PATH_SEGMENT = Object.fromEntries(
  MODULES_FROM_URL.map(module => [MODULE_PATH_SEGMENTS[module], module])
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

const DATE_SCOPED_MODULES: readonly ModuleType[] = ['CENSUS', 'NURSING_HANDOFF', 'CUDYR'];

export const resolveSyncedModuleUrl = ({
  module,
  href,
  date,
}: {
  module: ModuleType;
  href: string;
  date?: string;
}): URL => {
  const url = new URL(href);
  url.pathname = `/${MODULE_PATH_SEGMENTS[module]}`;
  url.searchParams.delete('module');
  if (DATE_SCOPED_MODULES.includes(module)) {
    if (date) url.searchParams.set('date', date);
  } else url.searchParams.delete('date');
  return url;
};

export const syncModuleToUrl = ({ module, date }: { module: ModuleType; date?: string }): void => {
  if (typeof window === 'undefined') {
    return;
  }

  const url = resolveSyncedModuleUrl({
    module,
    href: window.location.href,
    date,
  });
  window.history.replaceState(window.history.state, '', url);
};

export const shouldShowPrintButtonForModule = (module: ModuleType): boolean =>
  module === 'CUDYR' || module === 'NURSING_HANDOFF';
