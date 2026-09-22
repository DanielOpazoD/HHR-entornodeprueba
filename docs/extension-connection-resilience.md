# Conexión y recuperación Eloísa ↔ extensión ↔ HHR

## Alcance y evidencia del incidente

Revisión del 15 de septiembre de 2026 sobre `main` de GitLab `6c33b64c`.
La versión instalada observada en Chrome era 0.48.24. La primera corrección fue 0.48.25;
la validación real de una actualización con pestañas abiertas detectó todavía una desconexión y
la continuidad inicial se incorporó en 0.48.27. La versión 0.48.30 añade reactivación
idempotente del lector MAIN y verificación explícita del receptor después de reinyectarlo.

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
- **Actualización o recarga de extensión:** un relé huérfano no debe responder solicitudes nuevas ni publicar respuestas pendientes. La reparación se ejecuta al arrancar el worker, sin depender de que Chrome emita `runtime.onInstalled`; una marca de `storage.session` evita repetirla durante despertares normales. El relé reinyectado reclama la propiedad del mundo ISOLATED y deja inertes los listeners anteriores. El worker conserva la generación de la sesión y negocia con el lector MAIN mediante un protocolo estable independiente de la versión del paquete. Una actualización compatible mantiene conectadas las pestañas abiertas sin recargarlas ni duplicar interceptores.
- **Compatibilidad:** se conserva el protocolo de mensajes 5 y el protocolo MAIN 1. Los lectores legados 0.48.25 y 0.48.26 se admiten solamente durante la transición y siempre exigen la misma generación de sesión. Un cambio incompatible falla cerrado y requiere un documento nuevo. Una extensión compatible sin `health-push` necesita comprobación preventiva desde HHR.
- **Presupuesto previo a sincronizar:** HHR espera hasta 25 segundos, porque una renovación de Gestión de Camas puede requerir cuatro etapas de cinco segundos (sondeo, rechazo de la credencial anterior, recaptura y verificación). El diagnóstico pasivo conserva diez segundos y recuperación por latido. Varias pestañas que responden al sondeo pero fallan después todavía pueden superar ese presupuesto; se informa el fallo sin aceptar una sesión sin verificar.
- **Sesiones prolongadas:** una credencial sin fecha de expiración no equivale a una sesión perpetua. Gestión de Camas conserva verificación periódica y rechazos del servidor; Ficha Médico consulta su sesión oficial. Se respetan el cierre de sesión, la caducidad y la desconexión voluntaria.
- **Worker suspendido:** la generación y sesión temporal usan `chrome.storage.session`; las alarmas y los eventos de pestañas despiertan comprobaciones. Chrome borra ese almacenamiento al actualizar, por lo que el worker recupera la generación inmutable sólo cuando todos los lectores MAIN supervivientes que responden coinciden. Una pestaña sin marcador no participa; una pestaña cuyo MAIN no puede inspeccionarse hace fallar el consenso. HHR no entra en este consenso porque no conserva lector MAIN ni credenciales: su relé ISOLATED recibe la generación del worker al reinyectarse. Si los lectores discrepan o no sobrevive ninguno —como después de reiniciar el navegador— se crea una generación nueva. No se implementa un bucle para mantener Chrome despierto indefinidamente.

Chrome documenta que el worker puede finalizar por inactividad y que abrir un puerto no basta para mantenerlo vivo: [ciclo de vida MV3](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle). La recuperación se basa en mensajes acotados y estado recuperable, siguiendo el [contrato de mensajería](https://developer.chrome.com/docs/extensions/develop/concepts/messaging).

## Matriz de regresión

| Situación                                              | Resultado exigido                                                |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| Worker no responde al primer arranque                  | Fallo acotado; recuperación posterior sin recargar HHR           |
| Callback de contexto nunca llega                       | Expira; respuesta tardía no sustituye la tanda vigente           |
| Consulta de sesión colgada                             | Salud deja de estar lista; siguiente comprobación funciona       |
| Pestaña antigua activa y pestaña válida secundaria     | Se evita esperar una lectura completa en la antigua              |
| Sesión renovada en la pestaña de origen                | Se comprueba el token vigente, conservando identidad e intento   |
| Captura idéntica durante verificación                  | No se pierde una verificación válida por repetir la captura      |
| Desconexión voluntaria / intento anterior              | No se adopta silenciosamente una credencial ajena                |
| Extensión compatible sin push                          | Se refresca antes de vencer el estado de conexión                |
| Extensión compatible actualizada con pestañas abiertas | Reinyección automática; conserva conexión y sesión verificable   |
| Recarga de extensión descomprimida sin `onInstalled`   | El arranque del worker reinyecta una vez y recupera las pestañas |
| Lector con protocolo incompatible o generación ajena   | Falla cerrado; no entrega datos ni credenciales                  |
| Mensaje desde otro frame                               | No puede completar una solicitud del HHR principal               |
| Token vencido o respuesta 401                          | No se informa conexión vigente ni se reintenta una escritura     |
| Reinicio del worker / varias alarmas                   | Se conserva generación y orden de publicaciones                  |

## Validación y operación

### Comprobación en Chrome real · 22-09-2026

En `localhost:3001` conectado al proyecto de prueba `hhr-pruebas`, con Ficha Médico y Gestión de
Camas abiertas, la extensión 0.48.29 reprodujo el fallo: HHR mostró `Could not establish connection.
Receiving end does not exist` y deshabilitó **Sincronizar**; el panel de Ficha quedó en
**Comprobando…**. La versión cargada se verificó en `chrome://extensions`.

Se conservó 0.48.29 desactivada y se cargó 0.48.30 desde un checkout aislado, sin sobrescribir
su carpeta original. La pestaña HHR que ya estaba abierta pasó a **Conectada** sin recarga. El panel
de Ficha verificó extensión, Ficha Médico, Gestión de Camas y HHR conectados. Con dos pestañas de
Ficha y dos de Gestión de Camas, una de estas últimas redirigida al login, HHR siguió conectado a
la sesión autenticada. Tras **Volver a cargar** la extensión en Chrome, las páginas abiertas
continuaron conectadas; cerrar una Ficha dejó operativa la otra. Sin embargo, tras varios minutos
de inactividad HHR volvió a pedir pestañas nuevas. Ficha se recuperó al visitarla y Gestión de
Camas sólo al recibir foco; la continuidad inmediata de 0.48.30 no bastó. La versión 0.48.31
añade reparación bajo demanda del receptor de Camas, también cuando otro listener deja el canal
sin respuesta. El smoke MV3 elimina ese receptor con la pestaña en segundo plano y comprueba
su reinyección sin navegación. En Chrome real, 0.48.31 mantuvo ambas fuentes conectadas después
de varios minutos de reposo y un sondeo fresco desde HHR, sin enfocar Eloísa. La comprobación fue
de enlace y lectura de estado. La expiración real de credenciales y el reinicio completo de Chrome
requieren una comprobación separada.

Una sincronización real posterior en `hhr-pruebas` confirmó el límite de esa señal: la captura dual
terminó en 7,9 s, la propuesta tenía un ingreso y ningún conflicto, y el guardado estructural
terminó en 6,6 s. El historial registró el intento, pero la lectura clínica tardó 129,2 s y
finalizó con cobertura **0/10**: 43 solicitudes, 30 reintentos y 31 tiempos de espera. CUDYR,
dispositivos, escalas y signos vitales quedaron pendientes. HHR volvió a indicar **Conectada** tras
el intento, por lo que el estado del enlace no debe interpretarse como prueba de lectura clínica.
Esta regresión mantiene bloqueada la aceptación de 0.48.31 hasta identificar la causa de los
timeouts y repetir la sincronización clínica con cobertura y lectura posterior verificadas.

### Reproducción aislada del trayecto clínico · 22-09-2026

El smoke de Chromium ahora atraviesa el canal completo con datos sintéticos: página HHR → relé
ISOLATED → worker MV3 recargado → sesión verificada de Ficha Médico → lecturas de dispositivos,
historial y formularios → respuesta correlacionada en HHR. También comprueba dos pestañas de Ficha
con una sesión cerrada, caída HTTP 503 del backend con indicador de conexión todavía verde,
recuperación del backend, caducidad de ambas sesiones y renovación sin recargar páginas. No se
contactan servicios clínicos reales en esta prueba.

Se reprodujo además una carrera de tiempo de espera: el worker limita cada lectura del backend a
45 s y HHR limitaba el paquete completo a los mismos 45 s. Una sección que terminaba a los 46 s,
con las otras dos ya exitosas, llegaba después del límite de HHR; las tres se marcaban fallidas y
se reintentaban por separado. La prueba con reloj controlado falló con la configuración anterior.
HHR espera ahora hasta 55 s para recibir la respuesta agregada del worker y conservar las secciones
exitosas; sólo la fuente que realmente falló requiere reintento. Esto corrige la pérdida de
resultados parciales, pero no demuestra que haya sido la única causa de los 31 timeouts observados.

| Condición simulada                                 | Resultado observado                                                         |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| Actualización MV3 con HHR, Ficha y Camas abiertos  | Los documentos sobreviven; relés y lectura clínica responden                |
| Segunda Ficha con sesión caducada                  | La pestaña con sesión válida sigue proporcionando las tres fuentes          |
| Backend clínico HTTP 503 con sesión válida         | La conexión sigue verde, pero las tres fuentes informan error explícito     |
| Backend restaurado sin recargar pestañas           | Las tres fuentes vuelven a responder                                        |
| Todas las sesiones de Ficha caducadas              | Salud no disponible y ninguna lectura clínica se acepta                     |
| Sesión renovada                                    | Salud y lecturas clínicas se recuperan                                      |
| Una sección supera 45 s y las otras dos terminaron | HHR conserva las dos secciones exitosas al recibir el paquete antes de 55 s |

El simulador puede reproducir protocolos, respuestas y tiempos conocidos; no puede reproducir
exactamente el estado desconocido del servidor Eloísa ni la instalación real de Chrome durante el
intento fallido. Sigue pendiente una repetición clínica **sólo de lectura** en `hhr-pruebas` con las
pestañas reales para separar backend inaccesible, sesión inválida y corte del canal. No interpretar
una conexión verde ni el smoke sintético como cobertura clínica confirmada.

Ejecutar las pruebas afectadas en `src/tests/rayen-import`, `npm run check:rayen-extension-release`, `npm run test:e2e:rayen-extension-runtime` (Chromium aislado con datos sintéticos), `npm run check:extension-hotspots` y el gate previo al merge vigente del proyecto.

El smoke de Chromium mantiene documentos sintéticos de HHR, Ficha Médico y Gestión de Camas
abiertos, pulsa **Recargar** en `chrome://extensions`, verifica que ninguna página navegó y exige
que el nuevo worker recupere la generación MAIN anterior. Después consulta la salud y realiza una
lectura clínica completa desde el puente de página de HHR; los casos de sesión y backend descritos
arriba se ejecutan sobre las mismas pestañas sin acceder a Eloísa real.

Para aplicar una actualización local: comprobar la carpeta cargada en `chrome://extensions` y cargar
la versión correspondiente. Desde 0.48.30, una actualización compatible reinyecta sólo los relés
centrales, reactiva los listeners MAIN sin duplicar interceptores y comprueba que el receptor nuevo
responde antes de declararlo recuperado. Desde 0.48.31, Gestión de Camas también reintenta una
reinyección exacta cuando su receptor falta durante un sondeo posterior. Si el monitor informa un
protocolo realmente
incompatible, abrir un documento nuevo después de terminar o cancelar cualquier edición pendiente.
El marcador booleano de 0.48.27 no contiene la función necesaria para restaurar un listener MAIN
eliminado: en ese caso acotado la salud queda obsoleta y se requiere una sola recarga del documento.

La evidencia sintética no sustituye una sincronización real revisada por el operador. Comprobar por separado captura, propuesta, confirmación, persistencia y lectura posterior; no usar el indicador verde de conexión como prueba de que el censo se guardó.
