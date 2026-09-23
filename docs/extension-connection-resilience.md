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

### Seguimiento de la recarga con pestañas abiertas · 22–23-09-2026

Una sincronización real posterior en `hhr-pruebas` completó la lectura clínica de 10/10 pacientes
en 38 s. Esto refutó que la regresión de 0/10 fuese permanente, pero no acreditó la recuperación
tras recargar la extensión. Una recarga posterior dejó a HHR sin respuesta y el centro de Ficha
Médico en «Comprobando…». La página interna de la propia extensión tampoco pudo enviar una
petición mínima al worker (`Receiving end does not exist`); por tanto el fallo no provenía sólo
de una pestaña clínica antigua. Chrome mostraba la extensión habilitada, pero su worker inactivo.

La reparación de esta rama verifica los receptores reales incluso cuando `storage.session` ya
indica la misma versión, no deja que una comprobación de arranque absorba el evento de instalación,
y reinyecta las interfaces de Ficha Médico y Gestión de Camas junto con sus relés. Además, al
activar una pestaña conocida comprueba su receptor y repara sólo esa pestaña si el arranque
anterior no pudo hacerlo. La reinyección de Camas sólo se declara completa cuando responden tanto
el relé como su indicador visual; Ficha exige la misma verificación para su panel. No mantiene el
worker despierto mediante sondeos periódicos. Syslab se comprueba con su mensaje de estado
existente en cada marco elegible y se reinyecta si alguno perdió el receptor; esto se cubre con una prueba sintética, no con
una sesión real de Syslab. Ficha Médico
desmonta y reconstruye su barra al reinyectarse, salvo que haya un formulario clínico con ediciones
o escrituras pendientes. Si una generación anterior dejó un modal abierto sin runtime accesible,
la reinyección espera a que se cierre para no sustituir posibles datos sin guardar y reconstruye
el panel automáticamente después. El script
previo a esta reparación no tenía desmontaje seguro: una única recarga de esa pestaña, una vez
instalada esta versión, permite adoptar el nuevo ciclo de vida.
La política de manifest, la comprobación de receptores y la sesión de reinyección tienen módulos
separados; el transporte de Ficha y la presentación de estados de conexión se extrajeron para
mantener los límites de tamaño de los archivos existentes. La línea base de hotspots incorpora
sólo esos módulos nuevos y reduce los límites de los archivos originales.

En la instalación observada, desactivar y volver a activar la extensión restableció el worker;
después, una nueva recarga con HHR, Ficha Médico y Gestión de Camas abiertos mantuvo las tres
superficies conectadas sin volver a cargar sus páginas. Esta evidencia valida la reinyección
cuando Chrome conserva o vuelve a registrar el worker. **No demuestra** que la extensión pueda
repararse por sí misma si Chrome deja de registrar el worker: ningún content script puede recibir
respuestas del background en ese estado. Se debe distinguir este fallo del relé huérfano en el
diagnóstico y no presentar el badge visible como prueba suficiente de conexión.

En Chrome se provocó también un panel huérfano de Ficha sin recargar la página. Al activar la
pestaña, la comprobación dirigida reconstruyó el panel y volvió a mostrar la conexión. Otra
prueba provocó un indicador huérfano de Camas: la activación lo reconstruyó sin perder la
conexión con HHR ni Ficha. Al desactivar y reactivar la extensión con HHR, Ficha y Camas
abiertos, las tres superficies
volvieron a mostrar conexión sin refrescar sus páginas. Son pruebas de la instancia local
0.48.31 con los cambios de esta rama, no de versiones antiguas ni de un vencimiento de sesión
Rayen ocurrido realmente.

Una recarga adicional dejó abierto el modal de conexiones de Ficha. Al cerrarlo, apareció de
nuevo el botón del Centro HHR; el panel reconstruido verificó Extensión, Ficha, Camas y HHR
conectados. Camas y HHR conservaron sus indicadores sin refrescar las páginas. Esta prueba
cubre la recuperación del modal huérfano en la sesión observada, sin afirmar que se haya probado
un formulario clínico con datos sin guardar.

La repetición de sincronización posterior quedó registrada en el historial del 22-09: un egreso,
cobertura clínica 9/9 completa, 0 reintentos y 0 timeouts en 1 min 3 s. El tiempo incluye 27,3 s
de revisión humana; la captura dual tardó 4,9 s y las lecturas clínicas 3,9 s. La prueba confirma
lectura, guardado e historial de esa ejecución en `hhr-pruebas`; no cubre por sí sola expiración
real de una sesión ni un reinicio completo del navegador. El centro de conexiones ahora termina
su estado «Comprobando…» con un error recuperable si falla la mensajería con el worker.

### Restauración del navegador e inactividad repetida · 23-09-2026

Con el `main` de GitHub en `localhost:3001`, la extensión 0.48.31 cargada desde la carpeta local
y las pestañas reales de HHR, Ficha Médico y Gestión de Camas abiertas, se cerró Chrome por
completo y se abrió de nuevo el mismo perfil. Tras restaurar la ventana, Chrome registró el
worker sin desactivar ni reactivar la extensión: HHR indicó **Conectada**, Ficha mostró su
conexión y Camas mostró **Conectado**. Esta observación cubre **un** reinicio completo; no prueba
que Chrome registre siempre el worker. Si el proceso del navegador no registra el worker, los
scripts de la extensión no pueden recibir eventos ni repararlo desde dentro. Distinguir ese caso
de un worker **inactivo** normal en `chrome://extensions`: este último despierta al recibir un
evento o mensaje. El popup de 0.48.32 envía una petición mínima al worker: si no obtiene una
respuesta de la versión cargada, muestra cómo recargar la extensión en Chrome y, si persiste,
desactivarla y activarla. Una etiqueta de versión sola ya no se presenta como prueba de conexión.
El popup 0.48.32 se comprobó en Chrome real tras recargar esa misma carpeta: indicó **Worker
operativo** y HHR volvió a mostrar **Conectada** sin refrescar la página.

En un segundo cierre y arranque completos con 0.48.32, el popup volvió a responder, pero el
Centro HHR informó **sesión vencida** para Ficha Médico y **sin token** para Gestión de Camas.
Esto distingue un worker disponible de credenciales utilizables: después de cerrar Chrome,
`chrome.storage.session` pierde el token temporal de Camas por diseño y Ficha debe superar de
nuevo la verificación de su sesión oficial. Ver datos que la página dejó en memoria no acredita
esa verificación. No se considera recuperada la sincronización hasta que ambas fuentes vuelvan a
estar autenticadas. La renovación real posterior a ese segundo reinicio aún no se verificó.

La versión 0.48.32 añade un listener `runtime.onStartup` registrado al cargar el worker. El
primer barrido de pestañas puede ocurrir antes de que Chrome restaure sus documentos; por eso
`tabs.onUpdated` comprueba al terminar la carga sólo las páginas de HHR, Ficha Médico y Gestión de
Camas y repara un receptor ausente. La activación y la finalización de carga de una misma pestaña
comparten una comprobación en curso, para evitar dos reinyecciones. Una página que ya responde no
se reinyecta. No se modificó el flujo de Syslab.

La pausa prolongada con carga simultánea reveló una condición más estrecha: el relé ISOLATED y
la interfaz de Ficha respondían, pero el lector MAIN ya no contestaba. La verificación de Ficha
incluye ahora un ping al lector MAIN, independiente de la sesión clínica. El ping reancla
el listener existente si Chrome lo dejó sin registrar. Si falta el lector, reinyecta esa
pestaña y comprueba el ping otra vez antes de declararla reparada. Si el lector retenido no
puede demostrar compatibilidad, detiene la reparación automática y ofrece abrir una conexión
limpia en otra pestaña. La ausencia total de respuesta del propio ping se trata como un probe
faltante y permite reinstalarlo al activar la pestaña. Una sesión
realmente vencida sigue siendo un estado de autenticación, no un motivo para reinyectar.
El listener del ping se instala por separado: una pestaña con el lector compatible de 0.48.31
puede conservar su captura y adquirir esta comprobación al actualizar la extensión, sin recarga
ni duplicar el lector original. En ese caso, la primera comprobación pide al lector retenido una
respuesta de estado con su propio protocolo y generación; sólo entonces guarda el resultado
para los pings siguientes. Esto se exige también al lector de la versión actual. Un lector
incompatible o sin respuesta no queda certificado por los metadatos del ping nuevo.
El smoke simula ambos lados: adopta un lector compatible sin recargarlo, restaura un probe
ausente y rechaza un lector retenido que responde con protocolo incompatible.
En este último caso la verificación evita reinyecciones automáticas repetidas sobre el mismo
lector antiguo; el centro de conexiones ofrece **Abrir conexión limpia**, que abre documentos
nuevos sin cerrar la pestaña clínica anterior ni descartar ediciones pendientes.

El smoke aislado fuerza dos terminaciones del worker MV3 con las tres páginas abiertas. Después de
cada pausa reactiva Ficha Médico, Gestión de Camas y HHR, y comprueba la nueva respuesta del worker,
la salud de las tres fuentes, el puente de HHR, la ausencia de controles duplicados y que ningún
documento se recargó. Antes del segundo despertar elimina a propósito el listener MAIN de Ficha
para comprobar la reparación aunque el relé exterior siga vivo. Antes de terminarlo, verifica
además una lectura clínica sintética completa y la
caducidad/renovación simulada de Ficha Médico. Para reproducir una pausa real entre los dos ciclos
en local, ejecutar `HHR_EXTENSION_IDLE_WAIT_MS=180000 npm run test:e2e:rayen-extension-runtime`;
el valor por defecto no retrasa CI. El reingreso después de tres minutos no equivale a una caducidad
real de servidor: esta última sigue pendiente de observación en Eloísa cuando ocurra de forma
natural. Playwright mantiene una referencia obsoleta al objeto `Worker` después de una terminación
CDP en la versión fijada del proyecto; por ello los ciclos de reanudación verifican respuestas por
el canal real de extensión y no evalúan código mediante ese objeto obsoleto.

### Autorreparación de un relé huérfano durante la sesión

Un relé puede quedar huérfano después del barrido inicial sin que Chrome vuelva a activar o
cargar su pestaña. Cuando un diagnóstico periódico identifica específicamente
`relay_disconnected`, el worker ahora verifica y repara únicamente la fuente afectada
(Ficha Médico, Gestión de Camas o HHR) en la pestaña existente. Las reparaciones simultáneas
de una misma fuente se agrupan. Si el estado posterior aún no confirma la recuperación,
el siguiente intento espera 30 segundos; un nuevo fallo tras un estado sano se atiende de inmediato.
En cada despertar o actualización del worker, HHR se verifica primero y las otras fuentes
se comprueban en paralelo: una Ficha lenta ya no retiene la recuperación del censo.
Si una actualización reparó HHR pero otra pestaña falló, el siguiente despertar verifica y
reintenta sólo la pestaña fallida; no vuelve a reinyectar todas las pestañas sanas.
Una inyección comprobada publica un nuevo estado; no se abren pestañas ni se repite una
sincronización clínica. `session_expired`, `outdated_tab` y `tab_missing` no se reinterpretan
como relés ausentes: conservan sus acciones de autenticación o revisión. El comportamiento
queda cubierto por pruebas de selección de fuente, concurrencia, espera y reinyección
verificada. La observación en Chrome sigue siendo necesaria para confirmar el entorno real.

### Actualización entre paquetes con pestañas abiertas · prueba automatizada

`npm run test:e2e:rayen-extension-upgrade` instala en Chromium aislado el paquete publicado en
el commit `a6704bcb` (0.48.32), abre HHR, Ficha Médico y Gestión de Camas con respuestas
sintéticas y sustituye **el mismo directorio descomprimido** por el paquete actual (0.48.33).
Después usa el control de recarga de `chrome://extensions`, tal como se actualizaría una
extensión local, sin refrescar los tres documentos. Exige respuesta de los tres relés, misma
generación compatible, un solo panel de Ficha y una lectura clínica sintética desde HHR.
La prueba deja abierto **Conexiones y sesión** durante la actualización: comprueba que el
panel huérfano se retira, que la barra nueva reclama la interfaz y que al abrirla de nuevo
puede consultar el worker. El ping de Ficha identifica la versión del código de interfaz
capturada al inyectarse; una interfaz anterior no queda validada sólo porque su relé responda.
Los formularios clínicos con datos sin guardar permanecen protegidos.
El test se ejecuta en el gate `e2e-critical`; CI obtiene el commit anterior fijado antes de
preparar el paquete de prueba. Una versión futura debe actualizar explícitamente ese commit y
la versión esperada para seguir probando el salto desde su predecesora real.

La prueba no usa credenciales ni endpoints clínicos reales y no sustituye la comprobación de
sesiones vencidas en Eloísa. La prueba de recarga del mismo paquete y reactivación después de
inactividad sigue en `test:e2e:rayen-extension-runtime`.
