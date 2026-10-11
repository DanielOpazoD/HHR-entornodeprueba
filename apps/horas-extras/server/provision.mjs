import { hashPassword, digest, requireValue } from './security.mjs';
import { normalizeRut } from '../src/domain/overtime.mjs';
export async function provisionPerson(store, input) {
  const rut = normalizeRut(input.rut);
  requireValue(
    rut &&
      typeof input.name === 'string' &&
      input.name.trim() &&
      ['TENS', 'Enfermería', 'Médico'].includes(input.group),
    400,
    'Revisa RUT, nombre y grupo del funcionario.'
  );
  requireValue(
    !input.adminRole || typeof input.adminRole === 'string',
    400,
    'Cargo administrativo inválido.'
  );
  const person = {
    id: digest(rut),
    rut,
    name: input.name.trim(),
    group: input.group,
    adminRole: input.adminRole || '',
    active: true,
    mustChange: true,
    passwordHash: await hashPassword(rut.split('-')[0]),
    authVersion: 1,
    revision: 0,
    shifts: [],
  };
  await store.transaction(async tx => {
    requireValue(
      !(await tx.get('people', person.id)),
      409,
      'El funcionario ya existe; no se sobrescribió su cuenta.'
    );
    tx.set('people', person.id, person);
  });
  return person.id;
}
