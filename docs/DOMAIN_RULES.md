# Contrato operativo de HHR

Reglas de negocio que deben mantenerse aunque cambien pantallas, código o mecanismos
de sincronización. Explican la intención del producto, no su implementación.
Ámbito inicial: identidad, censo, recién nacidos, CUDYR y persistencia compartida.
No pretende definir todavía todos los módulos del hospital.

## Uso por personas e IA

1. Leer estas reglas y el [glosario](GLOSSARY.md) antes de modificar el área afectada.
2. Identificar qué reglas debe conservar el cambio; usar sus identificadores en la revisión.
3. Si código y regla divergen, señalar la discrepancia. No convertir un error existente
   en una nueva regla ni corregir datos clínicos por suposición.
4. Cambiar una regla requiere una decisión explícita del responsable del producto,
   su motivo y ejemplos de aceptación actualizados. Un refactor no autoriza ese cambio.

Una **invariante** protege una distinción permanente, por ejemplo identidad frente a
ubicación. Una **política operativa** fija una decisión vigente, por ejemplo un horario.
Ambas deben conservarse durante cambios técnicos; una política puede revisarse por una
decisión clínica u operativa explícita. Los identificadores siguientes son estables.

## Referencia vigente y estado de implementación

Actualización documental: **18-10-2026, Pacific/Easter**. Daniel confirmó que el
simple desfase cuna–madre no requiere otra pregunta cuando el vínculo es inequívoco,
y que la ventana CUDYR incluye las 00:00. La guía v7 aportada se incorpora como
[guía operativa navegable](guia-operativa.html), conciliada con estas reglas.
Este archivo es la referencia canónica; el HTML explica los mismos criterios.
El [glosario](GLOSSARY.md) define términos y la
[matriz de regresión](testing/SYNC_LIFECYCLE_REGRESSION.md) enlaza pruebas del producto.

**Una política aprobada no demuestra que todas sus rutas estén implementadas.**
Base contrastada: `ce144a6033bbc154b69d665349dd34a0b8d01ce0` (PR #886).
La incorporación sólo cambia documentación: no modifica código, Firebase ni el
CUDYR saneado, ni autoriza una recategorización histórica automática.

| Decisión de la guía | Política vigente / referencia                                                                                        | Estado o límite observado en la base                                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HHR-DEC-01          | Carga actual: MQ + CMA hospitalaria; UEA fuera.                                                                      | Verificar/ajustar contador; no equivale a porcentaje de ocupación física.                                                                                                            |
| HHR-DEC-02          | Retirar E1–E5 de la operativa nueva, conservando historia.                                                           | Retiro pendiente de implementación; no retirar CMA/BOX por `isExtra`.                                                                                                                |
| HHR-DEC-03          | Eloísa aporta categoría y puntajes; sólo elegibilidad admite exclusión manual (CUD-01).                              | Aún existen rutas administrativas heredadas; la guía no las certifica conformes.                                                                                                     |
| HHR-DEC-04          | Estadística por fecha real de egreso, conservando día censal (TIME-01/03).                                           | Verificar cálculo mensual; no basta el comportamiento visual del movimiento.                                                                                                         |
| HHR-DEC-05          | Al menos ocho horas al corte de 01:00 D+1 (CUD-04).                                                                  | El resolver simple acepta 17:00; verificar también resolutores temporales y cambios de horario.                                                                                      |
| HHR-DEC-06/07       | 00:00 inclusive a antes de 12:00 pertenece al censo previo; 12:00 al mismo día (CUD-05).                             | Resolver cliente y contrato servidor incluyen el primer minuto desde medianoche. Sin migración ni escritura de históricos; los ajustes administrativos conservan su fecha explícita. |
| HHR-DEC-08          | Si sólo falta hora de ingreso del mismo día, presumir anterior a 17:00 para elegibilidad, identificando el supuesto. | No guardar hora ficticia ni resolver contradicciones así. Conciliar resolver diario y señalización del supuesto; no confundir con CUD-06 (hora del instrumento).                     |
| HHR-DEC-09          | Reconstruir cualquier fecha con evidencia suficiente del episodio y ubicación (CEN-02).                              | Sin límite universal de siete días; disponibilidad de fuentes y permisos puede impedir reconstrucción.                                                                               |
| HHR-DEC-10          | No importar GES en esta sincronización.                                                                              | Un atributo admitido en el contrato de entrada no acredita importación.                                                                                                              |
| RN-02/05            | Cuna con madre inequívoca: seguirla con aviso, sin pregunta adicional por ubicación.                                 | Implementado en #884 y protegido por replay en #886; no extiende la regla a RN en cama independiente ni a asociación incierta.                                                       |

Sexo/género a mostrar y fórmula de ocupación física siguen pendientes de definición;
no deducirlos de los contadores anteriores. Estas políticas proceden de la guía
aceptada por Daniel en esta incorporación, no de una certificación normativa externa.

Para otra IA: leer primero este contrato y el glosario; identificar los IDs afectados;
consultar la ficha de la guía y su fuente; comprobar cambios desde el commit citado;
y enlazar una prueba real antes de afirmar cumplimiento. Si hay contradicción,
registrarla como brecha, no convertir el comportamiento antiguo en regla ni modificar
datos clínicos para que coincidan. Las instrucciones del usuario y las autorizaciones
vigentes no se sustituyen por un documento.

## Identidad y fuentes

| ID     | Comportamiento esperado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Por qué                                                                                    |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| ID-01  | Identificar primero por documento y tipo de documento. Usar nombres normalizados como respaldo sólo con coincidencia inequívoca y contexto del episodio.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Una cama cambia; un nombre puede venir mal escrito. Un pasaporte no se convierte en RUN.   |
| ID-02  | Separar persona, hospitalización y ubicación. Un reingreso es otro episodio, aunque ocurra el mismo día y en la misma cama.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Evita prolongar estadías o trasladar resultados entre hospitalizaciones.                   |
| ID-03  | El RUN materno vincula al RN con su madre; no convierte a ambos en la misma persona. Un identificador de otro progenitor no demuestra ese vínculo materno.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | El RN tiene registro y resultados propios, incluso sin documento propio.                   |
| ID-04  | Un episodio que el software creó por error (por ejemplo, un doble ingreso) se marca «paciente no válido». La marca es por episodio acreditado, nunca por RUN ni por un `legacy_ep_` (dos pacientes pueden compartirlo; ese paciente se quita con «Limpiar»): la sincronización no lo vuelve a ingresar ni registra su egreso.                                                                                                                                                                                                                                                                                                                                                | Eloísa no puede borrarlo y lo cierra con epicrisis y egreso; ese egreso no es estadística. |
| ID-05  | Lo escrito en una celda pertenece al paciente, episodio, cama o cuna y día de su fila cuando se escribió; si la fila cambia de ocupante, episodio o día antes de enviarlo, se descarta sin aviso, como en el diagnóstico, y nunca se guarda en el ocupante nuevo. Solo un episodio acreditado (no `legacy_ep_`) identifica al ocupante, y para lo que sigue escrito en la celda la cuna se ata también al episodio acreditado de su madre. Límite conocido, igual que en main: si la escritura ya salió de la celda (tras su espera) y el RN no tiene episodio acreditado, un reemplazo de madre con un RN legado del mismo ID puede recibirla; con RN acreditado no ocurre. | Un dato clínico en otro paciente es más grave que reescribirlo.                            |
| SRC-01 | Distinguir fuente clínica, canal de extracción y almacenamiento. Eloísa Gestión de Camas y Eloísa Ficha Clínica aportan evidencia; la extensión la rescata y Firebase/HHR la conservan.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Cambiar el canal no cambia el origen ni da mayor autoridad al dato.                        |
| SRC-02 | Conservar procedencia y correcciones justificadas. HHR contiene información sincronizada y datos locales; no todo campo es una copia automática de Eloísa.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Permite explicar qué se observó, qué se corrigió y con qué respaldo.                       |
| SRC-03 | Para la estadística hospitalaria, Eloísa es la referencia oficial, incluso si el cierre administrativo fue posterior al egreso físico. No igualar automáticamente sus fechas con las del antiguo manual.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Concordancia administrativa y hora física son hechos distintos.                            |

### Diagnóstico del censo

La sincronización toma el último diagnóstico activo de Eloísa por orden de evento, aunque no esté
marcado como principal. Una edición manual del diagnóstico en HHR (texto o código, incluyendo
vaciarlo) queda marcada con `diagnosisManualOverride` y guarda en `diagnosisManualOverrideBase` el
diagnóstico de Eloísa que existía al iniciar la edición manual: mientras Eloísa siga informando ese
mismo diagnóstico (o no tenga diagnóstico), prevalece la edición manual; si posteriormente Eloísa
registra un diagnóstico distinto, la sincronización vuelve a proponer la actualización en la
revisión y, al confirmarla, limpia la marca manual. Un cambio manual hecho después de abrir la
revisión también debe conservarse. Para marcas manuales previas sin base guardada —o para reactivar
antes la sincronización—, el editor clínico ofrece la acción explícita «Sincronizar con Eloísa» sin
borrar el texto visible. Los marcadores se guardan con el parche clínico y se limpian al reemplazar
paciente o episodio. No se modifica el diagnóstico de otro paciente ni el de la cuna acompañante.

Los registros anteriores sin `diagnosisManualOverrideBase` conservan su protección manual hasta que
se use «Sincronizar con Eloísa» o cambie el episodio. Las pruebas acreditan la protección de las
ediciones realizadas con esta versión y la reanudación al registrarse un diagnóstico nuevo en Eloísa.

### Documentos con letras y edición manual de identidad (ID-01, SRC-02)

Un pasaporte nunca se convierte en RUT ni se compara como RUT (tampoco si sus dígitos coinciden con
un dígito verificador válido al guardar como «Pasaporte»). Un documento de Eloísa con una letra que
no sea la K final —o informado explícitamente como pasaporte— es un pasaporte y se guarda como tal
en los casos nuevos; un paciente ya guardado conserva su documento.

Corregir a mano la identidad de una cama o cuna ocupada (cambiar entre RUT y Pasaporte, corregir el
número de documento o el nombre) nunca borra el diagnóstico, la especialidad ni los demás datos
clínicos, ni borra la referencia del episodio (`clinicalEpisodeId`): para reemplazar al ocupante de
una cama se egresa, traslada o limpia la cama de forma explícita. Una edición manual del documento o
de su tipo queda marcada con `documentManualOverride` (junto con el parche estructural y armonizada
a días previos del mismo episodio), prevalece en sincronizaciones posteriores de Eloísa para ese
mismo episodio —manteniendo la sincronización del resto de los datos clínicos— y se limpia al
cambiar de episodio. Mientras `documentManualOverride` está activo para ese episodio acreditado, la
conciliación y el arrastre diario de dispositivos invasivos, la renovación de autorización de signos
vitales y escalas frente a una captura viva del mismo episodio y la recuperación de historial de
camas CUDYR por flujo oficial del episodio siguen reconociendo al episodio aunque el documento
corregido en HHR difiera del que imprime Eloísa; sin esa marca explícita o ante encabezados vacíos,
ambiguos o de otro episodio, las validaciones estrictas de identidad se mantienen intactas.

### Corrección demográfica de días anteriores (ID-01, ID-05)

Al corregir un dato demográfico desde la fila, HHR lo copia a los días anteriores del mismo
episodio solo en el paciente que es ese episodio:

1. El mismo episodio acreditado (no `legacy_ep_`) es la misma persona.
2. Sin él, un día anterior es esa persona solo si los dos documentos están declarados RUT, ambos
   tienen dígito verificador correcto y son el mismo RUT. El nombre decide solo cuando el campo de
   documento está vacío en ambos días, y con un único candidato: cualquier texto en ese campo,
   también `S/R` o un pasaporte de solo letras, cuenta como documento.
3. Cualquier otro caso no se escribe: un pasaporte, un tipo ausente o distinto, un RUT inválido o
   dos candidatos.

Límite conocido: un pasaporte sin episodio acreditado no recibe correcciones en días anteriores,
tampoco un día antiguo que la lectura sin versión tipó como pasaporte por su forma (`123.456-0`,
`12.345.678/5`). Desde octubre de 2026 los días de producción tienen episodios acreditados.

Límite de días antiguos: un día guardado sin `schemaVersion` puede traer un tipo deducido por la
migración al leerlo, y ese tipo se trata como declarado; un `RUT` deducido cuenta como RUT
declarado. Medición en producción del 19-11-2026: de 323 días guardados en 2026, 55 no tienen
`schemaVersion`, todos con fecha igual o anterior al 2026-04-29, y ningún episodio abierto los toca
(el más antiguo ingresó el 2026-07-08).

### Nombres del personal

En los catálogos de enfermería y TENS, las variantes que solo difieren en tildes, diéresis, ñ,
mayúsculas o espacios son una persona. Se conserva la forma con más diacríticos y, en empate, la
ya catalogada. La presentación no reescribe turnos históricos.

Cualquier otra marca separa dos nombres: la cedilla, el acento grave y el circunflejo
(«França» y «Franca» son dos personas si nada las une). El ID de Eloísa manda sobre la grafía:
los nombres de un mismo ID son una persona y una sola entrada del catálogo, que conserva la grafía
guardada, y dos IDs son dos personas aunque sus nombres se parezcan: dos filas de la lista, dos
opciones del selector y dos personas en las propuestas de turno, cada una con su grafía.

- **La lista del rol tiene una fila por persona.** Corregir a mano la grafía de una fila
  («Maria Pena» → «María Pena») la deja como fila de esa misma persona, también al reabrir el editor
  y al volver a publicar; nunca toca la fila de otra persona.
- **Texto exacto de una opción** es el mismo texto salvo mayúsculas y espacios, que no distinguen
  personas; las tildes, la ñ o la cedilla sí cuentan para elegir entre dos IDs. Un turno guardado con
  el texto de una opción se muestra como esa opción; si no coincide con ninguna y es de dos personas,
  se ve vacante con el nombre guardado en la ayuda, en el encabezado y en el detalle, y no se reescribe.
- **Un nombre sin ID que coincide con dos personas de Eloísa no elige a ninguna:** una actividad
  firmada así deja el turno para revisar y no se agrega a la lista del rol.
- **Un guardado se da por confirmado solo con la fila de la misma persona**, no con la de otra que se
  escribe parecido. Un registro antiguo sin ID se compara con la regla de hoy, no por la clave con que
  se guardó.

Toda decisión de «misma persona, otra o ambigua» la toma `src/services/staff/eloisaStaffIdentity.ts`
(`staffPerson`, `listedStaffPerson`, `staffRowKey`, `sameStaffMember`); el nombre plegado solo se usa
dentro de ese módulo y de `nurseIdentity.ts` (controles `staff-name-fold` y `staff-name-fold-by-hand`
en `check-source-patterns`). Una persona que Eloísa acredita por primera vez en una sincronización
cuenta como persona propia en la propuesta de ese turno. Límite conocido: dos IDs con el mismo nombre
exacto son una sola fila de la lista, porque la lista guarda nombres.

## Fechas y población del censo

| ID      | Comportamiento esperado                                                                                                                                                                                                                                | Por qué                                                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| TIME-01 | Separar fecha real del evento y día del censo al que corresponde el turno. Un evento de madrugada puede pertenecer al turno nocturno anterior sin cambiar su fecha real.                                                                               | Eloísa informa días calendario; HHR también representa turnos.                                                                 |
| TIME-02 | Interpretar horarios en Rapa Nui. No corregir discrepancias sumando o restando dos horas por aproximación.                                                                                                                                             | El desfase puede deberse a zona horaria o a eventos distintos; los minutos iguales sólo son una pista.                         |
| TIME-03 | Mostrar el alta con fecha y hora del egreso estadístico de Eloísa. No sustituirlas por la hora de emisión de la epicrisis, la sincronización o una estimación del egreso físico.                                                                       | Un cierre tardío sigue siendo la referencia administrativa oficial; una rectificación exige respaldo y trazabilidad.           |
| CEN-01  | Una lectura sin errores no demuestra que un censo histórico contenga a todos los pacientes. Reconstruir presencia con ingresos, movimientos, egresos y otras fuentes disponibles.                                                                      | Una sincronización antigua puede haber omitido pacientes.                                                                      |
| CEN-02  | Si la evidencia acredita una hospitalización omitida, incluirla en la reconstrucción del turno correspondiente, manteniendo el censo original y la trazabilidad.                                                                                       | La ausencia en una copia local no demuestra ausencia del hospital.                                                             |
| CEN-03  | Un ingreso de madrugada con cama comprobada se incorpora al turno nocturno anterior al confirmar la sincronización habitual, si ese censo existe, no está firmado y el operador puede editarlo. Conserva el indicador amarillo de ingreso en su turno. | Es una asignación de turno; no requiere una segunda aceptación. Los días protegidos conservan sus controles.                   |
| CEN-04  | Si una fila administrativa carece de episodio, completar esa identidad desde Eloísa antes de reconstruir el censo, aunque HHR ya tenga un alta del mismo RUT. Un episodio ya egresado no vuelve a ocupar cama.                                         | La coincidencia de RUT no identifica una hospitalización; repetir una captura no debe reabrir un alta ni confundir reingresos. |

### Ingresos y diuresis del detalle

El balance sincronizado corresponde a un episodio y un día del censo: 08:00–07:59
siguiente en Pacific/Easter. Día comprende 08:00–19:59; noche, 20:00–07:59.
Se suman todos los ingresos y, entre los egresos, únicamente Diuresis, sin filtrar
por autor ni profesión. Una captura correcta sustituye los totales; una lectura
fallida o con horarios ambiguos conserva lo conocido y registra el fallo de fuente.
El detalle distingue un período sin registros de uno con volúmenes cero registrados.
No muestra un balance arrastrado de otro día como si fuera el actual.

El contrato de campos procede de los módulos públicos 21622 y 55326 de Eloísa:
`regDatetime`, `hydBalType` (IN/EG), `hydBalName`, `inputQuantity` y
`outputQuantity` (negativo en el editor de egresos). El episodio inspeccionado no
tenía movimientos de balance; por ello sólo se aceptan instantes con desfase explícito.
Un `regDatetime` sin zona requiere verificar su semántica antes de habilitarlo.

### Exámenes del censo

La actualización de exámenes del censo muestra su período y permite Desde/Hasta explícitos,
independientes del día censal. Cambiar el filtro conserva informes y revisiones.

### Dispositivos de Eloísa

Un dispositivo de Eloísa se considera retirado cuando deja de aparecer en una lectura JSON
correcta del día; su fecha de vencimiento no indica nada. Lo manual no se retira, y lo que
enfermería editó sigue retirado aunque Eloísa vuelva a listarlo.

### Reloj del hospital (TIME-02)

«Hoy», la hora y el turno salen del reloj del hospital, Pacific/Easter
(`src/utils/clinicalTimeZone.ts`), también para el año, el mes y el día; nunca del reloj del
computador. No se corta un instante ISO para obtener una fecha u hora ni se extrae con regex la
hora ignorando su desfase: se convierte a Rapa Nui. Una hora continental se convierte; nunca se
lee su reloj ignorando el desfase. Las excepciones locales sin desfase llevan su motivo en la
línea anterior.

Un día `YYYY-MM-DD` es válido solo si existe en el calendario (`isCalendarDate()` en la app,
`isCalendarDay()` en Functions): 2026-02-30 no es el 2 de marzo. Una dirección cuyo `?date=` no
es un día real de año de cuatro cifras abre el día clínico. El día de apertura se calcula una sola
vez al cargar la página (`resolveOpeningCensusDay()` en `src/index.tsx`) y lo reciben el
encabezado y el censo, así que un cambio de turno mientras la app arranca no mueve a ninguno.

### Zona horaria de cada fuente de Eloísa (TIME-02)

Una hora sin desfase no dice en qué zona está. Cada campo se convierte a Rapa Nui con `Intl`,
desde la zona que se midió para él, y nunca sumando o restando horas. Medido el 2026-11-02 contra el
historial oficial de Eloísa, que imprime hora de Rapa Nui (52 días-hospitalización; 2,7 % de
coincidencias por azar):

| Fuente y campo                                                                                       | Zona medida       | Evidencia                                                                                        | Dónde se lee                                            |
| ---------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Historial JSON: etiqueta de escalas, evoluciones, registro de administración, entregas de turno      | Chile continental | −2 h en 100 % de 507, 66 % de 218, 56 % de 194, 31 % de 13; un dispositivo con desfase explícito | `fichaMedicoHistoryClock.ts`; anexo de auditoría        |
| Historial JSON: signos vitales (`PUBLISH_DATE`)                                                      | Rapa Nui          | sin cambio en 66 % de 2.001                                                                      | `fichaMedicoActivityStampInRapaNui`; anexo de auditoría |
| Historial JSON: hora real de administración (`ACTUAL_PERFORMED_TIME`)                                | Rapa Nui          | sin cambio en 281 de 281 (reporte farmacológico oficial)                                         | anexo de auditoría                                      |
| Historial JSON: indicaciones de medicamentos (`patientPharmaIndicationResume.PUBLISH_DATETIME`)      | UTC               | comparada con la hora oficial de emisión de la receta                                            | centro de recetas de la extensión; anexo; panel clínico |
| Episodios, informes de hospitalización, dispositivos (`installationDatetime`), CUDYR (`crdDateTime`) | desfase explícito | el valor trae su desfase                                                                         | conversión desde el instante                            |

Las escalas Braden y Downton guardan el reloj impreso de sus dos fuentes, en hora continental,
porque su identidad persistida depende de ese reloj: el historial JSON sin desfase y el informe de
escalas con su desfase. No se migran. El censo, la reaplicación y la detección de personal desde
registros guardados (`src/features/census/services/censusStaffDiscovery.ts`) las leen en hora de
Rapa Nui con `src/features/census/domain/evaluationScaleClock.ts` (medido el 2026-11-03: 127 y 265
de 392 aplicaciones guardadas).

## Recién nacidos: identidad primero, ubicación después

| ID    | Comportamiento esperado                                                                                                                                                                                                                                                                                                                         | Por qué                                                                                                                                                                                       |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RN-01 | Asociar por RUN materno; como alternativa, por «RN de…» con madre identificada inequívocamente. La cama sola nunca identifica a la madre.                                                                                                                                                                                                       | Una ubicación mal registrada no debe crear parentescos.                                                                                                                                       |
| RN-02 | Si madre identificada y cuna coinciden, sincronizar sin otra pregunta. Si el RN sigue clasificado como cuna y el vínculo materno es inequívoco, acompaña automáticamente a la madre aunque Eloísa conserve la ubicación anterior, con aviso para corregir Gestión de Camas y sin confirmación adicional de ubicación.                           | La confirmación habitual del conjunto de cambios no es una pregunta adicional por cama. Identidad o clasificación inciertas requieren revisión; una cama independiente confirmada se respeta. |
| RN-03 | Ante asociación incierta, solicitar confirmación y conservar los vínculos comprobados. Una cuna sin madre hospitalizada puede permanecer independiente; no inventar una madre ni forzar anidamiento.                                                                                                                                            | No todo RN debe quedar bajo una mujer del censo.                                                                                                                                              |
| RN-04 | Respetar la clasificación del RN hospitalizado en cama independiente médico-quirúrgica. No tratarlo como RN sano en cuna por su edad o por el prefijo «RN».                                                                                                                                                                                     | Puede requerir CUDYR; su elegibilidad se evalúa con sus propias condiciones.                                                                                                                  |
| RN-05 | Si Eloísa corrige la ubicación y coincide con la ya confirmada, aceptar sin otra confirmación. Un cambio posterior se reevalúa: si sólo es desfase de una cuna con madre inequívoca, aplicar RN-02; si cambia identidad o clasificación, solicitar revisión. Mantener un aviso breve de corregir Gestión de Camas mientras exista discrepancia. | Una decisión resuelve una discrepancia concreta, no todos los cambios futuros.                                                                                                                |

## CUDYR: registro y elegibilidad son decisiones separadas

| ID     | Comportamiento esperado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Por qué                                                                                                                                 |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| CUD-01 | Eloísa es la única fuente del registro CUDYR. HHR no admite puntajes manuales ni inventa autor u hora; una excepción manual sólo cambia elegibilidad.                                                                                                                                                                                                                                                                                                                                                                                               | Tener autorización para corregir el censo no autoriza crear una escala.                                                                 |
| CUD-02 | Conservar todo CUDYR válido encontrado, aunque el paciente no sea elegible. La estadística usa sólo pacientes-día elegibles.                                                                                                                                                                                                                                                                                                                                                                                                                        | «Registrado» y «elegible» responden preguntas distintas.                                                                                |
| CUD-03 | Evaluar elegibilidad por paciente, episodio y turno: excluir CMA en Pabellón u Hospitalizados, RN sano en cuna, Urgencias/UEA, duración insuficiente y exclusión manual justificada. Una estancia inicial en UEA no excluye las noches posteriores en Hospitalizados.                                                                                                                                                                                                                                                                               | La situación de ingreso no define toda la estadía.                                                                                      |
| CUD-04 | Usar la 01:00 del día siguiente como referencia fija para exigir ocho horas o más del tramo hospitalario válido y para evaluar si un egreso excluye el turno. No es una hora obligatoria de llenado; un egreso posterior a las 01:00 previo a un registro diferido de mañana no vuelve no elegible la noche, y si el paciente ya dejó la cama antes de ese registro diferido, su cama de la noche se resuelve en el corte de las 01:00.                                                                                                             | Un CUDYR de las 00:05, 03:00 o 09:41–11:59 (registro diferido de matronas o enfermería) puede corresponder al mismo turno.              |
| CUD-05 | La ventana de registro del turno D va desde las 00:00:00 inclusive hasta antes de las 12:00:00 de D+1 (incluye tanto la madrugada del turno noche como el horario diferido de 08:00 a 11:59 realizado por matronas o por enfermería cuando quedó pendiente en la noche). Todo registro dentro de esa ventana en el día X corresponde al CUDYR del día X-1; un registro a las 12:00 pertenece al censo de ese mismo día calendario. Una sincronización la noche de D no puede demostrar ausencia del CUDYR de ese turno antes de abrirse la ventana. | Evita presentar como error un registro aún en ventana y atribuye correctamente el horario diferido de matronas y enfermería al día X-1. |
| CUD-06 | Sin hora en el informe histórico, atribuir el registro a la madrugada anterior a las 08:00 del día calendario informado y al turno previo. Conservarlo como supuesto operativo, sin inventar una hora exacta; resolver ambigüedades de episodio con evidencia.                                                                                                                                                                                                                                                                                      | Recupera el turno sin fabricar datos documentales.                                                                                      |
| CUD-07 | Distinguir resultado encontrado, consulta final completa sin resultado y consulta pendiente/fallida. Usar «No registrado» sólo en el segundo caso. Para un excluido sin registro esperado, mostrar «No aplica»; si tiene CUDYR, conservar «Registrado» y la exclusión.                                                                                                                                                                                                                                                                              | Un fallo técnico no demuestra ausencia; una exclusión no es una tarea pendiente de aplicación.                                          |
| CUD-08 | Admitir el resultado del Excel mensual aunque falten autor u hora. Marcar su procedencia y recuperar también la mañana del primer día del mes siguiente.                                                                                                                                                                                                                                                                                                                                                                                            | Es un registro válido; el último turno del mes cruza la medianoche.                                                                     |
| CUD-09 | Cumplimiento = pacientes-día elegibles con CUDYR / pacientes-día elegibles. Separar personas de pacientes-día y excluir el día abierto del acumulado cerrado.                                                                                                                                                                                                                                                                                                                                                                                       | Evita sumar personas repetidas o penalizar registros aún dentro de ventana.                                                             |
| CUD-10 | Separar el día de lectura de Eloísa del censo confirmado que autoriza el guardado. Sincronizar D en la mañana de D+1 conserva la autoridad de D; cada CUDYR se atribuye por su fecha de aplicación al turno correspondiente.                                                                                                                                                                                                                                                                                                                        | Evita rechazos de archivo y desplazar resultados al día de la consulta.                                                                 |
| CUD-11 | Aplicaciones de Eloísa a la misma hora, con igual categoría, puntajes y todos los ítems (campo, tipo y valor), y la misma autora acreditada por su ID y el mismo rol en todas sus versiones, son una sola aplicación guardada varias veces: cuenta como una y conserva todas sus copias archivadas. Ante cualquier diferencia, un dato faltante o una hora no verificable, quedan por revisar.                                                                                                                                                      | Un guardado repetido en la fuente no es una contradicción clínica.                                                                      |

### Quién sincroniza CUDYR

`nurse_hospital` sincroniza CUDYR con las mismas fechas y caminos que `admin`, en la sincronización
diaria, el reenvío y el archivo mensual. Esto no habilita `setAdminCudyrResult`, que sigue siendo
solo de administrador, ni otros campos clínicos ni otros roles, y conserva la ventana de 48 horas
(SAVE-04) para el resto del día.

## Guardado y condición oficial

| ID      | Comportamiento esperado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Por qué                                                                  |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| SAVE-01 | Distinguir captura, propuesta, guardado local y confirmación remota. Reintentar sin duplicar ni perder cambios; conservar los que todavía no se han enviado. Una lectura del servidor de un día con escrituras pendientes publica y guarda la versión del servidor con las rutas pendientes encima, tal como las guarda la escritura, listas incluidas (una escritura soltada o retirada no aporta rutas); si no se pueden poner encima con certeza (escritura de día completo, cambio de paciente en la cama o la cuna, una lista que también cambió en el servidor), la copia local queda como está y no se presenta como confirmada.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Ver un dato en pantalla no acredita su guardado compartido.              |
| SAVE-02 | Un conflicto entre equipos requiere conciliación; ni la última escritura ni el reloj de un navegador deciden por sí solos la verdad clínica. Dos personas que escriben a la vez conservan ambos cambios si tocan campos o pacientes distintos —incluidas ediciones concurrentes de egresos, traslados o CMA de pacientes distintos, que se concilian por ítem dentro de la transacción—; si cambian el mismo campo o el mismo movimiento a valores distintos, se guarda el primero y el segundo recibe un aviso con su texto conservado. Una edición hecha sin conexión sigue la misma regla al reenviarse. Si una tarea de la cola combina un texto del día que otro equipo cambió con otros cambios del mismo día, la tarea completa queda en conflicto para revisión sin dividirse ni sobrescribir el valor remoto (decisión de producto 23-11-2026). Pendiente: un equipo con el reloj atrasado respecto del de quien escribió antes; y una edición sin conexión de una cama (salvo diagnóstico y estado) o de egresos, traslados o CMA cuando otro equipo cambió otro campo que esa tarea no tiene, que la cola reenvía con la versión de su base y queda en conflicto sin perderse. | Protege decisiones y datos de otros usuarios.                            |
| SAVE-03 | Retirar automáticamente sólo pendientes demostrablemente obsoletos. El descarte manual exige confirmación explícita directa en un paso y elimina el envío de la cola sin copia técnica previa ni papelera histórica (decisión de producto 23-11-2026). Nunca retirar resultados válidos ni presentar un envío retirado como confirmado.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Simplificar la interfaz no permite ocultar pérdidas.                     |
| SAVE-04 | `nurse_hospital` guarda o parcha un día solo desde 24 horas antes hasta 48 horas después de la medianoche del hospital (Pacific/Easter) de su fecha, también en campos clínicos como el diagnóstico, tanto en las reglas como en las Functions del censo. `admin` no tiene ventana. Crear un día que no existe y la sincronización CUDYR de enfermería («Quién sincroniza CUDYR») conservan su excepción. Tras el plazo, al leer el servidor el censo muestra lo vigente: una edición de enfermería rechazada por plazo cerrado queda retenida aparte, con su copia, para descartar, y no se vuelve a aplicar (SAVE-01). Solo la suelta la sesión de enfermería que esta pestaña admitió, con la misma cuenta y titular. Si la lectura falla, la copia local queda como estaba y sin confirmar. Límite conocido: la tarea no guarda el rol de quien escribió, así que un envío de administrador rechazado por otra causa se suelta si después la sesión pasa a enfermería.                                                                                                                                                                                                                | Escribir sin pasar por las reglas no abre lo que ellas cierran.          |
| OFF-01  | Recuperar un mes no lo aprueba automáticamente. «Oficial» exige población reconstruida, resultados y elegibilidad resueltos, aprobación autorizada y trazabilidad. No significa cumplimiento del 100%.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Se certifica la calidad del cálculo, no que todos tengan CUDYR.          |
| OFF-02  | Consultar el mes oficial desde su proyección guardada en Firebase y reutilizar su copia local válida. Abrir o navegar no debe volver a consultar Eloísa ni reconstruir el mes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Los datos ya resueltos deben estar disponibles rápidamente.              |
| OFF-03  | Una corrección documental, de egreso o de elegibilidad relevante exige revisar la vigencia del informe oficial afectado. Una lectura rutinaria no equivale a una corrección.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Mantiene rapidez sin declarar inmutable un informe que realmente cambió. |

### Cola y descarte (SAVE-03)

Ninguna reparación, cierre de sesión o reinicio borra la cola, los parches pendientes ni el
outbox sin confirmación explícita, y una cola nunca se purga por antigüedad ni por número de
fallos. Descartar un envío bloqueado exige confirmación explícita directa en un paso, elimina la
tarea de la cola sin mantener una papelera de envíos descartados y nunca cuenta como guardado
remoto.

### Lecturas fallidas (SAVE-01)

Una lectura fallida no es «sin datos», tampoco en suscripciones: se conserva lo último conocido y
el fallo se señala por su canal de error. Una escritura fallida no es «guardado». El control
`check:empty-on-failure-reads` no admite excepciones heredadas; solo capacidades opcionales del
navegador, con su motivo junto al retorno.

### Reenvío sin conexión (SAVE-01, SAVE-02)

En el reenvío, solo el valor almacenado acredita un campo ya aplicado; un valor igual por
hidratación se envía. Las rutas ya aplicadas no generan conflictos por metadatos, y un conflicto
real conserva la tarea completa sin escritura.

### Decisión manual de especialidad

La decisión manual de especialidad reintenta una vez la lectura local; si sigue fallando, usa solo
la base explícita del llamador, bajo CAS y confirmación remota obligatorios. Nunca confirma una
decisión rechazada ni inventa ausencia local.

## Sesión

- Una corrida clínica se detiene si cambia el propietario o la generación de sesión. Conserva lo
  confirmado y la cola durable; una corrida interrumpida exige una captura nueva, sin reanudación
  ni avisos de sesión. Al cambiar de sesión solo se recupera la entrega de turno de enfermería;
  las sincronizaciones salen de Eloísa y se detienen.
- Una operación que espera pregunta si sigue la misma persona con `guardAuthoringSession()`
  (`src/services/session/authoringSession.ts`): captura la sesión una vez y corta tras cada espera
  si cambió el propietario guardado o la generación admitida, o si hay un cierre de sesión a medio
  limpiar. Salir y volver a entrar con la misma persona y generación también cuenta como cambio
  (la guarda incluye la época de la pestaña). Lo guardado por persona se indexa con `authoringSessionScope()`; lo que solo se muestra
  en esta pestaña, con `sessionEpochGuard()` o `useSessionEpoch()`. Nadie más compara la sesión a
  mano (ESLint `session/raw-read`; lo que falta migrar figura en
  `scripts/config/session-raw-read-ledger.json` y solo baja).
- La guarda se impone en la salida. Lo que A inició no sale ni se reactiva después de que el
  navegador admite a B o empieza el cierre de A: todo envío CUDYR a Functions pasa por
  `callCudyrFunction()` (`src/services/cudyr/cudyrFunctionsCall.ts`) con el guard que la
  operación capturó al empezar, y lo consulta justo antes de enviar.
- La cola tiene una sola regla para todas sus salidas (encolar, procesar, reintentar, descartar,
  liberar y mostrar en el panel): solo trabajo de la persona que **esta pestaña** admitió, mientras
  el navegador la siga teniendo (`getTabOwnerKey()` e `isAdmittedOwner()` en
  `authoringSession.ts`; la cola la lee como `getOwnerKey()` de su runtime). Una pestaña que sigue
  admitida como A después de que otra admitió a B no actúa por nadie, y tampoco una pestaña que cerró
  sesión hasta que vuelva a admitir a alguien. La sesión capturada lleva a quien esta pestaña
  admitió, no la clave compartida: una edición del censo o de la entrega que A hace con el censo
  aún abierto tras entrar B queda retenida para A, nunca en la cola de B. Una tarea se encola a
  nombre de la sesión capturada al iniciar la operación; si esa sesión cambió, no se encola a
  nombre de nadie más (la corrida interrumpida exige una captura nueva). Reclamar una tarea para
  enviarla también es una salida: se pregunta por tarea dentro de la transacción. Reintentar y
  descartar vuelven a preguntar después de leer la fila y nunca valen durante un cierre. Las recuperaciones reciben la
  sesión capturada al iniciar la corrida. Nada se borra: lo de otro dueño queda intacto y su dueño
  lo envía al volver.
- La edición local en vuelo conserva propietario, base y contexto en reposo, aunque la cola activa
  siguiente esté llena; revierte la vista sin avisar a la sesión siguiente.
- El cambio de sesión de Eloísa se observa solo con `onSessionChange` o `useSessionEpoch`
  (`src/services/session/sessionStorageTransition.ts`). Nadie escucha el mensaje
  `HHR_RAYEN_SESSION_CHANGED` en la app: lo que recuerda algo por persona lo olvida ahí, esté o no
  montado.
- La atribución del diagnóstico local usa el propietario admitido en memoria por esta pestaña,
  nunca la clave compartida. Sin admisión no se atribuye; fallar el almacenamiento no interrumpe
  el envío. Solo el administrador conserva el historial del equipo en Errores locales.

## Avisos y tono

Lo recuperable se resuelve solo y en silencio. Solo se avisa lo que una persona debe resolver: una
edición que no se guardó y no se recuperará sola, o datos en riesgo.

El cuadro de sincronización y sus diálogos usan un tono sereno: tres niveles (informativo,
pendiente de revisar, necesita tu acción) desde `syncTone.ts`, sin rojo, naranja ni amarillo de
alarma y sin palabras de avería para lo que permite seguir trabajando. Solo un envío local
detenido pide acción. El texto técnico de la fuente solo lo ve el administrador.

## Ejemplos de aceptación

- **Madre en R3, RN identificado y cuna C-R3:** importar sin pregunta (RN-01, RN-02).
- **Madre inequívoca en R3, RN sano en cuna informada C-R2:** situar la cuna en C-R3
  con aviso para corregir Gestión de Camas, sin pregunta adicional. Si luego Eloísa
  informa C-R3, aceptar sin nueva confirmación. Reevaluar futuros cambios según
  identidad y clasificación, no sólo por discordancia de ubicación (RN-02, RN-05).
- **RN enfermo en cama independiente:** conservar su clasificación y evaluar CUDYR
  con las reglas del caso; no excluirlo sólo por ser RN (RN-04, CUD-03).
- **Alta a las 01:47 del día 10, en turno nocturno del 9:** mostrar día 10, 01:47,
  dentro del censo del 9. Una epicrisis emitida a otra hora no cambia el egreso (TIME-01, TIME-03).
- **Ingreso el día 2 a las 14:00, omitido en censo local; CUDYR del día 3:** reconstruir
  presencia del turno del 2 con evidencia del episodio. Conservar el resultado y evaluar
  elegibilidad por separado (CEN-02, CUD-02, CUD-06).
- **CMA con CUDYR registrado:** mostrar resultado y exclusión; no sumarlo al cumplimiento
  ni etiquetarlo como pendiente de aplicación (CUD-02, CUD-07).
- **Consulta fallida:** mantener verificación pendiente; no mostrar «No registrado» (CUD-07).
- **Mes oficial al volver a abrir:** leer la proyección guardada; no lanzar recuperación
  histórica de Eloísa (OFF-02).

## Protección permanente de sincronización (#886)

El PR #886 protege hoy/ayer, madrugada, movimientos, madre/RN, egresos y repetición
sobre el resultado ya guardado. Antes de comparar ingreso y egreso, convertir el día
censal del egreso a fecha calendario; no comparar dimensiones temporales distintas.
Mantener notas, identidad y clasificación del episodio, sin duplicar movimientos ni
revivir altas con capturas atrasadas. El alta materna no sustituye el documento propio
del RN; una cuna egresada sigue visible como movimiento, fuera de estadísticas.

Ejecutar `npm run test:sync-lifecycle`; ver la
[matriz de escenarios y límites](testing/SYNC_LIFECYCLE_REGRESSION.md).
Las fuentes y persistencia están simuladas: no acredita permisos de Chrome, despliegue
ni una nueva sincronización real. Este PR documental no vuelve a ejecutar escrituras.

## Documentos de detalle

Estos documentos conservan la mecánica y evidencia de cada área, sin reemplazar la intención:

- [Verdad compartida del censo](ADR_DAILY_CENSUS_TRUTH_CONTRACT.md).
- [Recuperación del censo y ubicación neonatal](RUNBOOK_DAILY_CENSUS_RECOVERY.md).
- [Control diario CUDYR](features/cudyr/CUDYR_DAILY_CONTROL.md).
- [Fuentes y conciliación histórica](features/cudyr/CUDYR_HISTORICAL_METHOD.md).
- [Conciliación por episodio y turno](features/cudyr/CUDYR_CLINICAL_DAY_RECONCILIATION.md).
- [Cierre mensual oficial](features/cudyr/CUDYR_OFFICIAL_MONTH.md).

Si aparece un comportamiento no cubierto, documentar primero la duda y su evidencia.
No completar este contrato inventando reglas para módulos aún no revisados.
