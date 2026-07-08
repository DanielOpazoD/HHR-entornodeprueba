import type {
  SyncConvergenceDiagnostic,
  SyncConvergenceFinding,
  SyncConvergenceSeverity,
  SyncConvergenceStatus,
} from '@/services/observability/syncConvergenceDiagnostics';
import type {
  SyncRecoveryAction,
  SyncRecoveryActionKind,
  SyncRecoveryPlan,
} from '@/services/observability/syncRecoveryPlanner';

type SyncHealthModule = SyncConvergenceFinding['module'];

export interface BuildSyncHealthPackageInput {
  diagnostic: SyncConvergenceDiagnostic;
  recoveryPlan: SyncRecoveryPlan;
}

export interface SyncHealthFindingItem {
  type: SyncConvergenceFinding['type'];
  status: SyncConvergenceFinding['status'];
  severity: SyncConvergenceSeverity;
  module: SyncHealthModule;
  moduleLabel: string;
  path: string;
  message: string;
  affectedPatient?: string;
  evidence: SyncConvergenceFinding['evidence'];
}

export interface SyncHealthGroup {
  key: string;
  title: string;
  date?: string;
  patientName?: string;
  rut?: string;
  bedId?: string;
  moduleKeys: SyncHealthModule[];
  modules: string[];
  highestSeverity: SyncConvergenceSeverity;
  findings: SyncHealthFindingItem[];
}

export interface SyncHealthActionItem {
  action: SyncRecoveryActionKind;
  label: string;
  operatorText: string;
  safety: SyncRecoveryAction['safety'];
  target: string;
  reason: string;
}

export interface SyncHealthPackage {
  status: SyncConvergenceStatus | SyncRecoveryPlan['status'];
  statusLabel: string;
  summary: string;
  checkedAt: string;
  groups: SyncHealthGroup[];
  actions: SyncHealthActionItem[];
}

const MODULE_LABELS: Record<SyncHealthModule, string> = {
  censo: 'Censo diario',
  nursing_handoff: 'Entrega enfermería',
  medical_handoff: 'Entrega médica',
  sync: 'Sincronización local',
  recovery: 'Recuperación',
};

const STATUS_LABELS: Record<SyncHealthPackage['status'], string> = {
  healthy: 'Saludable',
  recoverable: 'Recuperable',
  needs_review: 'Requiere revisión',
  unsafe: 'Inseguro',
};

const SEVERITY_RANK: Record<SyncConvergenceSeverity, number> = {
  info: 1,
  warning: 2,
  critical: 3,
};

const ACTION_PRESENTATION: Record<
  SyncRecoveryActionKind,
  Pick<SyncHealthActionItem, 'label' | 'operatorText'>
> = {
  retry_outbox: {
    label: 'Reintentar cola local',
    operatorText:
      'Acción segura: reintentar o esperar drenaje de outbox antes de decidir una verdad clínica.',
  },
  mark_already_applied: {
    label: 'Confirmar mutación ya aplicada',
    operatorText:
      'Acción segura: la autoridad/remoto ya reconoció la mutación; corresponde cerrar el ack local.',
  },
  refresh_remote: {
    label: 'Refrescar remoto',
    operatorText:
      'Acción segura: comprobar si otro cliente ya convergió antes de preservar una versión.',
  },
  restore_snapshot: {
    label: 'Revisar snapshot antes de preservar',
    operatorText:
      'Requiere confirmación: comparar contexto clínico y preservar solo si la regla automática eligió mal.',
  },
  block_for_review: {
    label: 'Bloquear y revisar manualmente',
    operatorText:
      'No autorresolver: la corrección automática podría elegir una verdad clínica equivocada.',
  },
};

const readText = (value: unknown): string => String(value || '').trim();

const buildGroupKey = (finding: SyncConvergenceFinding): string => {
  const date = readText(finding.evidence.date);
  const rut = readText(finding.evidence.rut);
  const bedId = readText(finding.evidence.bedId);
  const patient = readText(finding.affectedPatient);
  return [date || 'sin-fecha', rut || patient || 'sin-paciente', bedId || finding.module].join(':');
};

const resolveHighestSeverity = (findings: SyncHealthFindingItem[]): SyncConvergenceSeverity =>
  findings.reduce<SyncConvergenceSeverity>(
    (highest, finding) =>
      SEVERITY_RANK[finding.severity] > SEVERITY_RANK[highest] ? finding.severity : highest,
    'info'
  );

const buildGroupTitle = ({
  patientName,
  rut,
  bedId,
  moduleLabel,
}: {
  patientName?: string;
  rut?: string;
  bedId?: string;
  moduleLabel: string;
}): string => {
  const parts = [patientName, rut, bedId].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : moduleLabel;
};

const toFindingItem = (finding: SyncConvergenceFinding): SyncHealthFindingItem => ({
  type: finding.type,
  status: finding.status,
  severity: finding.severity,
  module: finding.module,
  moduleLabel: MODULE_LABELS[finding.module],
  path: finding.path,
  message: finding.message,
  ...(finding.affectedPatient ? { affectedPatient: finding.affectedPatient } : {}),
  evidence: finding.evidence,
});

const buildGroups = (findings: SyncConvergenceFinding[]): SyncHealthGroup[] => {
  const groups = new Map<string, SyncHealthFindingItem[]>();
  findings.forEach(finding => {
    const key = buildGroupKey(finding);
    const current = groups.get(key) || [];
    current.push(toFindingItem(finding));
    groups.set(key, current);
  });

  return Array.from(groups.entries()).map(([key, groupFindings]) => {
    const first = groupFindings[0];
    const date = readText(first?.evidence.date) || undefined;
    const rut = readText(first?.evidence.rut) || undefined;
    const bedId = readText(first?.evidence.bedId) || undefined;
    const patientName = first?.affectedPatient;
    const moduleKeys = Array.from(new Set(groupFindings.map(finding => finding.module)));
    const modules = Array.from(new Set(groupFindings.map(finding => finding.moduleLabel)));
    return {
      key,
      title: buildGroupTitle({
        patientName,
        rut,
        bedId,
        moduleLabel: modules[0] || 'Sincronización clínica',
      }),
      ...(date ? { date } : {}),
      ...(patientName ? { patientName } : {}),
      ...(rut ? { rut } : {}),
      ...(bedId ? { bedId } : {}),
      moduleKeys,
      modules,
      highestSeverity: resolveHighestSeverity(groupFindings),
      findings: groupFindings,
    };
  });
};

const buildActionItems = (actions: SyncRecoveryAction[]): SyncHealthActionItem[] =>
  actions.map(action => ({
    action: action.action,
    ...ACTION_PRESENTATION[action.action],
    safety: action.safety,
    target: action.target,
    reason: action.reason,
  }));

const buildSummary = (diagnostic: SyncConvergenceDiagnostic, groups: SyncHealthGroup[]): string => {
  if (diagnostic.status === 'healthy') return diagnostic.summary;
  const findingCount = diagnostic.findings.length;
  const groupCount = groups.length;
  return `${STATUS_LABELS[diagnostic.status]}: ${findingCount} hallazgo(s) en ${groupCount} grupo(s) clínico(s).`;
};

export const buildSyncHealthPackage = ({
  diagnostic,
  recoveryPlan,
}: BuildSyncHealthPackageInput): SyncHealthPackage => {
  const groups = buildGroups(diagnostic.findings);
  return {
    status: diagnostic.status,
    statusLabel: STATUS_LABELS[diagnostic.status],
    summary: buildSummary(diagnostic, groups),
    checkedAt: diagnostic.checkedAt,
    groups,
    actions: buildActionItems(recoveryPlan.actions),
  };
};
