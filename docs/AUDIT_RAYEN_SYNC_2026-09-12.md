# Auditoría crítica de sincronización Eloísa: captura del 12 de septiembre

## Alcance y límites

Base: `main@b2288e4f` (PR #412). Evidencia: `sincronizacion con conflicto 12-09.har`, `13 sept har busqueda RN por rut de progenitor.har` y `HAR GESTION DE CAMAS RN BUSQUEDA POR RUT PROGENITOR.har`, leídos localmente sin copiarlos al repositorio. Se usaron las pestañas ya abiertas del navegador y no se lanzó otro Chromium. Los identificadores clínicos se mantuvieron fuera del repositorio.

La primera captura comprende 46 entradas, del 13-09-2026 00:41:52.703Z al 00:42:25.236Z, relativas al censo clínico del 12-09. Contiene tráfico de HHR/Firestore/callables, **no las consultas de las pestañas fuente de Rayen**. Las capturas adicionales sí demuestran que Rayen usa el tipo de identificador 4, «RUN Materno/progenitor(a)», para encontrar un episodio neonatal por el RUN del progenitor.

## Lo demostrado por el HAR

- No hay fallos HTTP en las solicitudes capturadas. Esto no demuestra que la sincronización funcional haya terminado bien.
- El registro del día consultado tiene 12 ocupantes, 0 altas y 0 traslados.
- Cuatro ejecuciones anteriores incluidas en ese registro terminaron `partial`: lectura clínica 12/12, sin errores de lectura, pero un conflicto estructural `unverified-report-row` repetido y 0 egresos aplicados.
- La ejecución capturada repite el resultado: el cierre persistido es `partial`, 12/12 lecturas y el mismo conflicto estructural. Un estado intermedio `applied` no debe confundirse con el resultado final.
- La extensión se identifica como 0.48.20, protocolo 5; ambas fuentes declaran `ready` en esas ejecuciones. Por tanto, no corresponde atribuir este HAR a una desconexión comprobada.
- El backend aceptó enriquecimiento histórico como idempotente y enriquecimiento actual con una escritura clínica. «No sincronizó todo» es correcto; «no guardó nada» no lo es.
- Las reconciliaciones canónicas se registran como degradadas con contexto vacío. No hay evidencia suficiente para atribuirles una pérdida de datos.

## Hallazgos de código

### 1. No existía comparación incondicional con D-1 (alta prioridad)

`hooks/replanRayenStructure.ts` planificaba contra el registro actual. `domain/previousDayCorrections.ts` derivaba los días a leer de correcciones ya descubiertas. Si un paciente solo aparecía ayer y ya no estaba hoy ni en el informe de egresos, no se descubría ninguna corrección y no se consultaba ayer para buscarlo.

Regresión reproducida: censo previo con episodio, censo actual y Ficha vacíos, informe de altas vacío. La versión base omitía tanto la lectura D-1 como el conflicto. Esto es una brecha demostrada independientemente del conflicto específico del HAR.

**Cambio de esta rama:** lectura autoritativa de D-1 y revisión por episodio de continuidad/egreso registrado o propuesto. Una ausencia inexplicada genera un conflicto global explícito; no inventa un alta, un ingreso ni una cama. No usa la cama de ayer para aislar el conflicto, porque hoy puede pertenecer a otra persona. Incluye cunas y protege la identidad frente a reingresos, movimientos eliminados y RUN compartidos. La identidad legacy solo admite enlace inequívoco con RUN, nombre, fecha/hora de ingreso y ámbito cama/cuna.

**Límite:** detectar y bloquear una omisión no equivale a recuperar automáticamente el alta faltante.

### 2. La búsqueda neonatal usaba el tipo de identificador equivocado (corregido y demostrado)

Rayen distingue RUN del paciente (tipo 2) de RUN materno/progenitor(a) (tipo 4). La extensión consultaba únicamente tipo 2. En un recién nacido identificado mediante el RUN del progenitor, la fila de egreso aparecía en el informe, pero la comprobación individual no encontraba su episodio y conservaba correctamente `unverified-report-row`.

La consulta de Gestión de Camas ahora revisa ambos tipos antes de decidir, deduplica por episodio, exige coincidencia exacta si ya conoce el episodio y conserva la ambigüedad cuando madre y recién nacido comparten RUN y fecha. Un fallo en cualquiera de las consultas no se interpreta como una lista vacía completa. La búsqueda de informes/epicrisis de Ficha aplica la misma recuperación tipo 2 + tipo 4 cuando el episodio no aparece en la búsqueda normal.

No se eliminó ni se silenció `unverified-report-row`: se corrigió su causa. En la prueba integrada, el episodio neonatal exacto se resolvió mediante tipo 4, la fila pasó a egreso confirmado y el cierre remoto registró 1 egreso, 1 actualización y 0 conflictos. No quedaron movimientos activos duplicados.

### 3. Salud transitoria convertida en incompatibilidad permanente (corregido localmente)

`hooks/rayenSnapshotEvidenceClient.ts` conservaba durante toda la ejecución una promesa de salud aunque devolviera `report: null`. Luego concluía «la extensión no admite» trazabilidad/egreso individual, sin comprobar realmente sus capacidades.

Ahora usa el presupuesto de sincronización **ya existente**, deduplica comprobaciones simultáneas, permite un reintento acotado y solo reutiliza informes válidos. Si sigue sin poder verificarse, informa un problema transitorio y no realiza lecturas de pacientes con capacidades no comprobadas. No se modificaron límites de bundle ni presupuestos de rendimiento.

### 4. Reinyección duplicaba relés (corregido localmente)

`content-hhr.js`, `content-fichamedico.js` y `content-gestioncamas.js` registraban nuevamente escuchas en una segunda ejecución en el mismo mundo aislado. Pruebas VM reprodujeron duplicación de escuchas/solicitudes antes del cambio. Las guardas ahora son propias del contexto/runtime, no marcadores persistentes que impidan recuperarse tras actualizar la extensión.

### 5. Cierre de la propia fuente requerida (corregido localmente)

`extension/gestion-camas-runtime.js` abría una ventana con `closeOnVerify: true`; `gestion-camas-health.js` exigía una pestaña viva antes de considerar la sesión almacenada. El acceso correcto podía cerrar la única pestaña que la sincronización necesitaba.

La ventana nueva se mantiene abierta, igual que una pestaña reutilizada. No se debilitan los controles de generación, vigencia, expiración ni respuesta real. La documentación anterior que prometía sincronizar con Gestión de Camas cerrada se corrigió. Consecuencia visible: la ventana oficial queda abierta mientras se utiliza como fuente.

### 6. Estabilidad y persistencia de la conexión (corregido)

Cuatro causas concretas hacían que la conexión se perdiera con facilidad aparente:

1. **Sondeo en serie.** `health-check.js` recorría las pestañas una por una y cada ping tenía su propio presupuesto de 5 s. Con varias pestañas de Ficha o de Gestión de Camas abiertas, una sola lenta o colgada agotaba la comprobación completa. Ahora se sondean **todas a la vez** y gana la primera lista por preferencia: **una pestaña sana de cada fuente basta**, y la espera total es un único tiempo de espera en vez de uno por pestaña.
2. **Presupuesto pasivo más corto que el sondeo.** HHR pedía el diagnóstico con 2,5 s mientras la extensión necesitaba hasta 5 s por fuente. Una respuesta normal se leía como «desconectado». El presupuesto pasivo pasa a 10 s, muy por debajo del de sincronización.
3. **Un sondeo perdido se mostraba como corte.** `absorbTransientHealthFailure` conserva el último diagnóstico bueno mientras siga **dentro del arriendo ya existente** de 150 s. No prolonga credenciales ni inventa salud: un reporte que sí llega manda siempre, y el corte real lo sigue declarando el vencimiento del arriendo.
4. **Recuperación sólo manual.** Antes sólo se reintentaba al enfocar la pestaña. Ahora la página reintenta sola con espera creciente (3 s, 6 s, 12 s… hasta 30 s) y se detiene al recuperar.

Comprobado en vivo con la extensión 0.48.22: con dos pestañas de cada fuente el diagnóstico tardó 106 ms; al dejar una sola de cada una siguió `ready` adoptando la superviviente; sin ninguna pestaña de Gestión de Camas reportó honestamente `missing`/`tab_missing` sin inventar conexión; al reabrirla se recuperó sola en ~2 s; y tras 45 s de inactividad total, con el worker dormido, respondió en 165 ms con ambas fuentes listas.

**Límite:** sigue exigiéndose al menos una pestaña viva por fuente. Es deliberado: un token guardado sin página que lo respalde no es prueba de sesión vigente.

- `fileCrossDayCorrections` toma la identidad del egreso de la cama del registro actual y puede omitir una entrada con cama vacía. Falta resolver/validar la identidad contra el registro histórico de destino y comprobar su resultado de forma explícita. Es un riesgo de la ruta de escritura, no una causa probada del HAR. La confirmación normal usa la base previa al guardado, de modo que no basta con afirmar que todo egreso vacía la cama antes de leerla.
- Días firmados, fuera de ventana y conflictos de versión deben conservar controles y revisión. No se propone saltarlos para completar egresos.
- Las consultas de identidad de Ficha deduplican concurrencia pero no todas las ráfagas de foco/visibilidad. Cualquier optimización necesita invalidación real al cerrar sesión; no basta con alargar una caché.

## Mecanismos activos que ya existen

Alarmas periódicas, comprobación de relés y generación, reintentos de enlace al despertar el worker, coordinador offscreen recuperable y verificación de expiración de sesión. No hay evidencia en este HAR de que el coordinador offscreen sea la causa. Mantener una conexión activa no debe significar prolongar credenciales vencidas ni declarar sana una pestaña que no responde.

## Validación y publicación

Se ejecutó una validación integrada en las pestañas reales de HHR, Ficha y Gestión de Camas con la extensión 0.48.21 recargada. Antes de sincronizar se respaldaron Firestore e IndexedDB para D-2, D-1 y el día clínico. La búsqueda tipo 4 devolvió el episodio neonatal exacto; HHR propuso y confirmó el egreso, y Firestore cerró la ejecución como `complete`. La alerta local posterior correspondió a dos escrituras antiguas que quedaron en conflicto con la revisión remota nueva: se respaldaron, se retiraron de la cola y se verificó que no faltaba el resultado clínico confirmado.

Al terminar se restauró el documento remoto y la copia IndexedDB del día clínico al respaldo previo, con equivalencia completa de campos, y la cola quedó en cero. Así la prueba real no dejó un alta artificial en el entorno.

La extensión propuesta es 0.48.21; la primera captura observaba 0.48.20. No se subieron límites de bundle ni de hotspots. El exceso local preexistente del presupuesto del shell autenticado se sigue informando y no se usa como excusa para modificar el umbral.

Aún faltan escenarios integrados independientes para traslado, reingreso con RUN compartido, caducidad real de sesión y día firmado. La continuidad D-1 sí tiene cobertura determinista; nunca autoriza un egreso por ausencia.
