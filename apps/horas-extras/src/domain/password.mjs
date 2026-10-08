export function validatePassword(password, confirmation, initialPassword) {
  if (!password) return 'Escribe tu nueva clave.';
  if (initialPassword !== undefined && password === initialPassword)
    return 'Elige una clave distinta a la inicial.';
  if (password !== confirmation) return 'Las claves no coinciden.';
  return '';
}
export const demoPassword = (person, passwords) => passwords[person.id] ?? person.rut.split('-')[0];
export const needsPasswordChange = (id, passwords) => !Object.hasOwn(passwords, id);
