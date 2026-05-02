import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readProjectFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('specialist medical handoff deployment contract', () => {
  it('keeps the specialist callable exported from the deployable Functions entrypoint', () => {
    const functionsIndex = readProjectFile('functions/index.js');
    const specialistFunctions = readProjectFile(
      'functions/lib/specialistMedicalHandoffFunctions.js'
    );

    expect(functionsIndex).toContain("require('./lib/specialistMedicalHandoffFunctions')");
    expect(functionsIndex).toContain('...createSpecialistMedicalHandoffFunctions({');
    expect(specialistFunctions).toContain('updateSpecialistMedicalHandoff');
    expect(specialistFunctions).toContain('functions.https.onCall');
  });

  it('documents the live deployment check for the callable false-CORS failure mode', () => {
    const handoffRunbook = readProjectFile('docs/HANDOFF_SPECIALIST_MEDICAL_WRITE_PATH.md');

    expect(handoffRunbook).toContain('functions:list');
    expect(handoffRunbook).toContain('functions:updateSpecialistMedicalHandoff');
    expect(handoffRunbook).toContain('curl -i -X OPTIONS');
    expect(handoffRunbook).toContain('404');
    expect(handoffRunbook).toContain('access-control-allow-origin');
  });
});
