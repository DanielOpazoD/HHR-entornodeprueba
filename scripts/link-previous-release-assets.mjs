#!/usr/bin/env node

/**
 * Keeps the files of recent releases reachable after publishing a new one.
 *
 * A tab opened before a release keeps running the old code. When it then loads a part it has not
 * opened yet (a lazy chunk or worker), that hashed file no longer exists in the new deploy and the
 * SPA fallback answers with index.html, so the part fails (measured 2026-11-01 to 11-04: four times,
 * all during night release rounds).
 *
 * Each release publishes release-assets.json: its own /assets files and the older files it still
 * covers, each with the deploy that holds it. The next build reads the live list and writes one
 * unforced rewrite per retired file straight to that deploy's permanent address. Netlify follows
 * a single internal rewrite hop, so every rule targets the deploy that has the file, never a chain.
 * Unforced rules apply only when the file is missing from the new deploy. Retired files are kept
 * for seven days, up to MAX_RETIRED entries (Netlify advises fewer than 10,000 rules). Outside
 * Netlify, or when the live list cannot be read, the build links nothing and starts a new list.
 */

import fs from 'node:fs';

const DEPLOY_ID = /^[0-9a-f]{24}$/;
const SITE_NAME = /^[a-z0-9-]+$/;
const ASSET_FILE = /^[A-Za-z0-9._-]+$/;
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_RETIRED = 4000;
const MANIFEST = 'release-assets.json';

const isTrustedFile = file =>
  typeof file === 'string' && ASSET_FILE.test(file) && !/\.(?:br|gz)$/.test(file);

/** Next release list and its rewrites, from the live list and this build's own files. */
export const planReleaseAssets = ({ live, ownFiles, currentDeployId, siteName, now }) => {
  const own = [...new Set(ownFiles.filter(isTrustedFile))].sort();
  const ownSet = new Set(own);
  const retired = new Map();
  const keep = (file, deployId, retiredAt) => {
    if (!isTrustedFile(file) || ownSet.has(file) || !DEPLOY_ID.test(String(deployId))) return;
    const age = now - Date.parse(retiredAt);
    if (!(age >= 0 && age <= KEEP_MS)) return;
    const known = retired.get(file);
    if (!known || known.retiredAt < retiredAt) retired.set(file, { file, deployId, retiredAt });
  };
  if (live && DEPLOY_ID.test(String(live.deployId)) && live.deployId !== currentDeployId) {
    for (const entry of Array.isArray(live.retired) ? live.retired : [])
      keep(entry?.file, entry?.deployId, String(entry?.retiredAt));
    const retiredNow = new Date(now).toISOString();
    for (const file of Array.isArray(live.assets) ? live.assets : [])
      keep(file, live.deployId, retiredNow);
  }
  const kept = [...retired.values()]
    .sort((a, b) => b.retiredAt.localeCompare(a.retiredAt) || a.file.localeCompare(b.file))
    .slice(0, MAX_RETIRED);
  const rules = SITE_NAME.test(String(siteName))
    ? kept.map(
        ({ file, deployId }) =>
          `/assets/${file}  https://${deployId}--${siteName}.netlify.app/assets/${file}  200`
      )
    : [];
  return { manifest: { deployId: currentDeployId, assets: own, retired: kept }, rules };
};

const readLiveManifest = async siteUrl => {
  const response = await fetch(`${siteUrl}/${MANIFEST}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${MANIFEST} answered HTTP ${response.status}`);
  return response.json();
};

const main = async () => {
  const { NETLIFY, URL: siteUrl, DEPLOY_ID: currentDeployId, SITE_NAME: siteName } = process.env;
  if (NETLIFY !== 'true' || !siteUrl || !DEPLOY_ID.test(currentDeployId ?? '')) {
    console.log('[release-assets] Not a Netlify build; nothing to link.');
    return;
  }
  let live = null;
  try {
    live = await readLiveManifest(siteUrl);
  } catch (error) {
    console.warn(`[release-assets] Live list not read (${error.message}); starting a new one.`);
  }
  const { manifest, rules } = planReleaseAssets({
    live,
    ownFiles: fs.readdirSync('dist/assets'),
    currentDeployId,
    siteName,
    now: Date.now(),
  });
  fs.writeFileSync(`dist/${MANIFEST}`, `${JSON.stringify(manifest)}\n`);
  if (rules.length) fs.appendFileSync('dist/_redirects', `${rules.join('\n')}\n`);
  console.log(
    `[release-assets] ${manifest.assets.length} own files; ${rules.length} older files linked.`
  );
};

if (import.meta.url === `file://${process.argv[1]}`) await main();
