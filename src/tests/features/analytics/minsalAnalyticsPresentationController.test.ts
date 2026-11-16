// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ANALYTICS_PRESENTATION_COPY,
  resolveAnalyticsPresentationCopy,
} from '@/features/analytics/controllers/minsalAnalyticsPresentationController';

describe('minsalAnalyticsPresentationController', () => {
  it('returns explicit labels for period and current snapshot metrics', () => {
    expect(resolveAnalyticsPresentationCopy()).toEqual(DEFAULT_ANALYTICS_PRESENTATION_COPY);
    expect(DEFAULT_ANALYTICS_PRESENTATION_COPY.periodOccupancyTitle).toBe('Ocupación del período');
    expect(DEFAULT_ANALYTICS_PRESENTATION_COPY.periodStayTitle).toBe('Estada media de egresos');
    expect(DEFAULT_ANALYTICS_PRESENTATION_COPY.periodStaySubtitle).toBe(
      'Σ días de estada / egresos del rango'
    );
    expect(DEFAULT_ANALYTICS_PRESENTATION_COPY.periodDischargesTitle).toBe('Egresos del período');
    expect(DEFAULT_ANALYTICS_PRESENTATION_COPY.periodDischargesSubtitle).toBe(
      'Total acumulado del rango seleccionado'
    );
    expect(DEFAULT_ANALYTICS_PRESENTATION_COPY.periodMortalitySubtitle).toBe(
      'Fallecidos sobre egresos acumulados del rango'
    );
    expect(DEFAULT_ANALYTICS_PRESENTATION_COPY.periodRotationSubtitle).toBe(
      'Índice estimado sobre el acumulado del rango'
    );
    expect(DEFAULT_ANALYTICS_PRESENTATION_COPY.trendTitle).toBe('Tendencia diaria de ocupación');
    expect(DEFAULT_ANALYTICS_PRESENTATION_COPY.trendOccupancyLabel).toBe('Ocupación del día');
    expect(DEFAULT_ANALYTICS_PRESENTATION_COPY.currentSnapshotTitle).toBe(
      'Último registro disponible'
    );
    expect(DEFAULT_ANALYTICS_PRESENTATION_COPY.currentSnapshotSubtitle).toBe(
      'Último registro disponible del rango seleccionado'
    );
    expect(DEFAULT_ANALYTICS_PRESENTATION_COPY.currentOccupancyLabel).toBe(
      'Ocupación del último registro'
    );
  });
});
