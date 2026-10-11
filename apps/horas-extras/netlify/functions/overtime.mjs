import { createApi } from '../../server/api.mjs';
import { configuredStore } from '../../server/firestore.mjs';
let handler;
export default async (request, context) => {
  try {
    if (!handler) {
      const origin = process.env.OVERTIME_APP_ORIGIN;
      if (!origin || !origin.startsWith('https://') || new URL(origin).origin !== origin)
        throw new Error('Falta configurar el origen HTTPS.');
      handler = createApi({ store: configuredStore(), origin });
    }
    return await handler(request, { ip: context.ip });
  } catch {
    return Response.json(
      { error: 'El servicio de Horas Extras aún no está configurado.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
};
export const config = { path: '/api/overtime/*' };
