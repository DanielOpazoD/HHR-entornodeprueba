/**
 * The atomic partial update returns its committed record by projecting the payload onto the base
 * read in the same transaction (firestoreUpdateProjection). That is exact only while nothing else
 * writes a daily record after the commit, so a Firestore trigger on dailyRecords would silently
 * make every receipt stale. The emulator suite pins the projection itself.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const FUNCTIONS_ROOT = path.resolve(__dirname, '../../../functions');
// v1 `.document('path')` and every v2 `onDocument*(` call, whatever its argument form.
const TRIGGER_CALL = /\.document\(|onDocument(?:Written|Created|Updated|Deleted)\w*\(/g;
// The path as a string first argument, or as the `document` option of the v2 object form.
const TRIGGER_PATH = /^\s*(?:\{[^}]*?\bdocument\s*:\s*)?['"`]([^'"`]+)['"`]/;

const listSources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'node_modules') return [];
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSources(fullPath);
    return /\.(c|m)?[jt]s$/.test(entry.name) ? [fullPath] : [];
  });

describe('committed record projection invariants', () => {
  it('has no Cloud Functions trigger that writes after a daily record commit', () => {
    const triggerPaths = listSources(FUNCTIONS_ROOT).flatMap(file => {
      const source = fs.readFileSync(file, 'utf8');
      return Array.from(source.matchAll(TRIGGER_CALL), match => ({
        file: path.relative(FUNCTIONS_ROOT, file),
        documentPath:
          TRIGGER_PATH.exec(source.slice(match.index + match[0].length))?.[1] ?? '<unresolved>',
      }));
    });

    // The scan must still see the one known trigger, or a new trigger syntax would slip past it.
    expect(triggerPaths.map(trigger => trigger.documentPath)).toContain(
      'hhr_account_recovery/{challengeId}'
    );
    // A trigger whose path the scan cannot read (a variable, a new option shape) fails closed.
    expect(triggerPaths.filter(trigger => trigger.documentPath === '<unresolved>')).toEqual([]);
    // A wildcard collection under a hospital would match daily records too.
    expect(
      triggerPaths.filter(trigger =>
        /dailyRecords|^\{|^hospitals\/[^/]+\/\{/.test(trigger.documentPath)
      )
    ).toEqual([]);
  });
});
