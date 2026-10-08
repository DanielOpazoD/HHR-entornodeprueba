import { normalizeRut, makeShift, overlaps, periodInfo } from '../src/domain/overtime.mjs';
import {
  digest,
  token,
  hashPassword,
  verifyPassword,
  HttpError,
  requireValue,
  publicPerson,
} from './security.mjs';

const SESSION_MS = 12 * 60 * 60 * 1000;
const COOKIE = 'overtime_session';
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const monthOf = (person, period) => ({
  ...publicPerson(person),
  shifts: (person.shifts || []).filter(s => s.date.startsWith(`${period}-`)),
});
const cookieValue = request =>
  request.headers
    .get('cookie')
    ?.split(';')
    .map(s => s.trim())
    .find(s => s.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);

// All authorization and writes run here. Browser roles, totals and owner IDs are never trusted.
export function createApi({ store, origin, secureCookies = true, now = Date.now }) {
  const dummyHash = hashPassword(token());
  const cookie = (value, age = SESSION_MS / 1000) =>
    `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secureCookies ? '; Secure' : ''}`;
  const json = (data, status = 200, extra = {}) =>
    Response.json(data, {
      status,
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
    });
  async function bodyOf(request) {
    requireValue(
      request.headers.get('content-type')?.startsWith('application/json'),
      415,
      'Envía datos JSON.'
    );
    const reader = request.body?.getReader();
    let bytes = 0,
      chunks = [];
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 16384) {
          await reader.cancel();
          throw new HttpError(413, 'Solicitud demasiado grande.');
        }
        chunks.push(value);
      }
    }
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requireValue(
        body && typeof body === 'object' && !Array.isArray(body),
        400,
        'Solicitud inválida.'
      );
      return body;
    } catch {
      throw new HttpError(400, 'Solicitud inválida.');
    }
  }
  async function rateLimit(ip, rut, action = 'login') {
    await store.transaction(async tx => {
      const keys = [`${action}_ip_${digest(ip)}`, `${action}_rut_${digest(rut || 'invalid')}`];
      const records = await Promise.all(keys.map(key => tx.get('limits', key)));
      records.forEach((record, i) => {
        const current =
          record && record.until > now() ? record : { count: 0, until: now() + 15 * 60 * 1000 };
        requireValue(
          current.count < (i === 0 ? 300 : 5),
          429,
          'Demasiados intentos. Espera 15 minutos antes de reintentar.'
        );
        tx.set('limits', keys[i], {
          ...current,
          count: current.count + 1,
          expiresAt: new Date(current.until),
        });
      });
    });
  }
  async function authenticated(request, tx, allowInitial = false) {
    const value = cookieValue(request);
    requireValue(value && /^[a-f0-9]{64}$/.test(value), 401, 'Inicia sesión nuevamente.');
    const session = await tx.get('sessions', digest(value));
    requireValue(session && session.expires > now(), 401, 'Tu sesión terminó. Vuelve a ingresar.');
    const person = await tx.get('people', session.personId);
    requireValue(
      person?.active && session.version === person.authVersion,
      401,
      'Inicia sesión nuevamente.'
    );
    requireValue(
      allowInitial || !person.mustChange,
      403,
      'Cambia tu clave inicial para continuar.'
    );
    return { person, session, sessionId: digest(value) };
  }
  return async function handle(request, { ip = 'unknown' } = {}) {
    try {
      const url = new URL(request.url);
      const route = url.pathname.replace(/^\/api\/overtime/, '');
      const method = request.method;
      if (method !== 'GET') {
        requireValue(
          request.headers.get('origin') === origin,
          403,
          'Origen de solicitud no permitido.'
        );
      }
      if (method === 'POST' && route === '/login') {
        const body = await bodyOf(request);
        const rut = normalizeRut(typeof body.rut === 'string' ? body.rut : '');
        await rateLimit(ip, rut);
        requireValue(
          typeof body.password === 'string' &&
            body.password.length > 0 &&
            body.password.length <= 4096,
          401,
          'RUT o clave incorrectos.'
        );
        const person = rut ? await store.get('people', digest(rut)) : null;
        const valid = await verifyPassword(
          body.password,
          person?.passwordHash || (await dummyHash)
        );
        requireValue(person?.active && valid, 401, 'RUT o clave incorrectos.');
        const value = token();
        await store.transaction(async tx => {
          const current = await tx.get('people', person.id);
          requireValue(
            current?.active && current.authVersion === person.authVersion,
            401,
            'Vuelve a iniciar sesión.'
          );
          tx.set('sessions', digest(value), {
            personId: person.id,
            version: person.authVersion,
            expires: now() + SESSION_MS,
            expiresAt: new Date(now() + SESSION_MS),
          });
        });
        return json({ person: publicPerson(person) }, 200, { 'Set-Cookie': cookie(value) });
      }
      if (method === 'POST' && route === '/logout') {
        const value = cookieValue(request);
        if (value && /^[a-f0-9]{64}$/.test(value)) await store.delete('sessions', digest(value));
        return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
      }
      if (method === 'GET' && route === '/me') {
        const { person } = await authenticated(request, store, true);
        return json({ person: publicPerson(person) });
      }
      if (method === 'POST' && route === '/password') {
        const { person: caller } = await authenticated(request, store, true);
        await rateLimit(ip, caller.rut, 'password');
        const body = await bodyOf(request);
        requireValue(
          typeof body.password === 'string' &&
            body.password.length > 0 &&
            body.password.length <= 4096,
          400,
          'Escribe una clave de hasta 4096 caracteres.'
        );
        const nextHash = await hashPassword(body.password);
        const value = token();
        const updated = await store.transaction(async tx => {
          const { person, sessionId } = await authenticated(request, tx, true);
          requireValue(
            !person.mustChange || body.password !== person.rut.split('-')[0],
            400,
            'Elige una clave distinta a la inicial.'
          );
          const next = {
            ...person,
            passwordHash: nextHash,
            mustChange: false,
            authVersion: person.authVersion + 1,
          };
          tx.set('people', person.id, next);
          tx.delete('sessions', sessionId);
          tx.set('sessions', digest(value), {
            personId: person.id,
            version: next.authVersion,
            expires: now() + SESSION_MS,
            expiresAt: new Date(now() + SESSION_MS),
          });
          return publicPerson(next);
        });
        return json({ person: updated }, 200, { 'Set-Cookie': cookie(value) });
      }
      if (method === 'GET' && route === '/month') {
        const { person } = await authenticated(request, store);
        const period = url.searchParams.get('period');
        periodInfo(period || '');
        const team = url.searchParams.get('team') === 'true';
        requireValue(
          !team || person.adminRole,
          403,
          'Solo ADMIN puede consultar las planillas del equipo.'
        );
        const people = team ? await store.list('people') : [person];
        return json({
          period,
          sheets: people
            .filter(p => p.active)
            .map(p => monthOf(p, period))
            .sort((a, b) => a.name.localeCompare(b.name, 'es')),
        });
      }
      if ((method === 'PUT' || method === 'DELETE') && route === '/shift') {
        const body = await bodyOf(request);
        requireValue(body && identifier(body.id), 400, 'Identificador de turno inválido.');
        periodInfo(body.period || '');
        const result = await store.transaction(async tx => {
          const { person } = await authenticated(request, tx);
          requireValue(
            body.revision === person.revision,
            409,
            'Tus registros cambiaron en otra sesión. Actualiza el mes antes de guardar.'
          );
          const shifts = person.shifts || [];
          const previous = shifts.find(s => s.id === body.id);
          requireValue(
            !previous || previous.date.startsWith(`${body.period}-`),
            400,
            'El turno pertenece a otro mes.'
          );
          let nextShifts;
          if (method === 'DELETE') {
            requireValue(previous, 404, 'Turno no encontrado.');
            nextShifts = shifts.filter(s => s.id !== body.id);
          } else {
            requireValue(
              body.shift &&
                typeof body.shift.note === 'string' &&
                typeof body.shift.nextDay === 'boolean',
              400,
              'Datos de turno inválidos.'
            );
            const shift = makeShift({ ...body.shift, id: body.id });
            requireValue(
              shift.date.startsWith(`${body.period}-`),
              400,
              'El turno debe pertenecer al mes seleccionado.'
            );
            requireValue(
              !overlaps(shifts, shift),
              409,
              'Este horario se superpone con otro turno.'
            );
            requireValue(
              previous || shifts.length < 1500,
              400,
              'Se alcanzó la capacidad de registros. Contacta al administrador.'
            );
            nextShifts = [...shifts.filter(s => s.id !== body.id), shift].sort(
              (a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)
            );
          }
          const next = { ...person, shifts: nextShifts, revision: person.revision + 1 };
          requireValue(
            Buffer.byteLength(JSON.stringify(next), 'utf8') < 500000,
            400,
            'Se alcanzó la capacidad de registros. Contacta al administrador.'
          );
          tx.set('people', person.id, next);
          return { period: body.period, sheets: [monthOf(next, body.period)] };
        });
        return json(result);
      }
      throw new HttpError(404, 'Ruta no disponible.');
    } catch (error) {
      const status = error.status || (error instanceof TypeError ? 400 : 500);
      // Domain validation errors are safe Spanish messages; never expose datastore errors.
      const domainError =
        /^(Fecha|El calendario|Selecciona|Horario|El turno|La observación|Período|Año|Mes)/.test(
          error.message
        );
      return json(
        {
          error:
            domainError && !error.status
              ? error.message
              : status < 500
                ? error.message
                : 'No se pudo completar la operación. Inténtalo de nuevo.',
        },
        domainError && !error.status ? 400 : status
      );
    }
  };
}
