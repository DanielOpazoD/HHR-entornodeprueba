import { toTitleCaseName } from './rayenToPatientData';

export type ClinicalPanelCareActionStatus =
  | 'performed'
  | 'outside-plan'
  | 'not-performed'
  | 'pending'
  | 'suspended';

export interface ClinicalPanelCareAction {
  id: string;
  title: string;
  detail: string;
  schedule: string;
  author: string;
  performedAt: string;
  status: ClinicalPanelCareActionStatus;
}

export interface ClinicalPanelCareDay {
  day: string;
  label: string;
  actions: ClinicalPanelCareAction[];
}

type RawRow = Record<string, unknown>;

const str = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value).trim();

const flag = (value: unknown): boolean => {
  if (value === true || value === 1) return true;
  return ['true', '1', 's', 'si', 'sí'].includes(str(value).toLowerCase());
};

const marker = (value: unknown): boolean =>
  flag(value) || (!!value && typeof value === 'object' && Object.keys(value).length > 0);

const rows = (value: unknown): RawRow[] =>
  Array.isArray(value)
    ? value.filter((row): row is RawRow => !!row && typeof row === 'object')
    : [];

const dayKey = (raw: string): string => {
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const timestamp = Date.parse(raw);
  if (Number.isNaN(timestamp)) return '';
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const dayLabel = (day: string): string => {
  const match = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : day || 'Sin fecha';
};

const timeKey = (raw: string): number => {
  const timestamp = Date.parse(raw);
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const careStatus = (body: RawRow, header: RawRow): ClinicalPanelCareActionStatus => {
  if (flag(body.isSuspended) || flag(header.isSuspended)) return 'suspended';
  if (marker(body.doNotExecute)) return 'not-performed';
  if (flag(body.isPerformedOutSidePlanning)) return 'outside-plan';
  if (flag(body.isPerformed)) return 'performed';
  return 'pending';
};

/** Convert the whitelisted Ficha Medico care-plan response into compact day groups. */
export const parseClinicalCareDays = (headers: unknown[]): ClinicalPanelCareDay[] => {
  const byDay = new Map<string, ClinicalPanelCareAction[]>();
  let seq = 0;

  for (const header of rows(headers)) {
    for (const body of rows(header.carePlanBody)) {
      const title = str(body.title) || str(body.activity);
      if (!title) continue;
      const performedAt = str(body.administrationDate) || str(body.timestamp);
      const day = dayKey(str(header.scheduledDate) || str(header.labelDate) || performedAt);
      const bucket = byDay.get(day) ?? [];
      const activity = str(body.activity);
      bucket.push({
        id: str(body.entryGuid) || str(body.activityId) || `care-${seq++}`,
        title,
        detail:
          activity === title
            ? str(body.tag)
            : [activity, str(body.tag)].filter(Boolean).join(' · '),
        schedule: str(body.hoursRangeActi) || str(body.hoursRange) || str(header.label),
        author: toTitleCaseName(str(body.user)),
        performedAt,
        status: careStatus(body, header),
      });
      byDay.set(day, bucket);
    }
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, actions]) => ({
      day,
      label: dayLabel(day),
      actions: actions.sort((a, b) => timeKey(b.performedAt) - timeKey(a.performedAt)),
    }));
};
