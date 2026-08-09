import { describe, expect, it, vi } from 'vitest';
import { collectNursingStaffingProposal } from '@/features/rayen-import/domain/collectNursingStaffingProposal';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import { createEmptyPatient } from '@/services/factories/patientFactory';

const record = {
  date: '2026-08-08',
  beds: {
    H1C1: {
      ...createEmptyPatient('H1C1'),
      patientName: 'Paciente Uno',
      clinicalEpisodeId: 'enc-1',
    },
    H1C2: {
      ...createEmptyPatient('H1C2'),
      patientName: 'Paciente Dos',
      clinicalEpisodeId: 'enc-2',
    },
  },
  discharges: [],
  transfers: [],
  cma: [],
  activeExtraBeds: [],
  lastUpdated: '2026-08-08T08:00:00.000Z',
} as DailyRecord;

describe('collectNursingStaffingProposal', () => {
  it('builds staffing from its own history-only read', async () => {
    const fetchHistory = vi.fn(async (encounterId: string) => ({
      nursingActivity: [
        {
          author: 'Ana Enfermera',
          role: 'Enfermera',
          recordedAt: '2026-08-08T10:30:00',
          source: 'vital-signs' as const,
        },
      ],
      encounterId,
    }));

    const proposal = await collectNursingStaffingProposal(record, {
      fetchHistory,
      nurseCatalog: ['Ana Enfermera'],
    });

    expect(fetchHistory).toHaveBeenCalledTimes(2);
    expect(proposal.day.names).toEqual(['Ana Enfermera']);
  });

  it('fails when every patient history source failed', async () => {
    await expect(
      collectNursingStaffingProposal(record, {
        fetchHistory: async () => ({ nursingActivity: [], error: 'sin respuesta' }),
      })
    ).rejects.toThrow(/actividad firmada/i);
  });

  it('rejects a partial roster when any attempted history source fails', async () => {
    const fetchHistory = vi.fn(async (encounterId: string) =>
      encounterId === 'enc-1'
        ? { nursingActivity: [], error: 'sin respuesta' }
        : { nursingActivity: [] }
    );

    await expect(collectNursingStaffingProposal(record, { fetchHistory })).rejects.toThrow(
      /toda la actividad firmada/i
    );
    expect(fetchHistory).toHaveBeenCalledTimes(2);
  });

  it('rejects the roster before reading histories when an occupied patient has no episode', async () => {
    const fetchHistory = vi.fn(async () => ({ nursingActivity: [] }));
    const incompleteRecord = {
      ...record,
      beds: {
        ...record.beds,
        H2C1: {
          ...createEmptyPatient('H2C1'),
          patientName: 'Paciente sin episodio',
        },
      },
    } as DailyRecord;

    await expect(
      collectNursingStaffingProposal(incompleteRecord, { fetchHistory })
    ).rejects.toThrow(/episodio clínico de todos los pacientes/i);
    expect(fetchHistory).not.toHaveBeenCalled();
  });
});
