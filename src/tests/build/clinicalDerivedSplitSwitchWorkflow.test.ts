import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { parseWorkflow } from './workflowYamlTestSupport';

const require = createRequire(import.meta.url);
const { CLINICAL_DERIVED_SPLIT_FROM_ENV, readClinicalDerivedSplitFrom } =
  require('../../../functions/lib/clinicalDerivedStore.js') as {
    CLINICAL_DERIVED_SPLIT_FROM_ENV: string;
    readClinicalDerivedSplitFrom: () => string | null;
  };

const ENV_FILE = 'functions/.env.hhr-pruebas';

const readWrittenSwitchValues = (): string[] => {
  const workflow = parseWorkflow(readFileSync('.github/workflows/deploy-functions.yml', 'utf8'));
  const runs = Object.values(workflow.jobs)
    .flatMap(job => job.steps)
    .map(step => step.run ?? '')
    .filter(run => run.includes(ENV_FILE));
  return runs.flatMap(run =>
    [...run.matchAll(new RegExp(`'${CLINICAL_DERIVED_SPLIT_FROM_ENV}=([^']*)'`, 'g'))].map(
      match => match[1]
    )
  );
};

describe('phase 1a split switch in the hhr-pruebas Functions deploy', () => {
  const previous = process.env[CLINICAL_DERIVED_SPLIT_FROM_ENV];

  afterEach(() => {
    if (previous === undefined) delete process.env[CLINICAL_DERIVED_SPLIT_FROM_ENV];
    else process.env[CLINICAL_DERIVED_SPLIT_FROM_ENV] = previous;
  });

  // Anything but a strict calendar date leaves the split off without an error, so a typo here
  // would silently skip the activation.
  it('writes exactly one start date, and the server reads it as on', () => {
    const values = readWrittenSwitchValues();
    expect(values).toHaveLength(1);

    process.env[CLINICAL_DERIVED_SPLIT_FROM_ENV] = values[0];
    expect(readClinicalDerivedSplitFrom()).toBe(values[0]);
  });
});
