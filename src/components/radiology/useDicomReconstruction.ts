import { useEffect, useState } from 'react';
import type { DicomRuntime } from '@/services/radiology/dicomRuntimeTypes';
import type { MprReconstructionState } from '@/services/radiology/dicomMprReconstruction';
export const useDicomReconstruction = (runtime: DicomRuntime | null) => {
  const [state, setState] = useState<MprReconstructionState | null>(null);
  useEffect(() => runtime?.onReconstruction?.(setState), [runtime]);
  return state;
};
