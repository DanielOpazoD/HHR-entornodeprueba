#!/usr/bin/env node
/**
 * Compares the security rules published in Firebase with the generated files of this checkout.
 *
 * Rules are deployed by hand, only when the owner asks, so main can move ahead of production
 * unnoticed: storage.rules stayed behind from 2026-10-22 to 2026-11-02 and file functions failed
 * for everyone. This check only reads. It exits 1 when a published ruleset differs from the file,
 * so the scheduled workflow fails and GitHub mails the owner.
 *
 * Credentials: GOOGLE_OAUTH_ACCESS_TOKEN (for a local run, `gcloud auth print-access-token`) or a
 * service account JSON in GOOGLE_APPLICATION_CREDENTIALS (CI).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const RULES_API = 'https://firebaserules.googleapis.com/v1';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

export const rulesTargets = project => [
  { label: 'Firestore', release: 'cloud.firestore', file: 'firestore.rules' },
  {
    label: 'Storage',
    release: `firebase.storage/${project}.firebasestorage.app`,
    file: 'storage.rules',
  },
];

/** First 1-based line where both sources differ, or null when they are identical. */
export const firstDifferentLine = (published, local) => {
  if (published === local) return null;
  const left = published.split('\n');
  const right = local.split('\n');
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return index + 1;
  }
  return length;
};

export const compareRulesTarget = ({ label, file }, ruleset, local) => {
  const files = ruleset?.source?.files ?? [];
  const published = files.length === 1 ? files[0].content : null;
  if (typeof published !== 'string') {
    return { ok: false, message: `${label}: el ruleset publicado no trae un único archivo.` };
  }
  const line = firstDifferentLine(published, local);
  const since = ruleset.createTime ? ` el ${ruleset.createTime}` : '';
  return line === null
    ? { ok: true, message: `${label}: lo publicado${since} coincide con ${file}.` }
    : {
        ok: false,
        message: `${label}: lo publicado${since} difiere de ${file} desde la línea ${line}.`,
      };
};

const base64Url = value => Buffer.from(value).toString('base64url');

const serviceAccountToken = async credentialsPath => {
  const account = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = account.token_uri || 'https://oauth2.googleapis.com/token';
  const unsigned = `${base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64Url(
    JSON.stringify({
      iss: account.client_email,
      scope: SCOPE,
      aud: tokenUri,
      iat: now,
      exp: now + 600,
    })
  )}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), account.private_key);
  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature.toString('base64url')}`,
    }),
  });
  if (!response.ok) throw new Error(`token exchange returned HTTP ${response.status}`);
  return (await response.json()).access_token;
};

const resolveAccessToken = async () => {
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) return process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return serviceAccountToken(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  }
  throw new Error('set GOOGLE_OAUTH_ACCESS_TOKEN or GOOGLE_APPLICATION_CREDENTIALS');
};

const main = async () => {
  const [, , projectFlag, project] = process.argv;
  if (projectFlag !== '--project' || !/^[a-z0-9-]+$/.test(project || '')) {
    console.error('Usage: check-deployed-rules.mjs --project <id>');
    process.exit(2);
  }
  const token = await resolveAccessToken();
  const get = async path => {
    const response = await fetch(`${RULES_API}/${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': project },
    });
    if (!response.ok) throw new Error(`GET ${path} returned HTTP ${response.status}`);
    return response.json();
  };

  let drift = false;
  for (const target of rulesTargets(project)) {
    const release = await get(`projects/${project}/releases/${target.release}`);
    const ruleset = await get(release.rulesetName);
    const result = compareRulesTarget(target, ruleset, fs.readFileSync(target.file, 'utf8'));
    console.log(`[rules-drift] ${result.message}`);
    if (!result.ok) drift = true;
  }
  if (drift) {
    console.error(
      '[rules-drift] Las reglas publicadas no son las de main. Publicarlas es decisión del responsable.'
    );
    process.exitCode = 1;
  }
};

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(error => {
    console.error(`[rules-drift] No se pudo comparar: ${error.message}`);
    process.exitCode = 1;
  });
}
