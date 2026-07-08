import { describe, expect, it } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  buildMedicalSpecialtyActor,
  buildMedicalSpecialtySectionViewModel,
  buildMedicalSpecialtyTabsState,
  buildMedicalSpecialtyTabState,
  buildMedicalHandoffSummary,
  buildPrintableMedicalSpecialtyBlocks,
  hasMedicalSpecialtyStructuredData,
  resolveActiveMedicalSpecialty,
  resolveMedicalSpecialtyContinuityEditorState,
  resolveMedicalSpecialtyContinuityDraft,
  resolveMedicalSpecialtyDailyStatus,
} from '@/features/handoff/controllers/medicalSpecialtyHandoffController';

describe('medicalSpecialtyHandoffController', () => {
  it('resolves specialty status from same-day update', () => {
    expect(
      resolveMedicalSpecialtyDailyStatus(
        {
          note: 'Paciente estable',
          createdAt: '2026-03-01T08:00:00.000Z',
          updatedAt: '2026-03-03T10:00:00.000Z',
          author: {
            uid: '1',
            displayName: 'Dr. Test',
            email: 'test@hospitalhangaroa.cl',
          },
          version: 1,
        },
        '2026-03-03'
      )
    ).toBe('updated_by_specialist');
  });

  it('builds a legacy-compatible summary from specialty notes', () => {
    const record = {
      date: '2026-03-03',
      medicalHandoffNovedades: '',
      medicalHandoffBySpecialty: {
        cirugia: {
          note: 'Paciente sin cambios.',
          createdAt: '2026-03-02T08:00:00.000Z',
          updatedAt: '2026-03-02T08:00:00.000Z',
          author: {
            uid: '1',
            displayName: 'Dr. Cirugía',
            email: 'cirugia@hospitalhangaroa.cl',
            specialty: 'cirugia',
          },
          version: 1,
          dailyContinuity: {
            '2026-03-03': {
              status: 'confirmed_no_changes',
              comment: 'Condición actual sin cambios.',
            },
          },
        },
      },
    } as Pick<DailyRecord, 'date' | 'medicalHandoffNovedades' | 'medicalHandoffBySpecialty'>;

    const summary = buildMedicalHandoffSummary(record);

    expect(summary).toContain('Cirugía');
    expect(summary).toContain('Paciente sin cambios.');
    expect(summary).toContain('Condición actual sin cambios.');
  });

  it('resolves screen policies for active specialty, continuity draft and actor', () => {
    expect(
      resolveActiveMedicalSpecialty({
        activeSpecialty: 'traumatologia',
        editableSpecialties: ['cirugia', 'pediatria'],
      })
    ).toBe('cirugia');

    expect(
      resolveMedicalSpecialtyContinuityDraft({
        drafts: {},
        specialty: 'cirugia',
        note: {
          note: 'Paciente estable',
          createdAt: '2026-03-02T08:00:00.000Z',
          updatedAt: '2026-03-02T08:00:00.000Z',
          author: {
            uid: '1',
            displayName: 'Dr. Cirugía',
            email: 'cirugia@hospitalhangaroa.cl',
          },
          version: 1,
          dailyContinuity: {
            '2026-03-03': {
              status: 'confirmed_no_changes',
              comment: 'Sin cambios',
            },
          },
        },
        dateKey: '2026-03-03',
      })
    ).toBe('Sin cambios');

    expect(
      buildMedicalSpecialtyActor(
        {
          uid: 'user-1',
          email: 'test@hospitalhangaroa.cl',
          displayName: 'Usuario Test',
        } as never,
        'admin'
      )
    ).toEqual({
      uid: 'user-1',
      email: 'test@hospitalhangaroa.cl',
      displayName: 'Usuario Test',
      role: 'admin',
    });
  });

  it('detects specialty data and builds printable blocks', () => {
    const record = {
      date: '2026-03-03',
      medicalHandoffBySpecialty: {
        cirugia: {
          note: 'Paciente sin cambios.',
          createdAt: '2026-03-02T08:00:00.000Z',
          updatedAt: '2026-03-02T08:00:00.000Z',
          author: {
            uid: '1',
            displayName: 'Dr. Cirugía',
            email: 'cirugia@hospitalhangaroa.cl',
            specialty: 'cirugia',
          },
          version: 1,
          dailyContinuity: {
            '2026-03-03': {
              status: 'confirmed_no_changes',
              comment: '',
            },
          },
        },
      },
    } as Pick<DailyRecord, 'date' | 'medicalHandoffBySpecialty'>;

    expect(hasMedicalSpecialtyStructuredData(record)).toBe(true);
    expect(buildPrintableMedicalSpecialtyBlocks(record)).toEqual([
      {
        specialty: 'cirugia',
        title: 'Cirugía',
        content: 'Paciente sin cambios.',
        continuityComment:
          'Condición actual sin cambios respecto a última entrega de especialista.',
      },
    ]);
  });

  it('builds tab state and continuity editor state from the same specialty policy', () => {
    expect(
      buildMedicalSpecialtyTabState({
        specialty: 'cirugia',
        record: {
          medicalHandoffBySpecialty: {
            cirugia: {
              note: 'Paciente estable',
              createdAt: '2026-03-02T08:00:00.000Z',
              updatedAt: '2026-03-03T08:00:00.000Z',
              author: {
                uid: '1',
                displayName: 'Dr. Cirugía',
                email: 'cirugia@hospitalhangaroa.cl',
              },
              version: 1,
            },
          },
        } as never,
        dateKey: '2026-03-03',
        editableSpecialties: ['cirugia'],
        readOnly: false,
        activeSpecialty: 'cirugia',
      })
    ).toEqual({
      specialty: 'cirugia',
      label: 'Cirugía',
      status: 'updated_by_specialist',
      isEditable: true,
      isActive: true,
    });

    expect(
      resolveMedicalSpecialtyContinuityEditorState({
        role: 'nurse_hospital',
        readOnly: false,
        activeStatus: 'pending',
      })
    ).toEqual({
      canConfirmToday: true,
      isCommentDisabled: false,
      helperText:
        'Usa este comentario cuando la condición permanezca sin cambios respecto a la última nota del especialista.',
    });
  });

  it('builds the active specialty section view model from a single policy resolver', () => {
    const viewModel = buildMedicalSpecialtySectionViewModel({
      record: {
        date: '2026-03-03',
        medicalHandoffBySpecialty: {
          cirugia: {
            note: 'Paciente estable',
            createdAt: '2026-03-02T08:00:00.000Z',
            updatedAt: '2026-03-02T08:00:00.000Z',
            author: {
              uid: '1',
              displayName: 'Dr. Cirugía',
              email: 'cirugia@hospitalhangaroa.cl',
            },
            version: 1,
            dailyContinuity: {
              '2026-03-03': {
                status: 'confirmed_no_changes',
                comment: 'Mantener conducta',
              },
            },
          },
        },
      } as never,
      role: 'nurse_hospital',
      readOnly: false,
      activeSpecialty: 'traumatologia',
      editableSpecialties: ['cirugia'],
      continuityDrafts: {},
    });

    expect(viewModel.resolvedActiveSpecialty).toBe('cirugia');
    expect(viewModel.activeStatus).toBe('confirmed_no_changes');
    expect(viewModel.activeContinuityDraft).toBe('Mantener conducta');
    expect(viewModel.canEditActiveSpecialty).toBe(true);
    expect(viewModel.hasSpecialtyData).toBe(true);
    expect(viewModel.printableBlocks).toHaveLength(1);
    expect(viewModel.continuityEditorState.canConfirmToday).toBe(true);
    expect(viewModel.tabStates).toHaveLength(6);
  });

  it('builds the tab list from the same specialty policy', () => {
    const tabStates = buildMedicalSpecialtyTabsState({
      record: {
        medicalHandoffBySpecialty: {
          cirugia: {
            note: 'Paciente estable',
            createdAt: '2026-03-02T08:00:00.000Z',
            updatedAt: '2026-03-03T08:00:00.000Z',
            author: {
              uid: '1',
              displayName: 'Dr. Cirugía',
              email: 'cirugia@hospitalhangaroa.cl',
            },
            version: 1,
          },
        },
      } as never,
      dateKey: '2026-03-03',
      editableSpecialties: ['cirugia'],
      readOnly: false,
      activeSpecialty: 'cirugia',
    });

    expect(tabStates[0]).toEqual({
      specialty: 'cirugia',
      label: 'Cirugía',
      status: 'updated_by_specialist',
      isEditable: true,
      isActive: true,
    });
    expect(tabStates).toHaveLength(6);
  });
});

// ===========================================================================
// Branch coverage backfill for the controller's small pure helpers.
// Targets the read-only / no-claim / fallback / role-table branches that
// the integrated specs above exercise only along the happy path.
// ===========================================================================
describe('medicalSpecialtyHandoffController — branch coverage backfill', () => {
  describe('resolveMedicalSpecialtyDailyStatus', () => {
    it('returns "pending" when the note is undefined', () => {
      expect(resolveMedicalSpecialtyDailyStatus(undefined, '2026-05-03')).toBe('pending');
    });

    it('returns "pending" when neither updatedAt nor continuity matches the date', () => {
      const note = {
        note: 'X',
        updatedAt: '2026-04-30T12:00:00Z',
        dailyContinuity: { '2026-05-02': { status: 'updated_by_specialist' } },
      } as unknown as Parameters<typeof resolveMedicalSpecialtyDailyStatus>[0];
      expect(resolveMedicalSpecialtyDailyStatus(note, '2026-05-03')).toBe('pending');
    });

    it('returns "confirmed_no_changes" when continuity for the date confirms it', () => {
      const note = {
        note: 'X',
        updatedAt: '2026-04-30T12:00:00Z',
        dailyContinuity: { '2026-05-03': { status: 'confirmed_no_changes' } },
      } as unknown as Parameters<typeof resolveMedicalSpecialtyDailyStatus>[0];
      expect(resolveMedicalSpecialtyDailyStatus(note, '2026-05-03')).toBe('confirmed_no_changes');
    });

    it('returns "updated_by_specialist" via continuity when updatedAt is on a different date', () => {
      const note = {
        note: 'X',
        updatedAt: '2026-04-30T12:00:00Z',
        dailyContinuity: { '2026-05-03': { status: 'updated_by_specialist' } },
      } as unknown as Parameters<typeof resolveMedicalSpecialtyDailyStatus>[0];
      expect(resolveMedicalSpecialtyDailyStatus(note, '2026-05-03')).toBe('updated_by_specialist');
    });

    it('returns "pending" when updatedAt is missing and no continuity exists', () => {
      const note = { note: 'X' } as Parameters<typeof resolveMedicalSpecialtyDailyStatus>[0];
      expect(resolveMedicalSpecialtyDailyStatus(note, '2026-05-03')).toBe('pending');
    });
  });

  describe('resolveActiveMedicalSpecialty', () => {
    it('returns the active specialty when it is in the editable list', () => {
      expect(
        resolveActiveMedicalSpecialty({
          activeSpecialty: 'cirugia',
          editableSpecialties: ['cirugia', 'pediatria'],
        })
      ).toBe('cirugia');
    });

    it('falls back to the first editable when active is not in the editable list', () => {
      expect(
        resolveActiveMedicalSpecialty({
          activeSpecialty: 'pediatria',
          editableSpecialties: ['cirugia', 'traumatologia'],
        })
      ).toBe('cirugia');
    });

    it('returns the active specialty when there is no editable list (read-only mode)', () => {
      expect(
        resolveActiveMedicalSpecialty({
          activeSpecialty: 'cirugia',
          editableSpecialties: [],
        })
      ).toBe('cirugia');
    });
  });

  describe('buildMedicalSpecialtyActor', () => {
    it('builds an actor with all four fields when the user has email and displayName', () => {
      expect(
        buildMedicalSpecialtyActor(
          {
            uid: 'u1',
            email: 'doctor@hospital.cl',
            displayName: 'Dra. X',
          } as Parameters<typeof buildMedicalSpecialtyActor>[0],
          'doctor_hospital'
        )
      ).toEqual({
        uid: 'u1',
        email: 'doctor@hospital.cl',
        displayName: 'Dra. X',
        role: 'doctor_hospital',
      });
    });

    it('falls back to email as displayName when displayName is empty', () => {
      expect(
        buildMedicalSpecialtyActor(
          { uid: 'u1', email: 'doctor@hospital.cl', displayName: '' } as Parameters<
            typeof buildMedicalSpecialtyActor
          >[0],
          'doctor_hospital'
        ).displayName
      ).toBe('doctor@hospital.cl');
    });

    it('returns undefined fields when the user is null', () => {
      expect(buildMedicalSpecialtyActor(null, 'doctor_hospital')).toEqual({
        uid: undefined,
        email: undefined,
        displayName: undefined,
        role: 'doctor_hospital',
      });
    });

    it('returns undefined fields when the user is undefined and role is omitted', () => {
      expect(buildMedicalSpecialtyActor(undefined)).toEqual({
        uid: undefined,
        email: undefined,
        displayName: undefined,
        role: undefined,
      });
    });
  });
});
