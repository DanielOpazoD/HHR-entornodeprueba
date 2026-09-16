# Conexión y recuperación Eloísa ↔ extensión ↔ HHR

## Alcance y evidencia del incidente

Revisión del 15 de septiembre de 2026 sobre `main` de GitLab `6c33b64c`.
La versión instalada observada en Chrome era 0.48.24. La corrección fuente es 0.48.25.

Los dos HAR se analizaron localmente, sin incorporarlos al repositorio:

| Captura        | Solicitudes | Resultado HTTP | Intervalo UTC                      |
| -------------- | ----------: | -------------- | ---------------------------------- |
| Primer archivo |          59 | Todas 200      | 16-09 00:01:20–00:01:44            |
| Archivo 2.0    |         123 | Todas 200      | Primera ráfaga y 00:22:08–00:22:39 |

La primera ráfaga del archivo 2.0 coincide con la captura anterior; no es una tercera observación independiente. La solicitud más lenta registrada tarda aproximadamente 4,36 segundos. Las lecturas clínicas devuelven listas JSON y ambos informes de egresos responden como Excel. Un HTTP 200 acredita una respuesta de red, no el éxito de la reconciliación ni la persistencia en HHR.

Chrome registra `Extension context invalidated` en el relé de reparación de HHR y otros contextos, además del rechazo de una captura de un intento anterior de Gestión de Camas. Estos errores sí demuestran problemas del enlace; los HAR no contienen mensajes `chrome.runtime`, `window.postMessage`, comprobaciones same-origin de sesión ni el resultado de persistencia de HHR. No permiten asignar cada intento fallido a un único error ni probar que todos los datos del último intento convergieron.

## Recorrido y autoridades

1. HHR solicita salud y comprueba protocolo, capacidades, vigencia y disponibilidad de ambas fuentes.
2. El relé ISOLATED envía una petición correlacionada al worker MV3. El lector MAIN de Eloísa conserva el acceso a su sesión; versión y generación deben coincidir.
3. Ficha Médico entrega la captura clínica; Gestión de Camas entrega el informe de egresos. Se exige misma institución, captura completa, intervalo permitido y desfase acotado.
4. HHR construye la propuesta. La confirmación humana y el proceso de persistencia/readback siguen siendo etapas independientes de la conexión.
5. Una pérdida del worker o un timeout no autoriza repetir escrituras clínicas. Las recuperaciones descritas aquí afectan al enlace y las lecturas.

## Política de recuperación

- **Arranque fallido del relé:** tres intentos acotados y una pausa antes de permitir otra tanda. Las llamadas concurrentes comparten el intento. Un resultado nulo no se memoriza para toda la vida de la pestaña; un contexto válido sí se conserva para no adoptar una generación ajena.
- **Consulta de sesión atascada:** la lectura same-origin de Ficha Médico limita a tres segundos la espera de cabeceras y cuerpo. Aborta cuando es posible y libera la consulta compartida; la siguiente comprobación puede recuperarse. Una respuesta tardía no modifica la identidad verificada.
- **Varias pestañas:** la actividad visual no acredita que una pestaña pueda responder. Se comprueban candidatos antes de la lectura completa. Las operaciones vinculadas a un emisor conservan su identidad; no se trasladan escrituras a otra sesión.
- **Actualización de extensión:** un relé huérfano no debe responder solicitudes nuevas ni publicar respuestas pendientes. Los lectores MAIN de una generación anterior continúan bloqueados: la recuperación abre documentos nuevos sin recargar ni cerrar formularios existentes.
- **Compatibilidad:** se conserva el protocolo 5. Una extensión compatible sin `health-push` necesita comprobación preventiva desde HHR. Protocolos insuficientes o capacidades necesarias ausentes siguen requiriendo actualización.
- **Presupuesto previo a sincronizar:** HHR espera hasta 25 segundos, porque una renovación de Gestión de Camas puede requerir cuatro etapas de cinco segundos (sondeo, rechazo de la credencial anterior, recaptura y verificación). El diagnóstico pasivo conserva diez segundos y recuperación por latido. Varias pestañas que responden al sondeo pero fallan después todavía pueden superar ese presupuesto; se informa el fallo sin aceptar una sesión sin verificar.
- **Sesiones prolongadas:** una credencial sin fecha de expiración no equivale a una sesión perpetua. Gestión de Camas conserva verificación periódica y rechazos del servidor; Ficha Médico consulta su sesión oficial. Se respetan el cierre de sesión, la caducidad y la desconexión voluntaria.
- **Worker suspendido:** la generación y sesión temporal usan `chrome.storage.session`; las alarmas y los eventos de pestañas despiertan comprobaciones. No se implementa un bucle para mantener Chrome despierto indefinidamente.

Chrome documenta que el worker puede finalizar por inactividad y que abrir un puerto no basta para mantenerlo vivo: [ciclo de vida MV3](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle). La recuperación se basa en mensajes acotados y estado recuperable, siguiendo el [contrato de mensajería](https://developer.chrome.com/docs/extensions/develop/concepts/messaging).

## Matriz de regresión

| Situación                                          | Resultado exigido                                              |
| -------------------------------------------------- | -------------------------------------------------------------- |
| Worker no responde al primer arranque              | Fallo acotado; recuperación posterior sin recargar HHR         |
| Callback de contexto nunca llega                   | Expira; respuesta tardía no sustituye la tanda vigente         |
| Consulta de sesión colgada                         | Salud deja de estar lista; siguiente comprobación funciona     |
| Pestaña antigua activa y pestaña válida secundaria | Se evita esperar una lectura completa en la antigua            |
| Sesión renovada en la pestaña de origen            | Se comprueba el token vigente, conservando identidad e intento |
| Captura idéntica durante verificación              | No se pierde una verificación válida por repetir la captura    |
| Desconexión voluntaria / intento anterior          | No se adopta silenciosamente una credencial ajena              |
| Extensión compatible sin push                      | Se refresca antes de vencer el estado de conexión              |
| Extensión actualizada con relés huérfanos          | Sólo el contexto vigente puede publicar respuestas             |
| Mensaje desde otro frame                           | No puede completar una solicitud del HHR principal             |
| Token vencido o respuesta 401                      | No se informa conexión vigente ni se reintenta una escritura   |
| Reinicio del worker / varias alarmas               | Se conserva generación y orden de publicaciones                |

## Validación y operación

Ejecutar las pruebas afectadas en `src/tests/rayen-import`, `npm run check:rayen-extension-release`, `npm run test:e2e:rayen-extension-runtime` (Chromium aislado con datos sintéticos), `npm run check:extension-hotspots` y el gate previo al merge vigente del proyecto.

Para aplicar una actualización local: comprobar la carpeta cargada en `chrome://extensions`, cargar la versión correspondiente y usar documentos nuevos de Eloísa si se indica que los anteriores pertenecen a otra generación. Las versiones anteriores a esta corrección pueden mantener sus listeners huérfanos hasta recargar HHR; el código nuevo no puede reescribir un contexto que Chrome ya invalidó. Esa recarga inicial debe realizarse después de terminar o cancelar cualquier edición pendiente.

La evidencia sintética no sustituye una sincronización real revisada por el operador. Comprobar por separado captura, propuesta, confirmación, persistencia y lectura posterior; no usar el indicador verde de conexión como prueba de que el censo se guardó.
