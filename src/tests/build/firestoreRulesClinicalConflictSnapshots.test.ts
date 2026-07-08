import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('firestore clinical conflict snapshot rules', () => {
  it('allows conflict snapshot review to admin and Hospitalizados HHR without opening writes', () => {
    const rules = fs.readFileSync(path.join(process.cwd(), 'firestore.rules'), 'utf8');

    expect(rules).toContain('function canManageClinicalConflictSnapshots()');
    expect(rules).toContain("return hasAnyEffectiveRole(['admin', 'nurse_hospital']);");
    expect(rules).toContain('match /conflictSnapshots/{snapshotId}');
    expect(rules).toContain('allow read: if canManageClinicalConflictSnapshots();');
    expect(rules).toContain('allow update, delete: if canAdminMaintainHospitalDocument();');
  });
});
