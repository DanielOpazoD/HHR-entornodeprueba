import type { PatientData } from '../contracts/rayenDomainContracts';
import type { ClinicalSyncSource } from '@/types/domain/clinicalSync';
import {
  mergeClinicalSourceCheckpoint,
  type ClinicalIncrementalMetrics,
  type ClinicalSourceFact,
} from './clinicalIncrementalSync';

export const createClinicalCheckpointAccumulator = (
  patient: PatientData,
  metrics: ClinicalIncrementalMetrics,
  onChange: (checkpoint: NonNullable<PatientData['clinicalSyncCheckpoint']>) => void
) => {
  let checkpoint = patient.clinicalSyncCheckpoint;
  return (
    source: ClinicalSyncSource,
    facts: ClinicalSourceFact[],
    options: { fullValidationAt?: string; fullValidationAttemptAt?: string } = {}
  ): void => {
    const result = mergeClinicalSourceCheckpoint(checkpoint, source, facts, options);
    checkpoint = result.checkpoint;
    metrics.received += result.metrics.received;
    metrics.newFacts += result.metrics.newFacts;
    metrics.duplicates += result.metrics.duplicates;
    metrics.corrections += result.metrics.corrections;
    if (result.changed) onChange(checkpoint);
  };
};
