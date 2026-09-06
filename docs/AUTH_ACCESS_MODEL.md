# Auth Access Model

## Objetivo

Definir la fuente de verdad y el flujo real del acceso al sistema para que auth no dependa de leer código disperso.

Estado documental:

- este archivo es la referencia canónica para auth/login general;
- si otro documento o comentario contradice este modelo, este archivo prevalece;
- documentación generada o legacy no debe usarse como fuente primaria de permisos.

## 1. Fuente de verdad

Para el **login general** la fuente operativa de acceso es:

- `config/roles` en Firestore

No forman parte del login general:

- `allowedUsers`
- listas hardcodeadas legacy de roles
- lookups cloud legacy fuera del callable actual de resolución

## 2. Regla principal

Un usuario puede iniciar sesión en el shell principal **solo si**:

1. autenticó con Google/Firebase
2. su correo tiene un rol válido en `config/roles`

Si no cumple eso:

- se hace `signOut`
- no se construye sesión de app usable
- no se monta navbar ni módulos
- el usuario vuelve al login con error visible

## 3. Flujo real del login general

```text
Google popup
  -> Firebase Auth user
  -> frontend pide rol efectivo
  -> callable checkUserRole
  -> backend consulta config/roles
  -> rol válido / no autorizado
  -> entrar al shell / signOut + volver a login
```

Puntos clave:

- el cliente **no** lee `config/roles` directamente
- el rol efectivo se resuelve desde backend
- claims viejos no deben volver a autorizar por sí solos un acceso ya revocado
- si aparece un alias legacy de rol en `config/roles`, backend y Gestión de Roles lo recanonizan a `viewer`
- Gestión de Roles además intenta resincronizar el custom claim del usuario afectado cuando detecta esa recanonización

### Un solo ciclo de sesión por pestaña

El ciclo de sesión de React pertenece únicamente a `AuthProvider`. Los módulos,
incluidos los consumidores de Eloísa, leen `useAuth()` y no montan otro `useAuthState()`.
El bootstrap descarta resultados después de desmontar y limpia cualquier suscripción
que llegue tarde. El observador descarta resoluciones anteriores a otro evento o a
un cierre explícito, incluyendo sus efectos de cierre por falta de rol.
La instrumentación existente conserva el primer tiempo y cuenta las repeticiones;
esos contadores no representan necesariamente nuevas consultas de red.

### Inactividad compartida

Las 8 horas de inactividad se coordinan por usuario y origen entre pestañas. Cada
pestaña conserva un temporizador, pero antes de cerrar relee la última actividad
compartida; al volver a primer plano comprueba el plazo sin convertir la visibilidad
en actividad. Ratón, teclado, toque y scroll actualizan la marca local, con publicación
limitada a intervalos de 15 segundos mientras la pestaña puede ejecutar temporizadores;
al ocultarse o salir publica la última marca pendiente, sin añadir actividad. Usa
almacenamiento local y el canal de auth existente. No se comparten datos clínicos.

Entrar en una pestaña autenticada conserva el plazo inicial previo. Re-renderizar
el mismo usuario no reinicia ese plazo. El cierre manual sigue propagándose a todas
las pestañas. Antes de confirmar un vencimiento automático hay una única espera de
un segundo para recibir mensajes pendientes y volver a comprobar la actividad. Esa
espera no garantiza entrega si el navegador sigue suspendiendo mensajes. Si ambos mecanismos no
están disponibles, queda el temporizador local, sin prometer coordinación entre pestañas.

#### Coste y verificación de PR #356 (6 septiembre 2026)

Owner: runtime de autenticación. Dos builds con el mismo entorno local y lockfile:
`main` 261747b9 produjo un shell de 611706 bytes; 991419ba produjo 612889 bytes
(+1183 bytes). El límite anterior, 610608, ya quedaba por debajo del baseline local.
El nuevo límite es 614400 bytes: ajuste total +3792, con enforcement `error` intacto.
La precarga medida del cambio fue 4727,5 KiB; su techo pasa de 4840192 a 4842240 bytes
(+2048). No se excluye el monitor del modo offline ni se añaden dependencias.

Se conserva el arranque síncrono del monitor: diferirlo sólo para mover bytes entre
chunks añadiría un intervalo sin observación y otro ciclo asíncrono que limpiar.
Este ajuste reconoce un coste de fiabilidad, no afirma una mejora de velocidad.
Riesgo: aumento acotado del payload inicial. Rollback: revertir el monitor, restaurar
la precarga a 4840192 y reducir el shell a 612352 bytes, que cubre el baseline medido.
Actualizar las expectativas del test de configuración y verificar ambos presupuestos;
no restaurar 610608 sin resolver primero el exceso preexistente de `main`.
No ampliar nuevamente sin una nueva medición y justificación.
Cierre: budgets, preview y pruebas de sesión verdes en el head final.

Chrome confirmó dos pestañas autenticadas, una marca de actividad compartida que
avanza tras teclado y recuperación de sesión al recargar y al cerrar/abrir una pestaña.
Las 8 horas y sus carreras se prueban con reloj controlado, sin adelantar el reloj ni
forzar logout de una sesión clínica real.

## 3.1 Convergencia obligatoria con Netlify Functions

`LAB` y `MMRAD` no pueden usar una semántica distinta de rol respecto del shell.

Regla vigente:

- el shell resuelve rol por el callable `checkUserRole`;
- las Netlify Functions sensibles también deben resolver el rol efectivo por ese mismo callable;
- `config/roles` sigue siendo la fuente de verdad;
- claims sincronizados son auxiliares, no la fuente primaria para `LAB/MMRAD`.

Esto evita el incidente clásico:

- usuario entra al shell;
- pero `syslab-proxy` o `mmrad-search` lo rechazan como `unauthorized`.

Documento específico:

- [Netlify Auth Role Convergence](./architecture/NETLIFY_AUTH_ROLE_CONVERGENCE.md)

## 4. Política de compatibilidad legacy

La compatibilidad con alias legacy como `viewer_census` se mantiene mientras esta aplicación aún no sea la versión oficial. Esa compatibilidad es una protección de migración, no una superficie para construir features nuevas.

No debe crecer con consumidores nuevos. Su retiro queda diferido hasta que el sistema sea oficial y exista una auditoría de producción que confirme ausencia de claims, `config/roles`, sesiones o flujos activos dependientes de aliases legacy.

## 5. Shared Census

No existe una vía paralela de acceso por link para el censo.

No usa la misma regla de acceso que el login general y no debe mezclarse con este modelo.

## 6. Roles operativos actuales

| Rol                 | Puede usar login general | Alcance resumido                                       |
| ------------------- | ------------------------ | ------------------------------------------------------ |
| `admin`             | sí                       | acceso completo                                        |
| `nurse_hospital`    | sí                       | operación clínica/enfermería                           |
| `doctor_urgency`    | sí                       | handoff/firma médica y permisos clínicos asociados     |
| `doctor_specialist` | sí                       | `CENSUS` + `MEDICAL_HANDOFF` con capacidades limitadas |
| `viewer`            | sí                       | acceso limitado según policy vigente                   |
| `editor`            | sí                       | accesos técnicos/operativos según policy vigente       |

## 7. Perfil especialista

`doctor_specialist`:

- entra por el login normal con Google
- no tiene shell paralelo
- no usa modo/link especial separado
- depende de la misma resolución de rol que los demás usuarios internos

## 8. Qué hace Gestión de Roles

La sección web de Gestión de Roles:

- agrega o elimina correos en `config/roles`
- define el rol efectivo del login general

Efecto esperado:

- si un correo se agrega en `config/roles`, puede entrar
- si un correo se elimina de `config/roles`, deja de poder entrar

## 9. Qué revisar si un usuario “debería entrar” pero no entra

1. confirmar que el correo esté presente y bien escrito en `config/roles`
2. confirmar que el rol asignado sea válido
3. si el documento viene de una migración antigua, recargar Gestión de Roles para forzar recanonización del alias legacy y reintento de sync del claim
4. confirmar que frontend publicado incluya la resolución actual por `checkUserRole`
5. confirmar que functions publicadas consulten `config/roles`
6. confirmar que `firestore.rules` publicadas no hayan cambiado el perímetro

## 10. Qué revisar si un usuario “removido” sigue entrando

1. verificar que el correo realmente ya no esté en `config/roles`
2. verificar que el callable `checkUserRole` ya esté desplegado
3. verificar que el frontend publicado ya no dependa de fuentes legacy
4. hacer recarga dura y repetir login

## 11. Archivos clave

- [src/services/auth/authAccessResolution.ts](../src/services/auth/authAccessResolution.ts)
- [src/services/auth/authPolicy.ts](../src/services/auth/authPolicy.ts)
- [src/services/auth/authRoleLookup.ts](../src/services/auth/authRoleLookup.ts)
- [functions/lib/auth/authFunctionsFactory.js](../functions/lib/auth/authFunctionsFactory.js)
- [functions/lib/auth/authHelpersFactory.js](../functions/lib/auth/authHelpersFactory.js)
- [netlify/functions/lib/firebase-auth.ts](../netlify/functions/lib/firebase-auth.ts)
- [firestore.rules](../firestore.rules)
- [Firestore Rules Critical Access Matrix](./FIRESTORE_RULES_CRITICAL_ACCESS_MATRIX.md)

## 12. Recovery administrativo

La recuperación administrativa ya no usa correos hardcodeados en rules, functions ni frontend.

La vía válida es:

1. restaurar el correo en `config/roles` con rol `admin`
2. volver a iniciar sesión o ejecutar `syncCurrentUserRoleClaim`
3. verificar que `checkUserRole` y el claim sincronizado converjan al mismo rol

Reglas operativas:

- no agregar allowlists técnicas nuevas
- no otorgar acceso por frontend optimista
- no dejar funciones sensibles dependiendo de correos embebidos
- cualquier bypass temporal de permisos debe considerarse incidente y no patrón aceptado

## 13. Runbook de incidentes

Para soporte operativo rápido:

- [Runbook Auth Access Incidents](./RUNBOOK_AUTH_ACCESS_INCIDENTS.md)
