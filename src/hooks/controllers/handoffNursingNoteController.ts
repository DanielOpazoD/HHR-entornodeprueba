import type { PatientData } from '@/types/domain/patient';

import type { ShiftType } from '@/types/domain/shift';

export interface NursingNoteChangePlan {
  noteKey: 'handoffNoteDayShift' | 'handoffNoteNightShift';
  noteFields: Partial<PatientData>;
  oldNote: string;
  usesMultipleUpdate: boolean;
}

export const buildNursingNoteChangePlan = ({
  selectedShift,
  isNested,
  bed,
}: {
  selectedShift: ShiftType;
  isNested: boolean;
  bed: PatientData | undefined;
}): NursingNoteChangePlan => {
  const oldNote =
    selectedShift === 'day'
      ? isNested
        ? bed?.clinicalCrib?.handoffNoteDayShift
        : bed?.handoffNoteDayShift
      : isNested
        ? bed?.clinicalCrib?.handoffNoteNightShift
        : bed?.handoffNoteNightShift;

  if (selectedShift === 'day') {
    return {
      noteKey: 'handoffNoteDayShift',
      noteFields: {
        handoffNoteDayShift: '',
        handoffNoteNightShift: '',
      },
      oldNote: oldNote || '',
      usesMultipleUpdate: true,
    };
  }

  return {
    noteKey: 'handoffNoteNightShift',
    noteFields: {
      handoffNoteNightShift: '',
    },
    oldNote: oldNote || '',
    usesMultipleUpdate: false,
  };
};
