// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  buildHandoffNovedadesAuditEvent,
  buildHandoffNovedadesAuditPayload,
} from '@/hooks/controllers/handoffManagementPersistenceController';
import { buildUpdatedHandoffStaffRecord } from '@/domain/handoff/management';
import { executeUpdateHandoffStaff } from '@/application/handoff/handoffManagementUseCases';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataFactory } from '@/tests/factories/DataFactory';

const baseRecord = (): DailyRecord =>
  DataFactory.createMockDailyRecord('2026-03-07', {
    handoffNovedadesDayShift: 'Antes día',
    handoffNovedadesNightShift: 'Antes noche',
    nursesDayShift: ['Dia 1'],
    nursesNightShift: ['Noche 1'],
    tensDayShift: ['Tens Día'],
    tensNightShift: ['Tens Noche'],
    handoffNightReceives: ['Recibe Noche'],
  });

describe('handoffManagementPersistenceController', () => {
  it('builds novedades payloads using the previous content', () => {
    const payload = buildHandoffNovedadesAuditPayload(baseRecord(), 'day', 'Texto nuevo', 'u1');
    const auditEvent = buildHandoffNovedadesAuditEvent(baseRecord(), 'day', 'Texto nuevo', 'u1');

    expect(payload.details).toEqual(
      expect.objectContaining({
        shift: 'day',
        content: 'Texto nuevo',
        changes: {
          novedades: { old: 'Antes día', new: 'Texto nuevo' },
        },
      })
    );
    expect(auditEvent).toEqual(
      expect.objectContaining({
        action: 'HANDOFF_NOVEDADES_MODIFIED',
        entityId: '2026-03-07',
        authors: expect.any(String),
      })
    );
  });

  it('updates staff using canonical shift fields', () => {
    const updated = buildUpdatedHandoffStaffRecord(baseRecord(), 'night', 'receives', [
      'Recibe A',
      'Recibe B',
    ]);

    expect(updated.handoffNightReceives).toEqual(['Recibe A', 'Recibe B']);
    expect(updated.lastUpdated).toBeTypeOf('string');
  });

  it('persists the canonical staff shift fields', async () => {
    const saveRecord = vi.fn();
    const record = baseRecord();
    const outcome = await executeUpdateHandoffStaff({
      record,
      shift: 'day',
      type: 'receives',
      staffList: ['Recibe Día'],
      saveRecord,
    });
    expect(outcome.data?.updatedRecord.nursesNightShift).toEqual(['Recibe Día']);
    expect(saveRecord).toHaveBeenCalledWith(outcome.data?.updatedRecord, record);
    expect(saveRecord.mock.calls[0][1]).toBe(record);
  });
});
