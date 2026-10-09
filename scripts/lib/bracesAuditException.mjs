import { createHash } from 'node:crypto';

export const BRACES_EXCEPTION = Object.freeze({
  advisory: 'GHSA-vfj7-8cjw-p6xm',
  authorizedBy: 'Daniel Opazo, explicit approval in the CUDYR task on 2026-10-07',
  startsAt: '2026-10-07T00:00:00Z',
  expiresAt: '2026-10-15T00:00:00Z',
  lockSha256: '78f0237c8fec6efa06b4e4ddb1135386c933ac7e148c8b4431f7adeeb0a12f06',
});
const versions = {
  '@boundaries/elements': '2.0.1',
  braces: '3.0.3',
  chokidar: '3.6.0',
  'eslint-plugin-boundaries': '6.0.2',
  'firebase-tools': '15.15.0',
  'lint-staged': '16.2.7',
  micromatch: '4.0.8',
};
const severities = ['info', 'low', 'moderate', 'high', 'critical'];
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Decide acceptance separately from the untouched npm report. Any uncertainty keeps the gate closed. */
export function evaluateBracesException({ workspace, lockText, functionsLock, now = Date.now() }) {
  const reject = reason => ({ accepted: false, reason });
  if (
    workspace?.id !== 'root' ||
    workspace.status !== 'vulnerable' ||
    workspace.exitCode !== 1 ||
    workspace.firstFailureCategory !== 'audit_failed'
  )
    return reject('not_an_eligible_root_audit');
  if (
    !Number.isFinite(now) ||
    now < Date.parse(BRACES_EXCEPTION.startsAt) ||
    now >= Date.parse(BRACES_EXCEPTION.expiresAt)
  )
    return reject('outside_authorized_window');
  if (
    typeof lockText !== 'string' ||
    createHash('sha256').update(lockText).digest('hex') !== BRACES_EXCEPTION.lockSha256
  )
    return reject('lockfile_changed');
  if (
    !isObject(functionsLock?.packages) ||
    Object.keys(functionsLock.packages).some(key => key.endsWith('/braces'))
  )
    return reject('functions_scope_changed');
  const report = workspace.report;
  if (report?.auditReportVersion !== 2 || report.error || !isObject(report.vulnerabilities))
    return reject('invalid_audit_report');
  const entries = Object.entries(report.vulnerabilities);
  const counts = report.metadata?.vulnerabilities;
  if (
    !isObject(counts) ||
    counts.total !== entries.length ||
    severities.some(
      severity =>
        counts[severity] !== entries.filter(([, value]) => value?.severity === severity).length
    )
  )
    return reject('inconsistent_audit_counts');
  const high = entries
    .filter(([, value]) => value?.severity === 'high')
    .map(([name]) => name)
    .sort();
  if (
    counts.critical !== 0 ||
    JSON.stringify(high) !== JSON.stringify(Object.keys(versions).sort())
  )
    return reject('blocking_findings_changed');
  const lock = JSON.parse(lockText);
  for (const [name, version] of Object.entries(versions)) {
    const location = `node_modules/${name}`;
    const node = lock.packages?.[location];
    const vulnerability = report.vulnerabilities[name];
    if (
      node?.dev !== true ||
      node.version !== version ||
      JSON.stringify(vulnerability.nodes) !== JSON.stringify([location])
    )
      return reject('dependency_scope_changed');
  }
  // Trace all causes, including lower-severity dependencies of aggregate packages.
  // A second advisory inside firebase-tools must not disappear with its braces contribution.
  const trace = (name, ancestors = new Set()) => {
    if (ancestors.has(name)) throw new Error('cyclic_audit_causes');
    const vulnerability = report.vulnerabilities[name];
    if (
      !isObject(vulnerability) ||
      vulnerability.name !== name ||
      !severities.includes(vulnerability.severity) ||
      !Array.isArray(vulnerability.via) ||
      vulnerability.via.length === 0
    )
      throw new Error('incomplete_audit_causes');
    const next = new Set([...ancestors, name]);
    let target = false;
    for (const cause of vulnerability.via) {
      if (typeof cause === 'string') {
        target = trace(cause, next) || target;
      } else {
        if (
          !isObject(cause) ||
          !severities.includes(cause.severity) ||
          cause.name !== name ||
          cause.dependency !== name ||
          !Number.isInteger(cause.source) ||
          cause.source <= 0 ||
          typeof cause.url !== 'string' ||
          !/^https:\/\/[^/]+\/.+/.test(cause.url)
        )
          throw new Error('invalid_advisory');
        const isTarget =
          name === 'braces' &&
          cause.name === 'braces' &&
          cause.dependency === 'braces' &&
          cause.url === `https://github.com/advisories/${BRACES_EXCEPTION.advisory}` &&
          cause.severity === 'high';
        if (['high', 'critical'].includes(cause.severity) && !isTarget)
          throw new Error('additional_blocking_advisory');
        target = isTarget || target;
      }
    }
    if (vulnerability.severity === 'high' && !target) throw new Error('unexplained_high_severity');
    return target;
  };
  try {
    for (const [name] of entries) trace(name);
  } catch (error) {
    return reject(error.message);
  }
  return {
    accepted: true,
    ...BRACES_EXCEPTION,
    packages: high,
    reason: 'temporary_development_risk_acceptance',
  };
}
