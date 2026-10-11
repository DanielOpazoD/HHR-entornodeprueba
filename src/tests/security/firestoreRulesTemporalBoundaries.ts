import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { describe, it } from 'vitest';
import { resolveFirestoreRulesEmulatorConfig } from './firestoreRulesEmulatorConfig';

const FROZEN_NOW = 1784527200000; // 2026-07-20 06:00 UTC.
const DAY = 86400000;

const frozenHelper = (file: string, name: string): string => {
  const source = readFileSync(resolve(process.cwd(), file), 'utf8');
  const helper = source.match(new RegExp(`function ${name}\\([^)]*\\)\\s*\\{[^}]*\\}`))?.[0];
  if (!helper?.includes('request.time.toMillis()')) throw new Error(`Missing clock in ${name}`);
  return helper.replace('request.time.toMillis()', String(FROZEN_NOW));
};

/** Executes the production comparator helpers with a fixed clock; role/schema access stays in the full suite. */
export const registerFirestoreRulesTemporalBoundaries = (): void => {
  describe('Temporal helpers exact boundaries', () => {
    it('keeps the nurse open -24/+48h and specialist closed/open 0/+24h edges', async () => {
      const emulator = resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST);
      const nurse = frozenHelper(
        'rules/firestore/30-daily-record-write-helpers.rules',
        'isWithinEditingWindow'
      );
      const specialist = frozenHelper(
        'rules/firestore/12-specialist-handoff-boundary-helpers.rules',
        'isWithinSpecialistMedicalHandoffWindow'
      );
      const cases = [
        ['nurse', DAY + 1, false],
        ['nurse', DAY, false],
        ['nurse', DAY - 1, true],
        ['nurse', -2 * DAY + 1, true],
        ['nurse', -2 * DAY, false],
        ['nurse', -2 * DAY - 1, false],
        ['specialist', 1, false],
        ['specialist', 0, true],
        ['specialist', -DAY + 1, true],
        ['specialist', -DAY, false],
        ['specialist', -DAY - 1, false],
      ] as const;
      const env = await initializeTestEnvironment({
        projectId: 'demo-hhr-temporal-boundaries',
        firestore: {
          ...emulator,
          rules: `rules_version = '2';
          service cloud.firestore { match /databases/{database}/documents {
            ${nurse} ${specialist}
            match /cases/{caseId} {
              allow get: if resource.data.kind == 'nurse'
                ? isWithinEditingWindow(resource.data.anchor)
                : isWithinSpecialistMedicalHandoffWindow(resource.data.anchor);
            }
          } }`,
        },
      });
      try {
        await env.clearFirestore();
        await env.withSecurityRulesDisabled(async context => {
          for (const [index, [kind, offset]] of cases.entries()) {
            await context
              .firestore()
              .doc(`cases/${index}`)
              .set({ kind, anchor: FROZEN_NOW + offset });
          }
        });
        for (const [index, [, , allowed]] of cases.entries()) {
          const attempt = env.unauthenticatedContext().firestore().doc(`cases/${index}`).get();
          await (allowed ? assertSucceeds(attempt) : assertFails(attempt));
        }
      } finally {
        await env.cleanup();
      }
    });
  });
};
