// Local provisioning only. Read the roster from a private file; never commit it.
import { readFile } from 'node:fs/promises';
import { configuredStore } from '../server/firestore.mjs';
import { provisionPerson } from '../server/provision.mjs';
const [, , file, confirmedProject] = process.argv;
if (!file || confirmedProject !== process.env.OVERTIME_FIREBASE_PROJECT_ID)
  throw new Error('Indica archivo privado y proyecto destino exacto.');
const people = JSON.parse(await readFile(file, 'utf8'));
if (!Array.isArray(people)) throw new Error('El archivo debe contener una lista.');
const store = configuredStore();
let count = 0;
for (const person of people) {
  await provisionPerson(store, person);
  count++;
}
console.log(`${count} cuentas creadas; claves iniciales protegidas con scrypt.`);
