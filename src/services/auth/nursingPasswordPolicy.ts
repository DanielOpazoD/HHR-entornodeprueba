export const NURSING_PASSWORD_HINT =
  'De 6 a 128 caracteres, al menos una mayúscula y un número. No requiere símbolos.';
export const isValidNursingPassword = (value: string): boolean =>
  value.length >= 6 && value.length <= 128 && /[A-ZÁÉÍÓÚÜÑ]/.test(value) && /[0-9]/.test(value);
export const rutUsername = (value: string): string => value.replace(/[.\s-]/g, '').toLowerCase();
