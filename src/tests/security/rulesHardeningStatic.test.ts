import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const readProjectFile = (relativePath: string): string => {
  const absolutePath = path.resolve(__dirname, '../../../', relativePath);
  return fs.readFileSync(absolutePath, 'utf8');
};

describe('Security hardening static guards', () => {
  it('does not expose public Firestore reads in sensitive collections', () => {
    const rules = readProjectFile('firestore.rules');

    expect(rules).not.toMatch(/match \/bookmarks\/\{bookmarkId\}\s*\{\s*allow read:\s*if true;/m);
    expect(rules).not.toMatch(
      /match \/census-access-invitations\/\{invitationId\}\s*\{\s*allow read:\s*if true;/m
    );
  });

  it('does not expose public Storage reads for censo-diario', () => {
    const rules = readProjectFile('storage.rules');
    expect(rules).not.toMatch(
      /match \/censo-diario\/\{allPaths=\*\*\}\s*\{\s*allow read:\s*if true;/m
    );
  });

  it('keeps reminders storage writes restricted to clinical write roles', () => {
    const rules = readProjectFile('storage.rules');
    expect(rules).toContain('match /reminders/{allPaths=**}');
    expect(rules).toContain('allow write: if canWriteReminderAssets();');
    expect(rules).toContain('return hasClinicalWriteRole();');
    expect(rules).not.toMatch(
      /match \/reminders\/\{allPaths=\*\*\}\s*\{\s*allow write:\s*if true;/m
    );
  });

  it('keeps user avatars scoped to the authenticated owner and image-limited', () => {
    const rules = readProjectFile('storage.rules');
    expect(rules).toContain('match /user-avatars/{userId}/{fileName}');
    expect(rules).toContain('function isCurrentUser(userId)');
    expect(rules).toMatch(
      /match \/user-avatars\/\{userId\}\/\{fileName\}[\s\S]*?allow read:\s*if isCurrentUser\(userId\);/m
    );
    expect(rules).toMatch(
      /match \/user-avatars\/\{userId\}\/\{fileName\}[\s\S]*?allow write:\s*if isCurrentUser\(userId\)[\s\S]*request\.resource\.size < 2 \* 1024 \* 1024[\s\S]*request\.resource\.contentType\.matches\('image\/\.\*'\);/m
    );
    expect(rules).not.toMatch(/match \/user-avatars\/\{userId\}\/\{fileName\}[\s\S]*?if true;/m);
  });

  it('keeps clinical attachment Storage scoped, authenticated, typed and size-limited', () => {
    const rules = readProjectFile('storage.rules');
    expect(rules).toContain(
      'match /clinical-attachments/{hospitalId}/{patientRutKey}/{episodeKey}/{attachmentId}/{fileName}'
    );
    expect(rules).toMatch(
      /match \/clinical-attachments\/\{hospitalId\}\/\{patientRutKey\}\/\{episodeKey\}\/\{attachmentId\}\/\{fileName\}[\s\S]*?allow read:\s*if canReadClinicalStorage\(\);/m
    );
    expect(rules).toMatch(
      /match \/clinical-attachments\/\{hospitalId\}\/\{patientRutKey\}\/\{episodeKey\}\/\{attachmentId\}\/\{fileName\}[\s\S]*?allow write:\s*if hasClinicalWriteRole\(\)[\s\S]*request\.resource\.size < 15 \* 1024 \* 1024[\s\S]*request\.resource\.contentType\.matches/m
    );
    expect(rules).not.toMatch(
      /match \/clinical-attachments\/\{hospitalId\}\/\{patientRutKey\}\/\{episodeKey\}\/\{attachmentId\}\/\{fileName\}[\s\S]*?allow write:\s*if true;/m
    );
  });

  it('uses robust admin check in setUserRole callable', () => {
    const authCallablePolicy = readProjectFile('functions/lib/auth/authCallablePolicy.js');

    // Regression guard for precedence bug: !context.auth.token.role === 'admin'
    expect(authCallablePolicy).not.toContain('!context.auth.token.role ===');
    expect(authCallablePolicy).toContain(
      "const hasAdminClaim = context.auth?.token?.role === 'admin'"
    );
  });

  it('restricts dailyRecords delete operation to admins only', () => {
    const rules = readProjectFile('firestore.rules');
    const dailyRecordsMatch = rules.match(
      /match \/dailyRecords\/\{date\}\s*\{([\s\S]*?)\n\s*match \/clinicalDocuments\/\{documentId\}/m
    );

    expect(dailyRecordsMatch).not.toBeNull();
    const dailyRecordsBlock = dailyRecordsMatch?.[1] || '';

    expect(dailyRecordsBlock).toMatch(/allow delete:\s*if isAdmin\(\);/m);
    expect(dailyRecordsBlock).not.toMatch(/allow delete:\s*if [^;]*isNurse\(/m);
  });

  it('does not keep unused general viewer helper wrappers in Firestore rules', () => {
    const rules = readProjectFile('firestore.rules');

    expect(rules).not.toContain('function isGeneralViewer()');
  });

  it('does not keep hardcoded bootstrap admin allowlists in auth or rules surfaces', () => {
    const EXPECTED_BOOTSTRAP_ADMINS = [
      'daniel.opazo@hospitalhangaroa.cl',
      'd.opazo.damiani@gmail.com',
    ];

    const rules = readProjectFile('firestore.rules');
    const storageRules = readProjectFile('storage.rules');
    const authConfig = readProjectFile('functions/lib/auth/authConfig.js');
    const authShared = readProjectFile('src/services/auth/authShared.ts');
    const netlifyAuth = readProjectFile('netlify/functions/lib/firebase-auth.ts');

    expect(rules).not.toContain('function isBootstrapAdmin(');
    expect(storageRules).not.toContain('function isBootstrapAdmin(');
    expect(authConfig).not.toContain('BOOTSTRAP_ADMIN_EMAILS');
    expect(authShared).not.toContain('BOOTSTRAP_ADMIN_EMAILS');
    expect(netlifyAuth).not.toContain('BOOTSTRAP_ADMIN_EMAILS');

    for (const email of EXPECTED_BOOTSTRAP_ADMINS) {
      expect(rules).not.toContain(email);
      expect(storageRules).not.toContain(email);
      expect(authConfig).not.toContain(email);
      expect(authShared).not.toContain(email);
      expect(netlifyAuth).not.toContain(email);
    }
  });

  describe('prescriptions module (monthly backup, manual deletion)', () => {
    it('forbids client direct creates in Firestore — uploads must go through the Cloud Function', () => {
      const rules = readProjectFile('firestore.rules');
      expect(rules).toMatch(
        /match \/prescriptions\/\{prescriptionId\}[\s\S]*?allow create:\s*if false;/m
      );
    });

    it('lets clinical staff read prescriptions and limits delete to admin or nursing', () => {
      const rules = readProjectFile('firestore.rules');
      expect(rules).toMatch(
        /match \/prescriptions\/\{prescriptionId\}[\s\S]*?allow read:\s*if canReadClinicalData\(\);/m
      );
      expect(rules).toMatch(
        /match \/prescriptions\/\{prescriptionId\}[\s\S]*?allow update:\s*if canEdit\(\);/m
      );
      expect(rules).toMatch(
        /match \/prescriptions\/\{prescriptionId\}[\s\S]*?allow delete:\s*if canEdit\(\);/m
      );
    });

    it('keeps the PIN config readable only by admin and never client-writable', () => {
      const rules = readProjectFile('firestore.rules');
      expect(rules).toMatch(
        /match \/config\/prescriptionsAccess[\s\S]*?allow read:\s*if isAdmin\(\);/m
      );
      expect(rules).toMatch(/match \/config\/prescriptionsAccess[\s\S]*?allow write:\s*if false;/m);
    });

    it('keeps prescription Storage blobs readable by clinical staff and never client-writable', () => {
      const storageRules = readProjectFile('storage.rules');
      expect(storageRules).toMatch(
        /match \/prescriptions\/\{allPaths=\*\*\}[\s\S]*?allow read:\s*if canReadClinicalStorage\(\);/m
      );
      expect(storageRules).toMatch(
        /match \/prescriptions\/\{allPaths=\*\*\}[\s\S]*?allow write:\s*if false;/m
      );
    });
  });
});
