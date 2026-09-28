import { expect } from 'vitest';
import { parse } from 'yaml';

export interface WorkflowJob {
  name?: string;
  needs?: string | string[];
  if?: string;
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  strategy?: { matrix: { group: string[] } };
  steps: Array<{
    name?: string;
    run?: string;
    uses?: string;
    if?: string;
    with?: Record<string, unknown>;
    env?: Record<string, string>;
  }>;
}

export const parseWorkflow = (text: string): { jobs: Record<string, WorkflowJob> } => parse(text);
export const jobNeeds = (job: WorkflowJob): string[] =>
  Array.isArray(job.needs) ? job.needs : job.needs ? [job.needs] : [];

export const assertTelemetryAccess = (job: WorkflowJob) => {
  expect(jobNeeds(job).sort()).toEqual(
    [
      'quality-static',
      'unit-risk',
      'clinical-sync-release-gate',
      'rules-emulator',
      'e2e-critical-emulator',
      'build',
    ].sort()
  );
  expect(job.permissions).toEqual({ actions: 'read', contents: 'read' });
  const checkout = job.steps.find(step => step.uses?.startsWith('actions/checkout@'));
  expect(checkout?.with?.['persist-credentials']).toBe(false);
};
