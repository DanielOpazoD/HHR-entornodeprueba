#!/usr/bin/env node

import fs from 'node:fs';
import { runFeatureBoundaryCheck } from './lib/featureBoundaryRunner.mjs';

const { publicModulesByFeature } = JSON.parse(
  fs.readFileSync(new URL('./feature-public-api-allowlist.json', import.meta.url), 'utf8')
);

runFeatureBoundaryCheck({
  feature: 'clinical-documents',
  label: 'Clinical-documents',
  extraPublicModules: publicModulesByFeature['clinical-documents'],
});
