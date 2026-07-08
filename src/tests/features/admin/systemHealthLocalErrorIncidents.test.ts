import { describe, expect, it } from 'vitest';
import { buildSystemHealthIncidentRows } from '@/features/admin/components/systemHealthIncidentUtils';
import { baseStatus } from './systemHealthIncidentTestFixtures';

describe('systemHealthLocalErrorIncidents', () => {
  it('does not promote low local error counters without recent event detail', () => {
    const rows = buildSystemHealthIncidentRows(
      baseStatus({
        localErrorCount: 1,
      })
    );

    expect(rows).toEqual([]);
  });

  it('keeps high local error counters actionable when granular events are missing', () => {
    const rows = buildSystemHealthIncidentRows(
      baseStatus({
        localErrorCount: 100,
      })
    );

    expect(rows[0]).toMatchObject({
      id: 'u1:local-errors',
      title: '100 error(es) locales acumulados sin detalle reciente',
      severity: 'critical',
      originLabel: 'Navegador del usuario / contador_local_acumulado',
      actionLabel: 'Limpiar usuario y monitorear si reaparece con detalle',
      routeLabel: 'Contador local sin evento granular',
    });
  });
});
