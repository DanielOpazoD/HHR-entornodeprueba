import { describe, expect, it } from 'vitest';
import {
  countLabTrendVariables,
  filterLabTrendGroups,
  isLabTrendPointAbnormal,
} from '@/features/laboratory/controllers/labTrendFilterController';
import type { LabTrendGroup, LabTrendPoint } from '@/types/domain/labAnalyticsTypes';

const point = (
  date: string,
  isoDate: string,
  value: number,
  refMin = 10,
  refMax = 20
): LabTrendPoint => ({ date, isoDate, value, unit: 'U/L', refMin, refMax });

const groups: LabTrendGroup[] = [
  {
    label: 'Marcadores musculares',
    variables: {
      'CK Total': [
        point('01/08/2026 08:00', '2026-08-01', 12),
        point('09/08/2026 08:00', '2026-08-09', 25),
        point('10/08/2026 08:00', '2026-08-10', 18),
      ],
    },
  },
  {
    label: 'Función Renal',
    variables: {
      Creatinina: [
        point('09/08/2026 08:00', '2026-08-09', 1, 0.6, 1.2),
        point('10/08/2026 08:00', '2026-08-10', 1.1, 0.6, 1.2),
      ],
    },
  },
];

describe('labTrendFilterController', () => {
  it('filters relative ranges from the most recent result, not from the device date', () => {
    const filtered = filterLabTrendGroups(groups, {
      timeRange: '24h',
      searchTerm: '',
      onlyAbnormal: false,
    });

    expect(filtered[0].variables['CK Total'].map(result => result.date)).toEqual([
      '09/08/2026 08:00',
      '10/08/2026 08:00',
    ]);
    expect(filtered[1].variables.Creatinina).toHaveLength(2);
  });

  it('searches variables and clinical group labels without accents', () => {
    expect(
      filterLabTrendGroups(groups, {
        timeRange: 'all',
        searchTerm: 'funcion renal',
        onlyAbnormal: false,
      }).map(group => group.label)
    ).toEqual(['Función Renal']);

    expect(
      filterLabTrendGroups(groups, {
        timeRange: 'all',
        searchTerm: 'ck',
        onlyAbnormal: false,
      }).map(group => group.label)
    ).toEqual(['Marcadores musculares']);
  });

  it('keeps only variables with an abnormal value inside the selected range', () => {
    const filtered = filterLabTrendGroups(groups, {
      timeRange: '3d',
      searchTerm: '',
      onlyAbnormal: true,
    });

    expect(filtered.map(group => group.label)).toEqual(['Marcadores musculares']);
    expect(isLabTrendPointAbnormal(filtered[0].variables['CK Total'][0])).toBe(true);
  });

  it('counts the visible variables across clinical groups', () => {
    expect(countLabTrendVariables(groups)).toBe(2);
  });
});
