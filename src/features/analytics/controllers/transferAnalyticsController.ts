import { getActiveTransfers } from '@/application/census/movementTombstonePolicy';
import type { DailyRecord } from '@/features/analytics/contracts/analyticsDailyRecordContracts';
import { roundAnalyticsPercent as roundPercent } from '@/features/analytics/controllers/analyticsPercentageController';
import type { TransferData } from '@/types/domain/movements';

export type TransferAnalyticsCategory =
  | 'latam'
  | 'aerocardal'
  | 'fach'
  | 'armada'
  | 'other_air_ambulance'
  | 'other';

export interface TransferProviderSummary {
  key: Exclude<TransferAnalyticsCategory, 'latam' | 'other'>;
  label: string;
  count: number;
  percentOfAirAmbulance: number;
}

export interface TransferDailySummary {
  date: string;
  total: number;
  latam: number;
  aerocardal: number;
  armedForces: number;
  other: number;
}

export interface TransferAnalyticsDetail {
  id: string;
  date: string;
  time: string;
  patientName: string;
  rut: string;
  diagnosis: string;
  bedName: string;
  specialty: string;
  receivingCenter: string;
  evacuationMethod: string;
  evacuationMethodOther: string;
  category: TransferAnalyticsCategory;
}

export interface TransferAnalytics {
  totalTransfers: number;
  latam: number;
  airAmbulance: number;
  other: number;
  latamPercent: number;
  airAmbulancePercent: number;
  otherPercent: number;
  providers: TransferProviderSummary[];
  daily: TransferDailySummary[];
  details: TransferAnalyticsDetail[];
}

const normalizeSearchText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const includesAny = (value: string, needles: string[]): boolean =>
  needles.some(needle => value.includes(needle));

export const resolveTransferAnalyticsCategory = (
  transfer: Pick<TransferData, 'evacuationMethod' | 'evacuationMethodOther'>
): TransferAnalyticsCategory => {
  const method = normalizeSearchText(transfer.evacuationMethod || '');
  const detail = normalizeSearchText(transfer.evacuationMethodOther || '');
  const searchable = `${method} ${detail}`;

  if (searchable.includes('aerocardal')) return 'aerocardal';
  if (includesAny(searchable, ['fach', 'fuerza aerea'])) return 'fach';
  if (searchable.includes('armada')) return 'armada';
  if (method === 'otro') return 'other_air_ambulance';
  if (
    includesAny(searchable, [
      'avion ambulancia',
      'ambulancia aerea',
      'aeroambulancia',
      'aeroevac',
      'aeromedic',
    ])
  ) {
    return 'other_air_ambulance';
  }
  if (includesAny(searchable, ['avion comercial', 'latam', 'latama'])) return 'latam';
  return 'other';
};

const PROVIDER_LABELS: Record<TransferProviderSummary['key'], string> = {
  aerocardal: 'Aerocardal',
  fach: 'FACH',
  armada: 'Armada',
  other_air_ambulance: 'Otras empresas',
};

export const buildTransferAnalytics = (records: DailyRecord[]): TransferAnalytics => {
  const providerCounts: Record<TransferProviderSummary['key'], number> = {
    aerocardal: 0,
    fach: 0,
    armada: 0,
    other_air_ambulance: 0,
  };
  const daily: TransferDailySummary[] = [];
  const details: TransferAnalyticsDetail[] = [];
  let totalTransfers = 0;
  let latam = 0;
  let airAmbulance = 0;
  let other = 0;

  records
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date))
    .forEach(record => {
      const day: TransferDailySummary = {
        date: record.date,
        total: 0,
        latam: 0,
        aerocardal: 0,
        armedForces: 0,
        other: 0,
      };

      getActiveTransfers(record.transfers).forEach(transfer => {
        const category = resolveTransferAnalyticsCategory(transfer);
        totalTransfers += 1;
        day.total += 1;
        details.push({
          id: transfer.id,
          date: record.date,
          time: transfer.time || '',
          patientName: transfer.patientName || '',
          rut: transfer.rut || '',
          diagnosis: transfer.diagnosis || '',
          bedName: transfer.bedName || transfer.bedId || '',
          specialty: transfer.specialty || '',
          receivingCenter:
            transfer.receivingCenter === 'Otro'
              ? transfer.receivingCenterOther || 'Otro sin especificar'
              : transfer.receivingCenter || '',
          evacuationMethod: transfer.evacuationMethod || '',
          evacuationMethodOther: transfer.evacuationMethodOther || '',
          category,
        });

        if (category === 'latam') {
          latam += 1;
          day.latam += 1;
        } else if (category === 'other') {
          other += 1;
          day.other += 1;
        } else {
          airAmbulance += 1;
          providerCounts[category] += 1;
          if (category === 'aerocardal') day.aerocardal += 1;
          else if (category === 'fach' || category === 'armada') day.armedForces += 1;
          else day.other += 1;
        }
      });

      if (day.total > 0) daily.push(day);
    });

  return {
    totalTransfers,
    latam,
    airAmbulance,
    other,
    latamPercent: roundPercent(latam, totalTransfers),
    airAmbulancePercent: roundPercent(airAmbulance, totalTransfers),
    otherPercent: roundPercent(other, totalTransfers),
    providers: (Object.keys(providerCounts) as TransferProviderSummary['key'][]).map(key => ({
      key,
      label: PROVIDER_LABELS[key],
      count: providerCounts[key],
      percentOfAirAmbulance: roundPercent(providerCounts[key], airAmbulance),
    })),
    daily,
    details,
  };
};
