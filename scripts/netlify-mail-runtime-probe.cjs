#!/usr/bin/env node
const { performance } = require('node:perf_hooks');

const output = process.stdout.write.bind(process.stdout);
// Artifact diagnostics can contain provider details; only the probe's JSON leaves this child.
process.stdout.write = process.stderr.write = () => true;
let networkAttempts = 0;
const denyNetwork = () => {
  networkAttempts += 1;
  throw new Error('network_denied');
};
globalThis.fetch = denyNetwork;
for (const [moduleName, methods] of [
  ['http', ['request', 'get', 'ClientRequest']],
  ['https', ['request', 'get']],
  ['http2', ['connect']],
  ['net', ['connect', 'createConnection']],
  ['tls', ['connect']],
  ['dgram', ['createSocket']],
]) {
  const module = require(`node:${moduleName}`);
  for (const method of methods) module[method] = denyNetwork;
}
require('node:net').Socket.prototype.connect = denyNetwork;
require('node:tls').TLSSocket.prototype.connect = denyNetwork;
for (const method of ['connect', 'send'])
  require('node:dgram').Socket.prototype[method] = denyNetwork;
for (const dns of [require('node:dns'), require('node:dns/promises')]) {
  for (const target of [dns, dns.Resolver.prototype]) {
    for (const method of Object.getOwnPropertyNames(target)) {
      if (/^(lookup|resolve|reverse)/.test(method)) target[method] = denyNetwork;
    }
  }
}
require('node:module').syncBuiltinESMExports();

const fail = code => {
  output(JSON.stringify({ ok: false, code, networkAttempts }));
  process.exit(1);
};
process.on('uncaughtException', () => fail('uncaught_exception'));
process.on('unhandledRejection', () => fail('unhandled_rejection'));

async function main() {
  const [, , mode, artifact, name] = process.argv;
  const rssBeforeBytes = process.memoryUsage().rss;
  const start = performance.now();
  const exports = require(artifact);
  const loadMs = performance.now() - start;
  const rssAfterBytes = process.memoryUsage().rss;
  const checks = [];
  if (mode === 'smoke') {
    if (name === 'operational-telemetry-retry') {
      if (typeof exports.default !== 'function' || exports.config?.schedule !== '*/5 * * * *') {
        return fail('scheduled_contract');
      }
      checks.push({ check: 'default-function', passed: true }, { check: 'schedule', passed: true });
    } else {
      const modern = name === 'operational-telemetry';
      if (!modern && !['send-census-email', 'send-fuga-notification'].includes(name)) {
        return fail('unknown_entrypoint');
      }
      const handler = modern ? exports.default : exports.handler;
      if (typeof handler !== 'function') return fail('handler_export');
      for (const [method, origin, expectedStatus] of [
        ['OPTIONS', 'https://mail-smoke.invalid', 200],
        ['GET', 'https://mail-smoke.invalid', 405],
        ['POST', 'https://untrusted.invalid', 403],
      ]) {
        const headers = { origin };
        const response = modern
          ? await handler(new Request('https://mail-smoke.invalid/', { method, headers }), {
              ip: '127.0.0.1',
              site: { url: 'https://mail-smoke.invalid' },
              deploy: { context: 'deploy-preview', published: false },
            })
          : await handler({ httpMethod: method, headers, body: null });
        const status = modern ? response?.status : response?.statusCode;
        if (status !== expectedStatus) return fail('smoke_status');
        checks.push({ check: `${method}:${origin}`, status, passed: true });
      }
    }
  } else if (mode !== 'profile') return fail('unknown_mode');
  await new Promise(resolve => setImmediate(resolve));
  if (networkAttempts) return fail('network_attempt');
  output(
    JSON.stringify({
      ok: true,
      loadMs,
      rssBeforeBytes,
      rssAfterBytes,
      rssDeltaBytes: rssAfterBytes - rssBeforeBytes,
      pid: process.pid,
      networkAttempts,
      checks,
    })
  );
  process.exit(0);
}
main().catch(() => fail(networkAttempts ? 'network_attempt' : 'artifact_failure'));
