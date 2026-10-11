import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePassword, demoPassword, needsPasswordChange } from '../src/domain/password.mjs';
test('password is freely chosen, including one character, without composition rules', () => {
  for (const value of ['a', '1', 'ñ', '🙂', 'solo minusculas'])
    assert.equal(validatePassword(value, value), '');
  assert.notEqual(validatePassword('a', 'b'), '');
  assert.notEqual(validatePassword('', ''), '');
});
test('initial RUT password is replaced and later changes are respected in the session', () => {
  const person = { id: 'ana', rut: '11111111-1' };
  assert.equal(demoPassword(person, {}), '11111111');
  assert.equal(needsPasswordChange(person.id, {}), true);
  assert.equal(demoPassword(person, { ana: 'a' }), 'a');
  assert.equal(needsPasswordChange(person.id, { ana: 'a' }), false);
  assert.equal(demoPassword(person, { ana: 'b' }), 'b');
});

test('mandatory first change replaces the initial credential without strength requirements', () => {
  assert.notEqual(validatePassword('11111111', '11111111', '11111111'), '');
  assert.equal(validatePassword('a', 'a', '11111111'), '');
  assert.equal(validatePassword('11111111', '11111111'), '');
});
