export const localEmulator = import.meta.env.VITE_OVERTIME_MODE === 'emulator';
export const cloudMode = localEmulator || import.meta.env.VITE_OVERTIME_MODE === 'cloud';
export async function api(path, { signal, method = 'GET', body } = {}) {
  const response = await fetch(`/api/overtime${path}`, {
    method,
    signal,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('El servicio de guardado no está disponible.');
  }
  if (!response.ok) {
    const error = new Error(data.error || 'No se pudo completar la operación.');
    error.status = response.status;
    throw error;
  }
  return data;
}
