import fs from 'node:fs';
import path from 'node:path';

export const forbiddenTrackedPaths = [
  /^dist-man\//,
  /^dist\//,
  /^coverage\//,
  /^functions\/llave-beta\.json$/,
  /^functions\/\.secret\.local$/,
  /(^|\/)firebase-adminsdk-[^/]+\.json$/i,
];

const hasPattern = (content, regex) => regex.test(content);

const hasAllPatterns = (content, regexes) => regexes.every(regex => hasPattern(content, regex));

const gcpServiceAccountPatterns = [
  /"type"\s*:\s*"service_account"/,
  /"private_key"\s*:\s*"-----BEGIN PRIVATE KEY-----/,
  /"client_email"\s*:\s*"[^"]+@[^"]*gserviceaccount\.com"/,
];

export const textChecks = [
  {
    id: 'dotenv-gemini-key',
    description:
      'Environment files must not contain hardcoded Gemini API keys in client or local-dev vars.',
    appliesTo: file => /(^|\/)\.env(\.|$)/.test(file),
    matches: content =>
      hasPattern(
        content,
        /\b(?:VITE_LOCAL_GEMINI_API_KEY|GEMINI_API_KEY|API_KEY)\s*=\s*AIza[0-9A-Za-z_-]{35}/
      ),
  },
  {
    id: 'client-inline-googlegenai-key',
    description: 'Frontend code must not instantiate GoogleGenAI with a hardcoded API key.',
    appliesTo: file => file.startsWith('src/'),
    matches: content =>
      hasPattern(
        content,
        /new\s+GoogleGenAI\s*\(\s*\{\s*apiKey\s*:\s*['"]AIza[0-9A-Za-z_-]{35}['"]/
      ),
  },
  {
    id: 'vite-define-client-ai-key',
    description:
      'Vite define config must not inject client AI keys into import.meta.env for bundles.',
    appliesTo: file => file === 'vite.config.ts',
    matches: content => hasPattern(content, /import\.meta\.env\.VITE_LOCAL_GEMINI_API_KEY/),
  },
  {
    id: 'tracked-gcp-service-account-json',
    description:
      'Tracked files must not contain a Google Cloud service account JSON with embedded private key material.',
    appliesTo: () => true,
    matches: content => hasAllPatterns(content, gcpServiceAccountPatterns),
  },
  {
    id: 'tracked-private-key-material',
    description:
      'Tracked files must not contain PEM private keys or other raw private key material.',
    appliesTo: () => true,
    ignores: file =>
      file === 'scripts/lib/secretLeakChecks.mjs' ||
      file === 'src/tests/build/secretLeakChecks.test.ts',
    matches: content => hasPattern(content, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/),
  },
  {
    id: 'client-hardcoded-firebase-web-config',
    description:
      'Source files must not embed Firebase web app configuration literals; use environment/runtime config instead.',
    appliesTo: file => file.startsWith('src/') && !file.includes('/tests/'),
    matches: content =>
      hasAllPatterns(content, [
        /apiKey\s*:\s*['"]AIza[0-9A-Za-z_-]{35}['"]/,
        /projectId\s*:\s*['"][^'"]+['"]/,
        /appId\s*:\s*['"]1:[^'"]+['"]/,
      ]),
  },
];

export const isTextFile = buffer => {
  const sample = buffer.subarray(0, 8000);
  return !sample.includes(0);
};

export const findForbiddenTrackedPaths = trackedFiles =>
  trackedFiles.filter(file => forbiddenTrackedPaths.some(pattern => pattern.test(file)));

export const findFunctionSourcesMissingLocalSecretIgnore = firebaseConfig => {
  const functions = Array.isArray(firebaseConfig.functions)
    ? firebaseConfig.functions
    : [firebaseConfig.functions];
  return functions
    .filter(config => config?.source === 'functions' && !config.ignore?.includes('.secret.local'))
    .map(config => config.codebase ?? config.source);
};

export const findSecretLeakFailuresForFile = ({ file, content }) =>
  textChecks
    .filter(
      check =>
        check.appliesTo(file) &&
        !(typeof check.ignores === 'function' && check.ignores(file)) &&
        check.matches(content)
    )
    .map(check => ({ file, check }));

export const scanTrackedFilesForSecretLeaks = ({ root, trackedFiles }) => {
  const forbiddenPathMatches = findForbiddenTrackedPaths(trackedFiles);
  const failures = [];

  for (const file of trackedFiles) {
    const absolutePath = path.join(root, file);
    if (!fs.existsSync(absolutePath)) continue;
    if (fs.statSync(absolutePath).isDirectory()) continue;

    const buffer = fs.readFileSync(absolutePath);
    if (!isTextFile(buffer)) continue;

    const content = buffer.toString('utf8');
    failures.push(...findSecretLeakFailuresForFile({ file, content }));
  }

  return {
    forbiddenPathMatches,
    failures,
  };
};
