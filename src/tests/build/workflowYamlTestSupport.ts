import { expect } from 'vitest';
import { parse } from 'yaml';

export interface WorkflowJob {
  'runs-on'?: string | string[];
  name?: string;
  uses?: string;
  needs?: string | string[];
  if?: string;
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  strategy?: { 'fail-fast'?: boolean; matrix: Record<string, Array<string | number>> };
  steps: Array<{
    name?: string;
    run?: string;
    uses?: string;
    if?: string;
    with?: Record<string, unknown>;
    env?: Record<string, string>;
    'timeout-minutes'?: number;
    'continue-on-error'?: boolean;
  }>;
}

export const parseWorkflow = (text: string): { jobs: Record<string, WorkflowJob> } => {
  const workflow = parse(text);
  for (const job of Object.values(workflow.jobs) as WorkflowJob[]) {
    // Reusable workflow calls have no local steps; preserve their uses field.
    job.steps ??= [];
  }
  return workflow;
};
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
