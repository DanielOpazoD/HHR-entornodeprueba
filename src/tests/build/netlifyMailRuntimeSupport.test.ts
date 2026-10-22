// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  profileMailBundles,
  smokeMailBundles,
} from '../../../scripts/netlifyMailRuntimeSupport.mjs';

let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-runtime-test-'));
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(directory, { recursive: true, force: true });
});
const fixture = (name: string, source: string) => {
  const artifact = path.join(directory, `${name}.cjs`);
  fs.writeFileSync(artifact, source);
  return { name, path: artifact };
};
const classic = `exports.handler = async event => ({ statusCode:
  event.headers.origin !== process.env.URL ? 403 : event.httpMethod === 'OPTIONS' ? 200 : 405 });`;

describe('Netlify mail artifact runtime probes', () => {
  it('requires each artifact afresh in round-robin order and summarizes real load/RSS samples', () => {
    const marker = path.join(directory, 'executions');
    const bundles = ['first', 'second'].map(name =>
      fixture(
        name,
        `
      require('node:fs').appendFileSync(${JSON.stringify(marker)}, '${name}\\n');
      const start = performance.now(); while (performance.now() - start < 12) {}
      exports.handler = () => { throw new Error('profile must never invoke handler'); };
    `
      )
    );
    const rows = profileMailBundles(bundles);
    expect(fs.readFileSync(marker, 'utf8').trim().split('\n')).toEqual(
      Array.from({ length: 5 }, () => ['first', 'second']).flat()
    );
    const pids = rows.flatMap(row => row.runs.map(run => run.pid));
    expect(new Set(pids).size).toBe(10);
    for (const row of rows) {
      expect(row.runs).toHaveLength(5);
      expect(row.minLoadMs).toBeGreaterThanOrEqual(12);
      expect(row.maxLoadMs).toBeGreaterThanOrEqual(row.medianLoadMs);
      expect(row.medianLoadMs).toBeGreaterThanOrEqual(row.minLoadMs);
      expect(row.medianRssAfterBytes).toBeGreaterThan(0);
      expect(row.runs.every(run => run.rssBeforeBytes > 0 && run.networkAttempts === 0)).toBe(true);
    }
  });

  it('passes only the safe environment and resolves the artifact from its own directory', () => {
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', 'must-not-inherit');
    vi.stubEnv('GMAIL_TOKEN', 'must-not-inherit');
    vi.stubEnv('NODE_OPTIONS', '--require=/must-not-load.cjs');
    fs.writeFileSync(path.join(directory, '.env'), 'GMAIL_TOKEN=dummy');
    const bundle = fixture(
      'environment',
      `
      const allowed = ['NODE_ENV', 'PATH', 'URL', '__CF_USER_TEXT_ENCODING'];
      if (Object.keys(process.env).some(key => !allowed.includes(key)) || process.env.NODE_ENV !== 'test'
        || process.env.URL !== 'https://mail-smoke.invalid'
        || process.cwd() !== __dirname) throw new Error('unsafe environment');
    `
    );
    expect(profileMailBundles([bundle], { repetitions: 1 })[0].runs).toHaveLength(1);
  });

  it.each([
    [
      'throw',
      `console.error('SENSITIVE-PAYLOAD'); throw new Error('SENSITIVE-PAYLOAD');`,
      'artifact_failure',
    ],
    ['exit', 'process.exit(17);', 'child_exit'],
    ['empty', 'process.exit(0);', 'invalid_json'],
    ['malformed', `require('node:fs').writeSync(1, 'not-json');`, 'invalid_json'],
    [
      'invalid',
      `require('node:fs').writeSync(1, JSON.stringify({ok:true,loadMs:0})); process.exit(0);`,
      'invalid_result',
    ],
    [
      'failed-check',
      `require('node:fs').writeSync(1, JSON.stringify({ok:true,loadMs:1,rssBeforeBytes:1,
        rssAfterBytes:1,rssDeltaBytes:0,pid:1,networkAttempts:0,
        checks:[{check:'fixture',passed:false}]})); process.exit(0);`,
      'invalid_result',
    ],
  ])('surfaces %s without echoing artifact diagnostics', (name, source, code) => {
    const invoke = () => profileMailBundles([fixture(name, source)], { repetitions: 1 });
    expect(invoke).toThrow(code);
    expect(invoke).not.toThrow('SENSITIVE-PAYLOAD');
  });

  it('fails a child that exceeds the ten second deadline', () => {
    expect(() =>
      profileMailBundles([fixture('timeout', 'while (true) {}')], { repetitions: 1 })
    ).toThrow('timeout');
  }, 15_000);

  it.each([
    `fetch('https://mail-smoke.invalid');`,
    `require('node:http').get('http://mail-smoke.invalid');`,
    `require('node:https').request('https://mail-smoke.invalid');`,
    `require('node:net').connect(443, 'mail-smoke.invalid');`,
    `new (require('node:net').Socket)().connect(443, 'mail-smoke.invalid');`,
    `require('node:tls').connect(443, 'mail-smoke.invalid');`,
    `require('node:dgram').createSocket('udp4');`,
    `require('node:dns').lookup('mail-smoke.invalid', () => {});`,
    `require('node:dns/promises').resolve4('mail-smoke.invalid');`,
    `new (require('node:dns/promises').Resolver)().resolve4('mail-smoke.invalid');`,
  ])('rejects a caught module-load network attempt: %s', attempt => {
    const bundle = fixture('network', `try { ${attempt} } catch {}`);
    expect(() => profileMailBundles([bundle], { repetitions: 1 })).toThrow('network_attempt');
  });

  it('smokes classic and modern exports and validates schedule without draining it', () => {
    const bundles = [
      fixture('send-census-email', classic),
      fixture('send-fuga-notification', classic),
      fixture(
        'operational-telemetry',
        `exports.default = async (request, context) => {
        if (!(request instanceof Request) || context.ip !== '127.0.0.1'
          || context.site.url !== process.env.URL || context.deploy.context !== 'deploy-preview'
          || context.deploy.published !== false) throw new Error('invalid runtime context');
        return new Response(null, {status: request.headers.get('origin') !== process.env.URL
          ? 403 : request.method === 'OPTIONS' ? 200 : 405});
      };`
      ),
      fixture(
        'operational-telemetry-retry',
        `
        exports.default = () => { throw new Error('must never drain'); };
        exports.config = {schedule: '*/5 * * * *'};`
      ),
    ];
    const rows = smokeMailBundles(bundles);
    expect(rows.map(row => row.checks.length)).toEqual([3, 3, 3, 2]);
    expect(rows.every(row => row.networkAttempts === 0)).toBe(true);
    expect(rows[0].checks.map(check => check.status)).toEqual([200, 405, 403]);
  });

  it.each([
    ['send-census-email', 'exports.handler = async () => ({statusCode: 201});', 'smoke_status'],
    ['send-fuga-notification', 'exports.default = async () => {};', 'handler_export'],
    [
      'operational-telemetry',
      'exports.default = async () => new Response(null,{status:201});',
      'smoke_status',
    ],
    [
      'operational-telemetry-retry',
      'exports.default=()=>{}; exports.config={schedule:"* * * * *"};',
      'scheduled_contract',
    ],
    [
      'operational-telemetry-retry',
      'exports.config={schedule:"*/5 * * * *"};',
      'scheduled_contract',
    ],
    [
      'send-census-email',
      `${classic}\nconst original=exports.handler; exports.handler=async event=>{
      try { fetch('https://mail-smoke.invalid'); } catch {} return original(event); };`,
      'network_attempt',
    ],
  ])('rejects an invalid smoke contract for %s', (name, source, code) => {
    expect(() => smokeMailBundles([fixture(name, source)])).toThrow(code);
  });

  it('rejects repetitions that would silently omit executions', () => {
    for (const repetitions of [0, -1, 1.5, NaN]) {
      expect(() => profileMailBundles([], { repetitions })).toThrow('Invalid profile repetitions');
    }
  });
});
