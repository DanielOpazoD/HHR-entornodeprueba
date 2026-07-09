import { describe, expect, it } from 'vitest';
import {
  findForbiddenTrackedPaths,
  findSecretLeakFailuresForFile,
} from '../../../scripts/lib/secretLeakChecks.mjs';

const buildPrivateKeyFixture = () =>
  ['-----BEGIN ', 'PRIVATE KEY-----\\nabc\\n-----END ', 'PRIVATE KEY-----\\n'].join('');

describe('secretLeakChecks', () => {
  it('flags forbidden tracked credential filenames', () => {
    expect(findForbiddenTrackedPaths(['functions/llave-beta.json'])).toEqual([
      'functions/llave-beta.json',
    ]);
    expect(findForbiddenTrackedPaths(['functions/firebase-adminsdk-prod.json'])).toEqual([
      'functions/firebase-adminsdk-prod.json',
    ]);
  });

  it('flags Google Cloud service account JSON payloads', () => {
    const failures = findSecretLeakFailuresForFile({
      file: 'secrets/dev.json',
      content: JSON.stringify(
        {
          type: 'service_account',
          private_key: buildPrivateKeyFixture(),
          client_email: 'firebase-adminsdk@test-project.iam.gserviceaccount.com',
        },
        null,
        2
      ),
    });

    expect(failures.map(failure => failure.check.id)).toContain('tracked-gcp-service-account-json');
    expect(failures.map(failure => failure.check.id)).toContain('tracked-private-key-material');
  });

  it('flags standalone private key material even outside service account JSON', () => {
    const failures = findSecretLeakFailuresForFile({
      file: 'notes.txt',
      content: `temporary key\\n${buildPrivateKeyFixture()}`,
    });

    expect(failures.map(failure => failure.check.id)).toContain('tracked-private-key-material');
  });

  it('does not flag the detector implementation for its own private-key regex literal', () => {
    const failures = findSecretLeakFailuresForFile({
      file: 'scripts/lib/secretLeakChecks.mjs',
      content: 'hasPattern(content, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/)',
    });

    expect(failures).toEqual([]);
  });

  it('flags hardcoded Firebase web configuration inside source files', () => {
    const failures = findSecretLeakFailuresForFile({
      file: 'src/services/storage/legacyfirebase/legacyFirebaseCore.ts',
      content: [
        'const config = {',
        "  apiKey: 'AIzaSyB0MKYu-efNbYEZnyTy7KHqWVQvBVwozwM',",
        "  projectId: 'hospital-hanga-roa',",
        "  appId: '1:955583524000:web:78384874fe6c4a08d82dc5',",
        '};',
      ].join('\n'),
    });

    expect(failures.map(failure => failure.check.id)).toContain(
      'client-hardcoded-firebase-web-config'
    );
  });

  it('does not flag env-based configuration guidance', () => {
    const failures = findSecretLeakFailuresForFile({
      file: 'docs/RUNBOOK_SECRET_ROTATION.md',
      content: 'Configure service account credentials via environment secrets.',
    });

    expect(failures).toEqual([]);
  });
});
