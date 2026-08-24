import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const workflowPaths = ['.github/workflows/ci-cd.yml', '.github/workflows/nightly-test-runtime.yml'];

describe('GitHub Action runtime versions', () => {
  it('uses the supported setup-java major in every Java workflow', () => {
    const workflows = workflowPaths.map(workflowPath =>
      fs.readFileSync(path.join(process.cwd(), workflowPath), 'utf8')
    );
    const setupJavaUses = workflows.flatMap(
      workflow => workflow.match(/actions\/setup-java@[^\s]+/g) ?? []
    );

    expect(setupJavaUses).toHaveLength(3);
    expect(setupJavaUses).toEqual(Array(3).fill('actions/setup-java@v5'));
  });
});
