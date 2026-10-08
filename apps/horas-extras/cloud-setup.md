# Servicio independiente de Horas Extras

El frontend compacto funciona con la misma plantilla institucional. En modo nube,
las lecturas, claves y turnos pasan por `server/api.mjs`; Firestore es la autoridad.
No se utiliza el proyecto ni las identidades clínicas de HHR.

## Destino

- Proyecto Firebase independiente: `hhr-horas-extras`.
- Firestore Standard, base predeterminada, región `southamerica-west1`.
- Sitio Netlify independiente: `hhr-horas-extras`.
- Configuración del sitio en esta carpeta. En monorepo, seleccionar esta carpeta
  como base; publicar `dist/client`, Functions en `netlify/functions`.
- `VITE_OVERTIME_MODE=cloud` al construir. Sin esta variable se mantiene la demo
  ficticia en memoria; nunca se cambia a demo automáticamente si falla la API.
- Las vistas usan estado local sobre `/`. No añadir una reescritura SPA global:
  interceptaría las rutas personalizadas `/api/overtime/*` antes de la función.

## Configuración del servidor

Variables de alcance Functions, configuradas fuera del repositorio:

- `OVERTIME_FIREBASE_PROJECT_ID`: proyecto independiente.
- `OVERTIME_FIREBASE_SERVICE_ACCOUNT`: JSON de una cuenta de servicio con rol
  `roles/datastore.user` exclusivamente en ese proyecto.
- `OVERTIME_APP_ORIGIN`: origen HTTPS exacto del sitio publicado, sin barra final.

No usar prefijos `VITE_` para credenciales. Al cambiar el dominio, actualizar el
origen autorizado y volver a desplegar. Las vistas previas no deben usar la base
productiva; un origen distinto no puede iniciar sesión ni escribir.

Aplicar `cloud.firebase.json` exclusivamente al proyecto independiente. Sus reglas
rechazan acceso directo desde navegadores; el servidor verifica cada sesión y rol.
No aplicar este archivo a un proyecto HHR existente.

## Cuentas y acceso

Crear cuentas con `scripts/provision-people.mjs`, pasando un archivo privado JSON y
el ID exacto del proyecto como segundo argumento. El archivo es una lista con
`rut`, `name`, `group` (`TENS`, `Enfermería` o `Médico`) y `adminRole` opcional. No incluirlo en
Git. La creación rechaza duplicados y nunca reemplaza claves ni turnos existentes.
No hay registro público ni asignación de roles desde el navegador.
La profesión no concede permisos: un ADMIN puede ser Médico o Enfermería, y
conserva sus horas y Excel propios. Los archivos del equipo filtran exclusivamente
TENS y Enfermería; el Excel personal de un médico indica MÉDICO.

La primera clave es el RUT sin DV. Se almacena con scrypt y sal aleatoria. El servidor
obliga a cambiarla antes de consultar o registrar horas. Una clave de un carácter
es válida; el límite técnico de 4096 caracteres protege el tamaño de las solicitudes.
Cambiar la clave revoca las demás sesiones. Cookie HttpOnly, Secure, SameSite=Strict,
12 horas; sesión y límites de intentos persistidos en Firestore. No se guardan claves
ni tokens en localStorage. Habilitar TTL sobre `expiresAt` en `overtime_sessions` y
`overtime_limits` es limpieza opcional; la expiración se comprueba aunque TTL no exista.

Decisión de producto confirmada por Daniel el 8 de octubre de 2026: mantener la clave
inicial derivada del RUT y el cambio obligatorio al primer ingreso. Se informó que
conocer el RUT permite adelantarse al titular antes de ese cambio. Este riesgo
residual está aceptado para este flujo; los límites de intentos y el hash no lo
eliminan. No se requiere enlace de activación ni clave inicial aleatoria.

## Datos y consistencia

Cada documento `overtime_people` contiene perfil, hash de clave, versión de sesión,
revisión y turnos propios. Hasta 1500 turnos por cuenta y límite conservador de 500 kB serializados
(comprobado antes de escribir), con calendario 2026/2027.
La API solo devuelve campos públicos y los turnos del mes solicitado. Un trabajador
no puede pedir el equipo ni modificar un propietario enviado por el cliente.
ADMIN puede consultar todos los grupos y registrar únicamente sus propias horas.

Guardado/eliminación transaccionales, cálculo canónico del servidor, solapamientos
comprobados sobre todos los meses de la cuenta. Una revisión desactualizada devuelve
conflicto y refresca los registros conservando el formulario; no sobrescribe otra sesión.
La confirmación visual aparece únicamente tras la respuesta exitosa del servidor.
Las descargas vuelven a leer el mes desde la API para incorporar los últimos cambios.

El Excel personal y los archivos TENS/Enfermería comparten `buildWorkbook`: plantilla,
columna nocturna, totales, firmas y hoja inicial sin registros. En nube el nombre del
archivo no lleva el sufijo DEMO.

## Pruebas

- `npm test`: reglas de turnos, Excel, claves y API (sesiones, acceso, CSRF, conflictos).
- `npm run test:firestore`: requiere emulador local `demo-overtime`; prueba persistencia
  y transacciones reales del SDK, sin escribir datos productivos.
- `firebase.emulator.json` configura el puerto local 8187. Usar el proyecto
  `demo-overtime` y `FIRESTORE_EMULATOR_HOST` apuntando a ese emulador.
- `scripts/local-cloud.mjs` sirve una API local de prueba, restringida explícitamente
  al emulador y cuentas ficticias. Vite utiliza su proxy únicamente con
  `OVERTIME_LOCAL_EMULATOR=true`; el modo visual local es `VITE_OVERTIME_MODE=emulator`.

Referencias: [transacciones de Firestore](https://firebase.google.com/docs/firestore/manage-data/transactions)
y [API de Netlify Functions](https://docs.netlify.com/build/functions/api/).
