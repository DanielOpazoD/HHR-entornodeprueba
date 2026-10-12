#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const expectedChecksums = opts => {
  if (
    opts.skipChecksumAndSize ||
    !Number.isSafeInteger(opts.expectedSize) ||
    opts.expectedSize <= 0 ||
    !/^[a-f0-9]{32}$/i.test(opts.expectedChecksum || '') ||
    !/^[a-f0-9]{1,64}$/i.test(opts.expectedChecksumSHA256 || '')
  ) {
    throw new Error('The installed SDK must supply pinned size, MD5 and SHA-256 metadata.');
  }
  return {
    md5: opts.expectedChecksum.toLowerCase(),
    // The SDK's hexadecimal representation can omit leading zeros.
    sha256: opts.expectedChecksumSHA256.toLowerCase().padStart(64, '0'),
  };
};

export const verifyEmulatorArtifact = async details => {
  const { opts } = details;
  const expected = expectedChecksums(opts);
  if (!fs.existsSync(details.downloadPath)) return false;
  const stat = fs.lstatSync(details.downloadPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== opts.expectedSize) return false;
  const md5 = crypto.createHash('md5');
  const sha256 = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(details.downloadPath)) {
    md5.update(chunk);
    sha256.update(chunk);
  }
  return md5.digest('hex') === expected.md5 && sha256.digest('hex') === expected.sha256;
};

export const prepareEmulatorArtifact = async ({ details, download }) => {
  if (await verifyEmulatorArtifact(details)) return 'verified-cache';
  fs.rmSync(details.downloadPath, { force: true });
  await download();
  if (!(await verifyEmulatorArtifact(details)))
    throw new Error('Downloaded Firestore artifact failed SDK integrity verification.');
  return 'verified-download';
};

const main = async () => {
  const require = createRequire(import.meta.url);
  const { getDownloadDetails } = require('firebase-tools/lib/emulator/downloadableEmulators');
  const details = getDownloadDetails('firestore');
  if (process.argv.slice(2).join(' ') === '--metadata') {
    // Validate SDK metadata even before deciding which cache can be read.
    const checksums = expectedChecksums(details.opts);
    const outputs = `path=${details.downloadPath}\nkey=firestore-v1-${details.version}-${details.opts.expectedSize}-${checksums.sha256}\n`;
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, outputs);
    else process.stdout.write(outputs);
    return;
  }
  if (process.argv.length > 2) throw new Error('Expected no arguments or --metadata.');
  const result = await prepareEmulatorArtifact({
    details,
    download: () => {
      const child = spawnSync(
        process.execPath,
        [require.resolve('firebase-tools/lib/bin/firebase'), 'setup:emulators:firestore'],
        { stdio: 'inherit', env: process.env }
      );
      if (child.error || child.signal || child.status !== 0)
        throw new Error(
          `Firestore preparation failed: ${child.error?.message || child.signal || child.status}`
        );
    },
  });
  console.log(`[firestore-cache] ${result} (${details.version})`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`[firestore-cache] ${error.message}`);
    process.exitCode = 1;
  }
}
