import type { MinsalStatistics } from '@/features/analytics/types/minsalTypes';

export interface AnalyticsPresentationCopy {
  periodOccupancyTitle: string;
  periodOccupancySubtitle: string;
  periodStayTitle: string;
  periodStaySubtitle: string;
  periodDischargesTitle: string;
  periodDischargesSubtitle: string;
  periodMortalityTitle: string;
  periodMortalitySubtitle: string;
  periodRotationTitle: string;
  periodRotationSubtitle: string;
  periodBedDaysTitle: string;
  periodBedDaysSubtitle: string;
  trendTitle: string;
  trendSubtitle: string;
  trendOccupancyLabel: string;
  trendAverageLabel: string;
  currentSnapshotTitle: string;
  currentSnapshotSubtitle: string;
  currentOccupancyLabel: string;
}

export const DEFAULT_ANALYTICS_PRESENTATION_COPY: AnalyticsPresentationCopy = {
  periodOccupancyTitle: 'Ocupación del período',
  periodOccupancySubtitle: 'Promedio del rango seleccionado',
  periodStayTitle: 'Estada media de egresos',
  periodStaySubtitle: 'Σ días de estada / egresos del rango',
  periodDischargesTitle: 'Egresos del período',
  periodDischargesSubtitle: 'Total acumulado del rango seleccionado',
  periodMortalityTitle: 'Mortalidad del período',
  periodMortalitySubtitle: 'Fallecidos sobre egresos acumulados del rango',
  periodRotationTitle: 'Rotación del período',
  periodRotationSubtitle: 'Índice estimado sobre el acumulado del rango',
  periodBedDaysTitle: 'Días cama del período',
  periodBedDaysSubtitle: 'Acumulado ocupado dentro del rango seleccionado',
  trendTitle: 'Tendencia diaria de ocupación',
  trendSubtitle: 'Serie diaria del rango seleccionado',
  trendOccupancyLabel: 'Ocupación del día',
  trendAverageLabel: 'Promedio del período',
  currentSnapshotTitle: 'Último registro disponible',
  currentSnapshotSubtitle: 'Último registro disponible del rango seleccionado',
  currentOccupancyLabel: 'Ocupación del último registro',
};

export const resolveAnalyticsPresentationCopy = (): AnalyticsPresentationCopy =>
  DEFAULT_ANALYTICS_PRESENTATION_COPY;

interface ResolveDisplayedMinsalStatsParams {
  localStats: MinsalStatistics | null;
  remoteStats: MinsalStatistics | null | undefined;
}

/**
 * Keeps analytics KPIs and trend cards on the same statistical source.
 * Local range stats are preferred because trend data and specialty tables are
 * built from the same synchronized record set already loaded in the client.
 */
export const resolveDisplayedMinsalStats = ({
  localStats,
  remoteStats,
}: ResolveDisplayedMinsalStatsParams): MinsalStatistics | null => {
  if (localStats) {
    return localStats;
  }

  return remoteStats ?? null;
};
