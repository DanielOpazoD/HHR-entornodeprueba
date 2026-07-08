#!/usr/bin/env node
/**
 * Governance gate for clinical-mutation auditing. Two enforcements:
 *
 * 1. DECLARATION (registry): every AuditAction (src/types/auditActionTypes.ts) must be classified in
 *    scripts/clinical-mutation-audit-policy.json. Fails if an action is unclassified, in more than
 *    one bucket, best-effort without a justification, or the policy references a removed action.
 * 2. COMPLIANCE (outcome not ignored): no call to executeWriteAuditEvent may discard its returned
 *    ApplicationOutcome — that is the exact bug that recurred in #129/#130 (a failed audit dropped
 *    silently). executeWriteAuditEvent never throws, so the outcome must be captured and inspected
 *    (or threaded through a fail-closed helper).
 *
 * This makes "how is this clinical mutation audited" an explicit, reviewed decision AND prevents the
 * silent-drop bug class. See docs/CLINICAL_MUTATION_AUDIT_POLICY.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AUDIT_FN = 'executeWriteAuditEvent';

/**
 * Parse the string-literal members out of the `export type AuditAction = ...` union. Matches any
 * single- or double-quoted literal (not just UPPER_SNAKE) so a future action with a different naming
 * convention can't be silently dropped — that would let it bypass classification by this gate.
 */
export const parseAuditActions = (typesSource) => {
  const unionMatch = typesSource.match(/export type AuditAction =([\s\S]*?);/);
  if (!unionMatch) return null;
  return [...unionMatch[1].matchAll(/(['"])(.*?)\1/g)].map((m) => m[2]);
};

/**
 * Pure registry evaluator: given the action list and the policy object, return violation messages
 * (empty array = OK).
 */
export const evaluateAuditPolicy = ({ actions, policy }) => {
  const errors = [];
  const failClosed = policy.failClosed ?? [];
  const bestEffort = policy.bestEffortObservable ?? [];
  const exempt = policy.exemptNonMutation ?? [];
  const serverSide = policy.serverSideEnforced ?? [];
  const actionSet = new Set(actions);

  const seen = new Map();
  const classify = (action, bucket) => {
    if (typeof action !== 'string') {
      errors.push(`A ${bucket} entry has a non-string action: ${JSON.stringify(action)}`);
      return;
    }
    if (seen.has(action)) {
      errors.push(`"${action}" is classified in two buckets (${seen.get(action)} and ${bucket}).`);
      return;
    }
    seen.set(action, bucket);
  };
  failClosed.forEach((entry) => {
    classify(entry?.action, 'failClosed');
    // Normalize first so a traversal path (src/tests/../fixtures/x.test.ts) can't satisfy the root.
    const test = typeof entry?.test === 'string' ? path.posix.normalize(entry.test) : entry?.test;
    if (typeof test !== 'string' || !/^src\/tests\/.*\.test\.tsx?$/.test(test)) {
      errors.push(
        `failClosed "${entry?.action ?? '(missing action)'}" must link a "test" — a ` +
          'src/tests/**/*.test.ts(x) file proving it aborts the mutation on audit failure. ' +
          'A fail-closed claim needs proof.'
      );
    }
  });
  bestEffort.forEach((e) => classify(e?.action, 'bestEffortObservable'));
  exempt.forEach((a) => classify(a, 'exemptNonMutation'));
  serverSide.forEach((e) => {
    classify(e?.action, 'serverSideEnforced');
    const emitter = typeof e?.emitter === 'string' ? path.posix.normalize(e.emitter) : e?.emitter;
    if (typeof emitter !== 'string' || !emitter.startsWith('functions/')) {
      errors.push(
        `serverSideEnforced "${e?.action ?? '(missing action)'}" must declare an "emitter" path ` +
          'under functions/ (the Cloud Function that emits it).'
      );
    }
  });

  bestEffort.forEach((e) => {
    if (typeof e?.justification !== 'string' || e.justification.trim().length < 12) {
      errors.push(
        `bestEffortObservable "${e?.action ?? '(missing action)'}" needs a non-trivial ` +
          '"justification" (why proceeding-on-audit-failure is acceptable for this mutation).'
      );
    }
  });

  const unclassified = actions.filter((a) => !seen.has(a));
  if (unclassified.length) {
    errors.push(
      'These AuditAction(s) are not declared in scripts/clinical-mutation-audit-policy.json:\n' +
        unclassified.map((a) => `  - ${a}`).join('\n') +
        '\nAdd each to failClosed, bestEffortObservable (with a justification), or exemptNonMutation.'
    );
  }

  for (const action of seen.keys()) {
    if (!actionSet.has(action)) {
      errors.push(`Policy declares "${action}", which is not in the AuditAction union (stale entry).`);
    }
  }

  return errors;
};

/**
 * Pure: given the linked entries and an injectable `fileExists`, return errors for any failClosed
 * `test` or serverSideEnforced `emitter` whose path is missing. Paths are normalized first so a
 * traversal (e.g. `src/tests/../fixtures/x.test.ts`) can't point outside the intended root. No IO,
 * so it is unit-testable.
 */
export const findMissingLinkedFiles = ({ failClosed = [], serverSideEnforced = [], fileExists }) => {
  const errors = [];
  for (const entry of failClosed) {
    if (typeof entry?.test !== 'string') continue;
    const test = path.posix.normalize(entry.test);
    if (test.startsWith('src/tests/') && /\.test\.tsx?$/.test(test) && !fileExists(test)) {
      errors.push(`failClosed "${entry.action}" links a missing test file: ${entry.test}`);
    }
  }
  for (const entry of serverSideEnforced) {
    if (typeof entry?.emitter !== 'string') continue;
    const emitter = path.posix.normalize(entry.emitter);
    if (emitter.startsWith('functions/') && !fileExists(emitter)) {
      errors.push(`serverSideEnforced "${entry.action}" links a missing emitter file: ${entry.emitter}`);
    }
  }
  return errors;
};

/**
 * Pure detector: find calls to executeWriteAuditEvent whose outcome is discarded. A call is
 * "discarded" when its statement starts with the call itself (optionally `await`/`void`) — i.e.
 * nothing captures the return value. Assignments (`const o = await ...`), returns (`return ...`) and
 * expression positions (inside `(`, `[`, `=>`, …) all keep something before the call. Returns
 * `{ line }` for each violation. No IO, so it is unit-testable.
 */
export const detectIgnoredAuditOutcomes = (source) => {
  const violations = [];
  const re = new RegExp(`${AUDIT_FN}\\s*\\(`, 'g');
  let match;
  while ((match = re.exec(source)) !== null) {
    const callIdx = match.index;
    const boundary = Math.max(
      source.lastIndexOf(';', callIdx),
      source.lastIndexOf('{', callIdx),
      source.lastIndexOf('}', callIdx)
    );
    const prefix = source
      .slice(boundary + 1, callIdx)
      .replace(/\b(?:await|void)\b/g, '')
      .trim();
    if (prefix === '') {
      violations.push({ line: source.slice(0, callIdx).split('\n').length });
    }
  }
  return violations;
};

const listSourceFiles = (dir) =>
  fs
    .readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((rel) => /\.(ts|tsx)$/.test(rel))
    .filter((rel) => !/(^|[/\\])tests[/\\]/.test(rel));

const runCli = () => {
  const root = process.cwd();
  const typesFile = path.join(root, 'src', 'types', 'auditActionTypes.ts');
  const policyFile = path.join(root, 'scripts', 'clinical-mutation-audit-policy.json');
  const srcDir = path.join(root, 'src');

  const fail = (msg) => {
    console.error(`\n[clinical-mutation-audit-policy] FAILED\n\n${msg}\n`);
    process.exit(1);
  };

  const actions = parseAuditActions(fs.readFileSync(typesFile, 'utf8'));
  if (!actions) fail('Could not locate the `export type AuditAction = ...` union in src/types/auditActionTypes.ts');
  if (actions.length === 0) fail('Parsed zero AuditAction members — the regex or the union changed.');

  let policy;
  try {
    policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
  } catch (error) {
    fail(`Could not read/parse scripts/clinical-mutation-audit-policy.json: ${error.message}`);
  }

  const errors = evaluateAuditPolicy({ actions, policy });

  // The proving test (failClosed) and Cloud Function emitter (serverSideEnforced) must exist on disk.
  errors.push(
    ...findMissingLinkedFiles({
      failClosed: policy.failClosed ?? [],
      serverSideEnforced: policy.serverSideEnforced ?? [],
      fileExists: (rel) => fs.existsSync(path.join(root, rel)),
    })
  );

  let scanned = 0;
  for (const rel of listSourceFiles(srcDir)) {
    scanned += 1;
    const violations = detectIgnoredAuditOutcomes(fs.readFileSync(path.join(srcDir, rel), 'utf8'));
    for (const v of violations) {
      errors.push(
        `src/${rel.split(path.sep).join('/')}:${v.line} — ${AUDIT_FN}(...) outcome is discarded. ` +
          'Capture and inspect the ApplicationOutcome (or thread it through a fail-closed helper); ' +
          'it never throws, so an ignored result drops audit failures silently.'
      );
    }
  }

  if (errors.length) fail(errors.join('\n\n'));

  console.log(
    `[clinical-mutation-audit-policy] OK — ${actions.length} AuditAction(s) classified ` +
      `(${(policy.failClosed ?? []).length} fail-closed, ` +
      `${(policy.bestEffortObservable ?? []).length} best-effort-observable, ` +
      `${(policy.exemptNonMutation ?? []).length} exempt, ` +
      `${(policy.serverSideEnforced ?? []).length} server-side); ` +
      `${scanned} source file(s) scanned, no discarded ${AUDIT_FN} outcomes.`
  );
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runCli();
}
