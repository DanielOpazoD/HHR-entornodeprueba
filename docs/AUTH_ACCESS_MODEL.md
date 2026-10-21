# Auth Access Model

## Aislamiento de limpieza y nuevo ingreso

La admisión de un usuario espera la transición de almacenamiento antes de publicar
un estado autorizado al censo. La limpieza y la admisión usan el mismo Web Lock
del origen, además de una cola por documento. Firebase y su copia persistida se
cierran dentro de esa transición, tanto en el cierre normal como en el recibido
por canal y el botón del shell de arranque.

Cada admisión inicial obtiene una generación aleatoria compartida, reutilizada
por las demás pestañas del mismo propietario. Tras cerrar, el siguiente ingreso
obtiene otra generación, incluso para el mismo usuario. Un mensaje de cierre de
una generación anterior no debe borrar el estado de la nueva. Los mensajes
antiguos sin generación conservan compatibilidad: para la protección completa
entre documentos es necesario que todas las pestañas ejecuten la versión nueva.

Se intentan independientemente registros, cola y Web Storage. Un error se propaga
y conserva la marca de limpieza pendiente; la admisión debe reintentarla antes de
habilitar datos. Para cuentas individuales `hhrn_`, la cola pendiente se conserva bajo su propietario y se retiran leases/attemptId antes de admitir otro usuario. Los registros visibles y cachés de la sesión se limpian. Los demás usuarios mantienen la limpieza existente.
Los adaptadores de registros y cola mantienen su comportamiento anterior salvo
cuando la limpieza de sesión solicita explícitamente propagar errores.

Si falla el cierre local de Firebase, se conserva su operación para reintentarla
antes de admitir otro estado autorizado. Incluso si ese reintento resulta exitoso,
el evento autorizado previo al cierre se descarta: se requiere un ingreso posterior.
Los mensajes del canal se evalúan dentro de la transición, no antes de esperarla.

Excepción de seguridad: si no se puede leer la generación compartida, no existe
evidencia para autorizar un borrado global. En ese caso se intenta cerrar Firebase
y limpiar sessionStorage, se informa `session_cleanup_failed` y se conserva la
necesidad de reintentar en el documento. No se promete recuperación persistida si
el propio navegador impide escribir los metadatos de recuperación. Un fallo al
escribir la marca, con generación ya verificada, no impide intentar las demás
limpiezas.

Chrome con Web Locks coordina las pestañas del mismo origen. Sin esa API existe
serialización local, pero no se garantiza exclusión entre documentos. No se usan
timeouts para declarar una limpieza completada. Esta protección no cancela por sí
sola escrituras clínicas ya iniciadas fuera del flujo de autenticación.

## Objetivo

### Acceso principal con selector Google (FedCM)

`VITE_GOOGLE_SIGN_IN_CLIENT_ID` muestra el único botón oficial GIS con
`use_fedcm_for_button`, sin One Tap automático ni selección automática. No se activa
automáticamente al montar la pantalla. El cliente OAuth debe pertenecer al proveedor Google de
Firebase y autorizar el origen JavaScript exacto, incluido el puerto local.

El ID token se entrega directamente a Firebase, sin guardarlo ni registrarlo.
Se reutilizan el bloqueo de ingreso, la transición de almacenamiento y la resolución
de roles. No se crean observadores adicionales ni se solicitan permisos de Drive.
Si falta configuración o falla la carga de GIS, se muestra en su lugar un único
botón de respaldo con el popup y recuperación existentes. Nunca se inicia ese popup
sin pulsar el botón. Al desmontar el selector se descartan callbacks antiguos. FedCM depende del
navegador y de Google; no garantiza evitar una ventana externa en todos los casos.

El cliente público está configurado en `netlify.toml`; cada dominio estable debe
estar autorizado en Google OAuth y Firebase. Los previews con hostname variable
requieren su propio origen autorizado para probar GIS; no se amplían permisos OAuth.
Rollback: quitar la variable del build y reconstruir para volver al único botón
de respaldo. La prueba en Chrome no demuestra compatibilidad con todos los navegadores
ni una mejora de velocidad.

Definir la fuente de verdad y el flujo real del acceso al sistema para que auth no dependa de leer código disperso.

Estado documental:

- este archivo es la referencia canónica para auth/login general;
- si otro documento o comentario contradice este modelo, este archivo prevalece;
- documentación generada o legacy no debe usarse como fuente primaria de permisos.

## 1. Fuente de verdad

Para el **login general** la fuente operativa de acceso es:

- Cuentas individuales: `hhr_account_access/{uid}` (estado, rol y versión), validado por el servidor.
- Google durante transición: `config/roles` en Firestore.
- Con `config/individualAccounts.enabled`: sólo cuentas individuales activas y los dos Google protegidos, identificados por UID verificado; el mapa legacy deja de conceder acceso.

No forman parte del login general:

- `allowedUsers`
- listas hardcodeadas legacy de roles
- lookups cloud legacy fuera del callable actual de resolución

## 2. Regla principal

Un usuario puede iniciar sesión en el shell principal **solo si**:

1. autenticó con Firebase mediante Google o RUT y clave privada;
2. su estado de acceso vigente cumple la política anterior, incluida versión de sesión y proveedor;
3. una cuenta individual ya estableció su clave mediante activación privada y su sesión no supera doce horas.

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
- el backend resuelve cuentas individuales por UID/estado/versión y Google según la política de transición;
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

## 14. Metadatos temporales del censo

Las actualizaciones directas de enfermería y especialista requieren que `date`, el ID
del documento y la fecha UTC de `dateTimestamp` coincidan. Un timestamp persistido no
se reemplaza; si falta o es null, sólo puede repararse con un entero coherente con
esa fecha y dentro de la ventana de edición del rol. El cliente conserva timestamps
válidos al normalizar, aunque difieran de la medianoche de la zona horaria del dispositivo.
Los timestamps nuevos o reparados se generan a medianoche en `Pacific/Easter` de la
fecha del documento (05:00Z en verano; 06:00Z en invierno), independientemente del
dispositivo. Conservan así el anclaje hospitalario de las ventanas rolling; la fecha
UTC sigue coincidiendo con el ID. No se migran timestamps persistidos válidos.
Metadatos existentes inconsistentes requieren reparación administrativa antes de editar;
no se debe corregirlos asignando la hora actual a un registro histórico.

La escritura productiva del especialista usa el callable con día clínico del calendario
compartido: `Pacific/Easter`, cambio a las 08:00 hábiles y 09:00 fines de semana/feriados.
Las reglas de escritura directa conservan sus ventanas rolling, no el calendario completo.

La enfermería conserva el intervalo abierto desde 24 horas antes hasta 48 horas
después del timestamp; el especialista directo conserva `[timestamp, timestamp + 24h)`.
Son duraciones absolutas y no se cambian a ventanas 08:00/09:00: ese corte pertenece
al callable clínico. En un cambio de horario, 24 horas rolling no equivalen necesariamente
a volver a la misma hora local.

Para un registro legacy inconsistente: confirmar ID y fecha del censo, conservar copia
previa, y reparar sólo esos metadatos mediante la ruta administrativa autorizada,
anclando al día correcto (nunca a la hora actual). Después, comprobar que la edición
ordinaria respeta la ventana y que un usuario no administrador no puede cambiar el
timestamp. Esta integración no ejecuta reparaciones ni acredita cuántos registros
legacy existen: no se consultó un inventario clínico real.

## Revocación explícita de acceso

Gestión de Roles conserva `unauthorized` en `config/roles` al retirar un acceso.
No se debe borrar esa entrada: las reglas mantienen compatibilidad con claims
legacy cuando no hay configuración. La marca explícita impide ese fallback en
Firestore y Storage, incluso con un token emitido antes de retirar el permiso.
Los usuarios revocados no aparecen en la lista de roles activos; asignarles un rol
explícitamente permite restablecer el acceso. No modifica ni borra datos clínicos.

Storage consulta el documento de roles de la base Firestore `(default)`. El despliegue
necesita la integración de permisos entre ambos servicios; validarla antes de publicar
las reglas en un entorno real. Un fallo de consulta no autoriza por el claim antiguo.
Las pruebas usan emuladores de ambos servicios y la misma identidad antes/después.
Esto no invalida archivos ya descargados ni enlaces de descarga con token de acceso.
Las bajas anteriores que borraron su configuración requieren revisión separada; no
se infiere quién fue revocado ni se retiran permisos históricos automáticamente.

## Cuentas individuales de enfermería

El RUT con DV es sólo el alias de ingreso. El padrón privado y su índice están
vedados a clientes; sólo el administrador consulta el RUT mediante el callable.
La identidad Firebase usa un UID estable y correo técnico opaco, sin RUT. Las
contraseñas personales las almacena y verifica Firebase Auth. El usuario visible es
el RUT completo sin puntos ni guion, con k minúscula (17752753k). Internamente se
conserva el RUT canónico con DV para no romper índices existentes.

La creación exige nombre, RUT válido y verificación individual. El importador
sólo prepara candidatos en memoria: un nombre parecido no identifica una persona,
un RUT duplicado bloquea la fila y ninguna importación activa usuarios en lote.
La referencia de origen y el administrador verificador quedan en el padrón privado.
Estas cuentas reciben únicamente el rol de enfermería; no pueden autoasignarse
roles ni convertirse en administradoras.

Las cuentas nuevas verificadas por el administrador empiezan pendientes, con Auth
inhabilitado. La clave inicial es el cuerpo numérico del RUT (17752753 en el ejemplo),
por decisión explícita de producto. Es predecible: conocer el RUT permite reclamar
una cuenta aún no activada; el cambio obligatorio no acredita por sí solo identidad.
El primer ingreso sólo entrega un permiso efímero de preparación, sin sesión ni
acceso clínico. El titular debe elegir una clave y registrar su correo de recuperación.
La clave personal requiere 6–128 caracteres (mínimo del proveedor), una mayúscula y
un número; no requiere símbolos. Nunca se guarda la clave inicial/personal en Firestore.
La clave inicial queda deshabilitada al canjear la preparación. No se restablecen
claves de cuentas activas ni se migran cuentas reales automáticamente.

Se conserva el código privado administrativo de un uso y una hora para recuperar
activaciones interrumpidas o cuentas sin correo. Emitirlo revoca la clave inicial.
El permiso de primer ingreso dura 10 minutos. Ambos están ligados a cuenta/versión;
Firestore conserva hashes y el navegador sólo estado en memoria. La activación
registrará el correo privado junto con la transición de credenciales.

«Olvidé mi contraseña» pide el RUT y envía un código de 8 cifras al correo registrado
por el titular, nunca a un correo enviado en esa solicitud. El código vence en 10
minutos, admite cinco intentos y se consume transaccionalmente una sola vez. Cada
cambio de clave invalida otros códigos por versión. Se aplican límites por cuenta/IP;
una cuenta suspendida, retirada o con operación incierta no se recupera por correo.
La respuesta pública no confirma existencia ni dirección de correo. Un envío fallido
invalida el desafío; la pantalla indica condicionalmente el envío, sin afirmar entrega.
El correo no incluye RUT ni información clínica. El proveedor de correo es Gmail
institucional, con secretos sólo en la función de solicitud.

Cambio de clave exige la clave actual; recuperación exige el código recibido o una
nueva activación administrada para cuentas antiguas sin correo.
Ambas incrementan la versión de autorización. Functions, Firestore
y Storage comprueban estado activo, versión, proveedor password y antigüedad de
sesión, sin confiar en claims antiguos. Un lock de credenciales mantiene cerrado
el acceso durante escrituras Auth inciertas. Una recuperación administrativa
puede cerrar una operación interrumpida después de cinco minutos, más que los
60 segundos máximos del callable; conserva la identidad original y nunca activa
por el mero estado enviado por el cliente.

La sesión usa persistencia de navegador por pestaña y el control de inactividad
existente. Un monitor consulta la autorización y cierra la UI conectada al detectar
revocación; las reglas aplican la revocación en cada operación, independientemente
de ese monitor. Las tareas offline legítimas permanecen asociadas a su UID, sin
reintento automático ni transferencia de autor al siguiente usuario.

## Transición y recuperación administrativa

El panel mantiene Google y permite crear, activar, suspender, retirar, recuperar y
revocar sesiones individuales. Muestra auditoría acotada de operaciones, nunca claves
ni códigos usados. La retirada global de accesos legacy es una acción explícita
posterior al piloto: verifica que los UID de `daniel.opazo@hospitalhangaroa.cl` y
`hospitalizados@hospitalhangaroa.cl` tengan Google verificado y estén habilitados.
Sólo Daniel puede efectuar esa transición; no se borran identidades Firebase ni
se reescriben censos, firmas, turnos, movimientos o autorías históricas. La cuenta
institucional compartida conserva su propio UID; el enfermero seleccionado en
un turno no se transforma en autor de su sesión.

Desplegar primero Functions y reglas Firestore/Storage compatibles, comprobar el
piloto sintético en el entorno de pruebas y después habilitar el nuevo cliente y
las personas verificadas. Un merge no prueba ese despliegue ni la vigencia laboral
del padrón. No activar masivamente candidatos ni borrar cuentas de aplicaciones
que comparten el proyecto. El control de MFA de Google se mantiene en el proveedor;
no se declara MFA verificado ni se sustituye por una marca local.

Comprobación específica: `npm run test:accounts:emulator:ci` usa únicamente proyecto
demo y loopback, valida activación/cambio/revocación contra Auth real emulado,
Firestore y Storage, los dos Google y la inmutabilidad de un documento histórico
sintético. CI ejecuta ese contrato además de los gates de reglas y runtime.

Las identidades de contraseña sin perfil individual administrado quedan denegadas incluso antes del corte de accesos legados. No heredan roles por coincidencia de correo ni reciben claims del trigger de alta; así habilitar el proveedor de contraseña no abre los roles antiguos al autorregistro. Google conserva su flujo existente.

Las pantallas de activación, cambio de clave y administración se cargan al abrirse, con su adaptador callable; requieren Firebase online y no forman parte de la precarga offline. El monitor de vencimiento y la conservación de pendientes siguen precargados. Copiar una activación usa el adaptador privado: no conserva el código en capturas E2E ni en Web Storage, incluido localhost.

### Carga y disponibilidad sin conexión

La administración de usuarios y permisos se carga al abrir su panel y necesita conexión para leer la autoridad vigente y modificar cuentas. Su chunk no pertenece al precache clínico. El menú de usuario se carga al abrirlo, permanece en precache y conserva un cierre de sesión inmediato aun si ese recurso tarda o falla. El monitor de sesiones individuales, la preservación de la cola y la semilla clínica continúan disponibles sin conexión. Los límites de tamaño permanecen sin cambios.

### Administración de cuentas por RUT (PR 919)

Nombre y rol se editan desde Usuarios del equipo usando la matriz asignable vigente.
Cada modificación incrementa la versión de acceso y renueva los claims bajo el
bloqueo de credenciales; una sesión anterior no retiene permisos del rol previo.
Resetear vuelve al primer ingreso obligatorio. Deshabilitar conserva la contraseña;
Eliminar borra Auth y mantiene una identidad retirada para autorías. La consulta
administrativa devuelve el correo de recuperación exclusivamente a administradores
con autenticación reciente. No se modifica la autoridad clínica ni CUDYR.
