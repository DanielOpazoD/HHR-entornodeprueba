import { describe, expect, it } from 'vitest';
import {
  classifyConflictChangedContexts,
  resolveConflictDomainContextForPath,
} from '@/services/repositories/conflictResolutionDomainPolicy';

describe('conflictResolutionDomainPolicy', () => {
  it('classifies handoff paths inside beds as handoff context', () => {
    expect(resolveConflictDomainContextForPath('beds.R1.handoffNoteDayShift')).toBe('handoff');
    expect(resolveConflictDomainContextForPath('beds.R1.handoffNoteNightShift')).toBe('handoff');
    expect(resolveConflictDomainContextForPath('beds.R1.medicalHandoffEntries')).toBe('handoff');
    expect(resolveConflictDomainContextForPath('beds.R1.medicalHandoffNote')).toBe('handoff');
    expect(resolveConflictDomainContextForPath('medicalHandoffBySpecialty.cirugia')).toBe(
      'handoff'
    );
  });

  it('keeps non-handoff bed paths clinical and combines mixed contexts without duplicates', () => {
    expect(resolveConflictDomainContextForPath('beds.R1.pathology')).toBe('clinical');
    expect(resolveConflictDomainContextForPath('discharges')).toBe('movements');
    expect(resolveConflictDomainContextForPath('nursesDayShift')).toBe('staffing');

    expect(
      classifyConflictChangedContexts([
        'beds.R1.handoffNoteDayShift',
        'beds.R1.pathology',
        'medicalHandoffBySpecialty.cirugia',
      ])
    ).toEqual(['handoff', 'clinical']);
  });
});
