import type { PatientData } from '@/types/domain/patient';

import type { NursingShift } from '@/hooks/useHandoffVisibility';

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
  selectedShift: NursingShift;
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
