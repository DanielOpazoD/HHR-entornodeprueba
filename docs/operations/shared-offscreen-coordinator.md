# Documento oculto compartido de Eloísa

## Alcance

La extensión 0.48.20 centraliza el único documento offscreen que Chrome permite por perfil.
Se conserva `syslab-offscreen.html` y su iframe oficial de Syslab para no recrear la sesión al
pedir otra tarea. Excel, jsPDF y pdf-lib todavía permanecen en el service worker: su traslado
corresponde a PRs posteriores. No cambia el protocolo público HHR/extensión (versión 5), los
permisos, los orígenes autorizados ni la preferencia por una pestaña Syslab ya autenticada.

## Propietarios y protocolo privado

- `offscreen-contract.js`: versión, destino, ruta y límites compartidos.
- `offscreen-coordinator.js`: una instancia compuesta en `background.js` administra creación,
  descubrimiento, handshake, solicitudes y cierre. No crear documentos desde cada módulo.
- `offscreen-router.js`: canales internos definidos en la composición del documento. Solo
  acepta mensajes del worker de la misma extensión, no de pestañas/content scripts.
- `syslab-offscreen-transport.js`: correlación y limpieza del relay al iframe; verifica tanto
  ventana emisora como origen exacto. El bootstrap registra únicamente el canal `syslab`.

Cada solicitud tiene un UUID, versión y UUID de instancia del documento. Las respuestas deben
coincidir con los tres. El coordinador también invalida su generación al detectar un reemplazo.
Un módulo futuro registra su handler en el documento y usa
`offscreenCoordinator.request(canal, payload, { timeoutMs, signal })` desde el worker.
No añadir rutas de diagnóstico o de cierre al puente público de las páginas web.

## Ciclo de vida y fallos

- Creación/handshake compartidos entre peticiones concurrentes. Se adopta un documento propio
  existente; nunca se cierra un documento extranjero para hacer espacio.
- Sin cierre automático por inactividad: otra tarea no debe destruir la sesión Syslab.
- `close()` rechaza si hay peticiones admitidas; `close({force:true})` cancela las esperas e
  invalida la generación antes de cerrar. No se utiliza como reparación clínica automática.
- Máximo 32 solicitudes pendientes; plazos entre 250 ms y 601 s. El timeout del solicitante
  incluye la espera de creación. El handshake tiene 3 s de plazo.
- Si una API Chrome de ciclo de vida no resuelve, las solicitudes vencen sin enviar trabajo,
  pero se conserva la exclusión del ciclo de vida. No arrancar otra creación/cierre por fuera;
  corresponde recargar la extensión cuando ya no haya trabajo clínico activo.
- Timeout/cancelación elimina la espera y descarta respuestas tardías. No significa deshacer
  una navegación, login o consulta ya despachada al iframe. No se reenvía trabajo ambiguo.
- Al navegar el iframe se invalidan sus esperas antiguas. La recuperación de readiness continúa
  mediante las consultas de estado ya existentes en el transporte de sesión Syslab.
- Los diagnósticos contienen únicamente contadores/estado. No se persisten ni registran los
  payloads, contraseñas, nombres o respuestas clínicas del protocolo compartido.

## Validación

```sh
npx vitest run src/tests/rayen-import/offscreenCoordinatorExtension.test.ts \
  src/tests/rayen-import/offscreenRouterExtension.test.ts \
  src/tests/rayen-import/syslabOffscreenTransportExtension.test.ts \
  src/tests/rayen-import/syslabRuntimeExtension.test.ts \
  src/tests/rayen-import/syslabSessionTransportExtension.test.ts
npm run test:e2e:shared-offscreen
npm run check:rayen-extension-release
npm run check:extension-hotspots
npm run lint:extension
```

El smoke de Chromium se ejecuta como paso bloqueante de `e2e-critical` en CI. Usa una copia
transitoria del paquete y perfil efímero, un canal fixture que NO se incluye en producción,
HTTP interceptado y proxy cerrado para impedir tráfico al hospital. Comprueba APIs Chrome
reales, documento único, resultados inversos, cancelación/timeout/respuestas tardías,
conservación de sesión sintética, adopción por otro coordinador y cierre/recreación.
Adopción por otro coordinador en el mismo worker no equivale a forzar un reinicio del worker.
El smoke no valida la conectividad LAN, credenciales ni datos del Syslab real.

## Actualización del navegador clínico

Después de aprobar las pruebas y fusionar: sincronizar `main`, recargar la extensión
Descomprimida desde `chrome://extensions` y recargar HHR/Eloísa. Confirmar versión 0.48.20.
Recargar la extensión cierra contextos efímeros y puede requerir reconectar Syslab; hacerlo sin
operaciones clínicas activas. No borrar `chrome.storage` ni respaldos para actualizar.

La validación hospitalaria pendiente requiere la red de `10.4.69.90`: verificar acceso al portal,
preferencia por sesión visible, estado de la sesión interna y conservación tras tareas de otro
canal. No generar escrituras clínicas ni exportar información de pacientes para probar el
coordinador. Registrar por separado qué se comprobó realmente y qué se cubrió con fixtures.
