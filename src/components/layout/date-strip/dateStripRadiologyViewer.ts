import type React from 'react';

/** Patient row handed to the MMRAD viewer. */
export interface DateStripRadiologyPatient {
  bedId: string;
  label: string;
  patientName: string;
  rut: string;
  diagnosis?: string;
}

/** What the date strip hands the MMRAD viewer. */
export interface DateStripRadiologyViewerProps {
  isOpen: boolean;
  onClose: () => void;
  patients: DateStripRadiologyPatient[];
}

/**
 * The MMRAD viewer, loaded on demand. The authenticated shell composes it from
 * `features/radiology`, which shared layout cannot import.
 */
export type DateStripRadiologyViewer = React.ComponentType<DateStripRadiologyViewerProps>;
