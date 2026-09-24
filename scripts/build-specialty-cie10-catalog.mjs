import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = JSON.parse(readFileSync(resolve('public/data/cie10_spanish.json'), 'utf8'));
const labels = Object.fromEntries(source.map(({ code, description }) => [code, description]));
if (Object.keys(labels).length !== source.length) {
  throw new Error('The CIE-10 catalog contains duplicate codes.');
}
writeFileSync(resolve('functions/lib/clinicalCie10Catalog.json'),
  `${JSON.stringify(labels)}\n`);
