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

| ID     | Comportamiento esperado                                                                                                                                                                 | Por qué                                                                                  |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| ID-01  | Identificar primero por documento y tipo de documento. Usar nombres normalizados como respaldo sólo con coincidencia inequívoca y contexto del episodio.                                | Una cama cambia; un nombre puede venir mal escrito. Un pasaporte no se convierte en RUN. |
| ID-02  | Separar persona, hospitalización y ubicación. Un reingreso es otro episodio, aunque ocurra el mismo día y en la misma cama.                                                             | Evita prolongar estadías o trasladar resultados entre hospitalizaciones.                 |
| ID-03  | El RUN materno vincula al RN con su madre; no convierte a ambos en la misma persona. Un identificador de otro progenitor no demuestra ese vínculo materno.                              | El RN tiene registro y resultados propios, incluso sin documento propio.                 |
| SRC-01 | Distinguir fuente clínica, canal de extracción y almacenamiento. Eloísa Gestión de Camas y Eloísa Ficha Clínica aportan evidencia; la extensión la rescata y Firebase/HHR la conservan. | Cambiar el canal no cambia el origen ni da mayor autoridad al dato.                      |
| SRC-02 | Conservar procedencia y correcciones justificadas. HHR contiene información sincronizada y datos locales; no todo campo es una copia automática de Eloísa.                              | Permite explicar qué se observó, qué se corrigió y con qué respaldo.                     |

## Fechas y población del censo

| ID      | Comportamiento esperado                                                                                                                                                                                                                                | Por qué                                                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| TIME-01 | Separar fecha real del evento y día del censo al que corresponde el turno. Un evento de madrugada puede pertenecer al turno nocturno anterior sin cambiar su fecha real.                                                                               | Eloísa informa días calendario; HHR también representa turnos.                                                                 |
| TIME-02 | Interpretar horarios en Rapa Nui. No corregir discrepancias sumando o restando dos horas por aproximación.                                                                                                                                             | El desfase puede deberse a zona horaria o a eventos distintos; los minutos iguales sólo son una pista.                         |
| TIME-03 | Mostrar el alta con fecha y hora del egreso estadístico que libera la cama. No sustituirlas por la hora de emisión de la epicrisis ni por la hora de sincronización.                                                                                   | Son hechos distintos, aunque pertenezcan al mismo episodio.                                                                    |
| CEN-01  | Una lectura sin errores no demuestra que un censo histórico contenga a todos los pacientes. Reconstruir presencia con ingresos, movimientos, egresos y otras fuentes disponibles.                                                                      | Una sincronización antigua puede haber omitido pacientes.                                                                      |
| CEN-02  | Si la evidencia acredita una hospitalización omitida, incluirla en la reconstrucción del turno correspondiente, manteniendo el censo original y la trazabilidad.                                                                                       | La ausencia en una copia local no demuestra ausencia del hospital.                                                             |
| CEN-03  | Un ingreso de madrugada con cama comprobada se incorpora al turno nocturno anterior al confirmar la sincronización habitual, si ese censo existe, no está firmado y el operador puede editarlo. Conserva el indicador amarillo de ingreso en su turno. | Es una asignación de turno; no requiere una segunda aceptación. Los días protegidos conservan sus controles.                   |
| CEN-04  | Si una fila administrativa carece de episodio, completar esa identidad desde Eloísa antes de reconstruir el censo, aunque HHR ya tenga un alta del mismo RUT. Un episodio ya egresado no vuelve a ocupar cama.                                         | La coincidencia de RUT no identifica una hospitalización; repetir una captura no debe reabrir un alta ni confundir reingresos. |

## Recién nacidos: identidad primero, ubicación después

| ID    | Comportamiento esperado                                                                                                                                                                                                                                                                                                                         | Por qué                                                                                                                                                                                       |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RN-01 | Asociar por RUN materno; como alternativa, por «RN de…» con madre identificada inequívocamente. La cama sola nunca identifica a la madre.                                                                                                                                                                                                       | Una ubicación mal registrada no debe crear parentescos.                                                                                                                                       |
| RN-02 | Si madre identificada y cuna coinciden, sincronizar sin otra pregunta. Si el RN sigue clasificado como cuna y el vínculo materno es inequívoco, acompaña automáticamente a la madre aunque Eloísa conserve la ubicación anterior, con aviso para corregir Gestión de Camas y sin confirmación adicional de ubicación.                           | La confirmación habitual del conjunto de cambios no es una pregunta adicional por cama. Identidad o clasificación inciertas requieren revisión; una cama independiente confirmada se respeta. |
| RN-03 | Ante asociación incierta, solicitar confirmación y conservar los vínculos comprobados. Una cuna sin madre hospitalizada puede permanecer independiente; no inventar una madre ni forzar anidamiento.                                                                                                                                            | No todo RN debe quedar bajo una mujer del censo.                                                                                                                                              |
| RN-04 | Respetar la clasificación del RN hospitalizado en cama independiente médico-quirúrgica. No tratarlo como RN sano en cuna por su edad o por el prefijo «RN».                                                                                                                                                                                     | Puede requerir CUDYR; su elegibilidad se evalúa con sus propias condiciones.                                                                                                                  |
| RN-05 | Si Eloísa corrige la ubicación y coincide con la ya confirmada, aceptar sin otra confirmación. Un cambio posterior se reevalúa: si sólo es desfase de una cuna con madre inequívoca, aplicar RN-02; si cambia identidad o clasificación, solicitar revisión. Mantener un aviso breve de corregir Gestión de Camas mientras exista discrepancia. | Una decisión resuelve una discrepancia concreta, no todos los cambios futuros.                                                                                                                |

## CUDYR: registro y elegibilidad son decisiones separadas

| ID     | Comportamiento esperado                                                                                                                                                                                                                                                                         | Por qué                                                                                        |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| CUD-01 | Eloísa es la única fuente del registro CUDYR. HHR no admite puntajes manuales ni inventa autor u hora; una excepción manual sólo cambia elegibilidad.                                                                                                                                           | Tener autorización para corregir el censo no autoriza crear una escala.                        |
| CUD-02 | Conservar todo CUDYR válido encontrado, aunque el paciente no sea elegible. La estadística usa sólo pacientes-día elegibles.                                                                                                                                                                    | «Registrado» y «elegible» responden preguntas distintas.                                       |
| CUD-03 | Evaluar elegibilidad por paciente, episodio y turno: excluir CMA en Pabellón u Hospitalizados, RN sano en cuna, Urgencias/UEA, duración insuficiente y exclusión manual justificada. Una estancia inicial en UEA no excluye las noches posteriores en Hospitalizados.                           | La situación de ingreso no define toda la estadía.                                             |
| CUD-04 | Usar la 01:00 del día siguiente como referencia fija para exigir ocho horas o más del tramo hospitalario válido. No es una hora obligatoria de llenado.                                                                                                                                         | Un CUDYR de las 00:05, 03:00 o 11:59 puede corresponder al mismo turno.                        |
| CUD-05 | La ventana de registro del turno D va desde las 00:00:00 inclusive hasta antes de las 12:00:00 de D+1. Un registro a las 12:00 pertenece al censo de ese mismo día calendario. Una sincronización la noche de D no puede demostrar ausencia del CUDYR de ese turno antes de abrirse la ventana. | Evita presentar como error un registro que aún no corresponde consultar.                       |
| CUD-06 | Sin hora en el informe histórico, atribuir el registro a la madrugada anterior a las 08:00 del día calendario informado y al turno previo. Conservarlo como supuesto operativo, sin inventar una hora exacta; resolver ambigüedades de episodio con evidencia.                                  | Recupera el turno sin fabricar datos documentales.                                             |
| CUD-07 | Distinguir resultado encontrado, consulta final completa sin resultado y consulta pendiente/fallida. Usar «No registrado» sólo en el segundo caso. Para un excluido sin registro esperado, mostrar «No aplica»; si tiene CUDYR, conservar «Registrado» y la exclusión.                          | Un fallo técnico no demuestra ausencia; una exclusión no es una tarea pendiente de aplicación. |
| CUD-08 | Admitir el resultado del Excel mensual aunque falten autor u hora. Marcar su procedencia y recuperar también la mañana del primer día del mes siguiente.                                                                                                                                        | Es un registro válido; el último turno del mes cruza la medianoche.                            |
| CUD-09 | Cumplimiento = pacientes-día elegibles con CUDYR / pacientes-día elegibles. Separar personas de pacientes-día y excluir el día abierto del acumulado cerrado.                                                                                                                                   | Evita sumar personas repetidas o penalizar registros aún dentro de ventana.                    |
| CUD-10 | Separar el día de lectura de Eloísa del censo confirmado que autoriza el guardado. Sincronizar D en la mañana de D+1 conserva la autoridad de D; cada CUDYR se atribuye por su fecha de aplicación al turno correspondiente.                                                                    | Evita rechazos de archivo y desplazar resultados al día de la consulta.                        |

## Guardado y condición oficial

| ID      | Comportamiento esperado                                                                                                                                                                                | Por qué                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| SAVE-01 | Distinguir captura, propuesta, guardado local y confirmación remota. Reintentar sin duplicar ni perder cambios; conservar los que todavía no se han enviado.                                           | Ver un dato en pantalla no acredita su guardado compartido.              |
| SAVE-02 | Un conflicto entre equipos requiere conciliación; ni la última escritura ni el reloj de un navegador deciden por sí solos la verdad clínica.                                                           | Protege decisiones y datos de otros usuarios.                            |
| SAVE-03 | Retirar sólo pendientes demostrablemente obsoletos, conservando respaldo. Nunca retirar resultados válidos ni presentar un envío retirado como confirmado.                                             | Simplificar la interfaz no permite ocultar pérdidas.                     |
| OFF-01  | Recuperar un mes no lo aprueba automáticamente. «Oficial» exige población reconstruida, resultados y elegibilidad resueltos, aprobación autorizada y trazabilidad. No significa cumplimiento del 100%. | Se certifica la calidad del cálculo, no que todos tengan CUDYR.          |
| OFF-02  | Consultar el mes oficial desde su proyección guardada en Firebase y reutilizar su copia local válida. Abrir o navegar no debe volver a consultar Eloísa ni reconstruir el mes.                         | Los datos ya resueltos deben estar disponibles rápidamente.              |
| OFF-03  | Una corrección documental, de egreso o de elegibilidad relevante exige revisar la vigencia del informe oficial afectado. Una lectura rutinaria no equivale a una corrección.                           | Mantiene rapidez sin declarar inmutable un informe que realmente cambió. |

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
- [Control diario CUDYR](CUDYR_DAILY_CONTROL.md).
- [Fuentes y conciliación histórica](CUDYR_HISTORICAL_METHOD.md).
- [Conciliación por episodio y turno](CUDYR_CLINICAL_DAY_RECONCILIATION.md).
- [Cierre mensual oficial](CUDYR_OFFICIAL_MONTH.md).

Si aparece un comportamiento no cubierto, documentar primero la duda y su evidencia.
No completar este contrato inventando reglas para módulos aún no revisados.
