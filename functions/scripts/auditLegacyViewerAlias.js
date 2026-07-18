const fs = require('node:fs');
const path = require('node:path');
const { getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const LEGACY_ALIAS = ['viewer', 'census'].join('_');
const CANONICAL_ROLE = 'viewer';
const ROOT = path.resolve(__dirname, '..', '..');
const REPORTS_DIR = path.join(ROOT, 'reports');

const ensureAdminApp = () => {
  const existingApp = getApps()[0];
  if (existingApp) return existingApp;

  const explicitProjectId = String(
    process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT ||
      process.env.FIREBASE_CONFIG_PROJECT_ID ||
      ''
  ).trim();

  if (explicitProjectId) {
    return initializeApp({ projectId: explicitProjectId });
  }

  return initializeApp();
};

const collectUsersWithLegacyClaim = async auth => {
  const legacyClaimUsers = [];
  let nextPageToken = undefined;

  do {
    const page = await auth.listUsers(1000, nextPageToken);
    for (const userRecord of page.users) {
      if (userRecord.customClaims?.role === LEGACY_ALIAS) {
        legacyClaimUsers.push({
          uid: userRecord.uid,
          email: userRecord.email || null,
        });
      }
    }
    nextPageToken = page.pageToken;
  } while (nextPageToken);

  return legacyClaimUsers;
};

const collectLegacyConfigEntries = async firestore => {
  const roleDoc = await firestore.collection('config').doc('roles').get();
  const rolesMap = roleDoc.exists ? roleDoc.data() || {} : {};

  return Object.entries(rolesMap)
    .filter(([, role]) => role === LEGACY_ALIAS)
    .map(([email]) => email)
    .sort((left, right) => left.localeCompare(right));
};

const formatMarkdown = report => `# Auth Legacy Viewer Alias Audit

- Generated: ${report.generatedAt}
- Legacy alias: \`${LEGACY_ALIAS}\`
- Canonical role: \`${CANONICAL_ROLE}\`
- Readiness: **${report.readiness}**

## Summary

- Legacy entries in \`config/roles\`: ${report.configRolesLegacyCount}
- Users with legacy custom claim: ${report.authClaimsLegacyCount}

## Retirement Gate

The alias can be retired from backend helpers and rules only when both counts are zero.

## Legacy \`config/roles\` Entries

${report.legacyConfigEmails.length === 0 ? '- none' : report.legacyConfigEmails.map(email => `- ${email}`).join('\n')}

## Legacy Custom Claims

${
  report.legacyClaimUsers.length === 0
    ? '- none'
    : report.legacyClaimUsers
        .map(user => `- ${user.email || '(no-email)'} [uid=${user.uid}]`)
        .join('\n')
}
`;

const writeReport = report => {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(REPORTS_DIR, 'auth-legacy-viewer-alias-audit.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(REPORTS_DIR, 'auth-legacy-viewer-alias-audit.md'),
    `${formatMarkdown(report)}\n`,
    'utf8'
  );
};

const run = async () => {
  const app = ensureAdminApp();
  const auth = getAuth(app);
  const firestore = getFirestore(app);
  const [legacyConfigEmails, legacyClaimUsers] = await Promise.all([
    collectLegacyConfigEntries(firestore),
    collectUsersWithLegacyClaim(auth),
  ]);

  const report = {
    generatedAt: new Date().toISOString(),
    legacyAlias: LEGACY_ALIAS,
    canonicalRole: CANONICAL_ROLE,
    readiness:
      legacyConfigEmails.length === 0 && legacyClaimUsers.length === 0 ? 'retire_ready' : 'blocked',
    configRolesLegacyCount: legacyConfigEmails.length,
    authClaimsLegacyCount: legacyClaimUsers.length,
    legacyConfigEmails,
    legacyClaimUsers,
  };

  writeReport(report);

  console.log(
    '[auth-legacy-viewer-alias-audit] Report generated at reports/auth-legacy-viewer-alias-audit.{md,json}'
  );
  console.log(
    `[auth-legacy-viewer-alias-audit] readiness=${report.readiness} configRoles=${report.configRolesLegacyCount} authClaims=${report.authClaimsLegacyCount}`
  );
};

run().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  if (/Project Id|authentication/i.test(message)) {
    console.error(
      '[auth-legacy-viewer-alias-audit] This audit requires Firebase Admin credentials and a resolvable project id. Run it from an environment with ADC or set GOOGLE_CLOUD_PROJECT/GCLOUD_PROJECT first.'
    );
  }
  console.error('[auth-legacy-viewer-alias-audit] Failed to audit legacy viewer alias.', error);
  process.exitCode = 1;
});
