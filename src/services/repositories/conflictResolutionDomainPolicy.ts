export type ConflictDomainContext =
  | 'clinical'
  | 'staffing'
  | 'movements'
  | 'handoff'
  | 'metadata'
  | 'unknown';

export const ALL_CONFLICT_DOMAIN_CONTEXTS: readonly ConflictDomainContext[] = [
  'clinical',
  'staffing',
  'movements',
  'handoff',
  'metadata',
  'unknown',
] as const;

export const CONFLICT_CONTEXT_RUNBOOK_ACTIONS: Record<ConflictDomainContext, string> = {
  clinical: 'Validar que el merge preserve camas y pacientes antes de reintentar.',
  staffing: 'Confirmar staffing y turnos antes de aplicar la resolución sugerida.',
  movements: 'Corroborar altas, traslados y CMA contra el registro remoto.',
  handoff: 'Revisar notas de entrega y responsables del turno antes de confirmar.',
  metadata: 'Alinear timestamps, schemaVersion y campos de control antes de reabrir.',
  unknown: 'Inspeccionar paths afectados y escalar si el contexto no se puede clasificar.',
};

export const resolveConflictDomainContextForPath = (path: string): ConflictDomainContext => {
  if (path.toLowerCase().includes('handoff')) return 'handoff';
  if (path.startsWith('beds.')) return 'clinical';
  if (
    path.startsWith('nurses') ||
    path.startsWith('tens') ||
    path === 'activeExtraBeds' ||
    path.startsWith('activeExtraBeds.')
  ) {
    return 'staffing';
  }
  if (path.startsWith('discharges') || path.startsWith('transfers') || path.startsWith('cma')) {
    return 'movements';
  }
  if (
    path === 'date' ||
    path === 'lastUpdated' ||
    path === 'schemaVersion' ||
    path === 'dateTimestamp'
  ) {
    return 'metadata';
  }
  return 'unknown';
};

export const classifyConflictChangedContexts = (
  changedPaths: string[]
): ConflictDomainContext[] => {
  if (changedPaths.length === 0 || changedPaths.includes('*')) {
    return [...ALL_CONFLICT_DOMAIN_CONTEXTS].filter(context => context !== 'unknown');
  }

  return Array.from(new Set(changedPaths.map(resolveConflictDomainContextForPath)));
};
