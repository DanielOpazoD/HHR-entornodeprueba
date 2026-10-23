# Glosario de Dominio HHR

## Significado operativo

Definiciones para entender el programa antes de leer su código. El comportamiento
esperado y sus motivos están en el [contrato operativo](DOMAIN_RULES.md).

| Término                        | Significado en HHR                                                                                                                                                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Regla de negocio               | Decisión sobre cómo debe comportarse el programa en la operación del hospital.                                                                                                                                                               |
| Invariante del dominio         | Regla que un cambio técnico debe conservar. Ejemplo: una cama no identifica a la madre.                                                                                                                                                      |
| Política operativa             | Regla vigente que puede cambiar mediante decisión explícita. Ejemplo: ventana de registro.                                                                                                                                                   |
| Persona / paciente             | Individuo atendido; no su cama ni cada una de sus hospitalizaciones.                                                                                                                                                                         |
| Documento de identidad         | RUN/RUT, pasaporte u otro identificador, conservando su tipo. No son intercambiables.                                                                                                                                                        |
| Episodio                       | Una hospitalización desde el ingreso hasta su salida. Un reingreso abre otro episodio.                                                                                                                                                       |
| Fecha real del evento          | Fecha y hora en que ocurrió el ingreso, movimiento o egreso. No se cambia para acomodarlo a un turno.                                                                                                                                        |
| Día calendario                 | Fecha del evento o de la columna del informe de Eloísa.                                                                                                                                                                                      |
| Día del censo / turno nocturno | Día operativo al que HHR atribuye el turno. Puede contener eventos de la madrugada siguiente.                                                                                                                                                |
| Censo local original           | Copia que HHR conservó de un día; puede contener omisiones de sincronización.                                                                                                                                                                |
| Censo incompleto               | Representación que omite pacientes o episodios que correspondían al día/turno. Es una brecha de población, no necesariamente un error de lectura.                                                                                            |
| Población reconstruida         | Pacientes y episodios del turno establecidos al cotejar las fuentes y resolver omisiones.                                                                                                                                                    |
| Fuente clínica                 | Registro que aporta evidencia: Gestión de Camas o Ficha Clínica de Eloísa. HHR conserva esa evidencia y datos locales identificados como tales.                                                                                              |
| Canal de extracción            | Medio que rescata la información, como la extensión. No es una fuente clínica adicional.                                                                                                                                                     |
| Persistencia                   | Conservación de datos para reutilizarlos: local en HHR o compartida en Firebase. No crea un registro clínico nuevo.                                                                                                                          |
| Egreso estadístico             | Salida registrada cuando se libera la cama en Gestión de Camas. Aporta la fecha y hora que HHR muestra como alta.                                                                                                                            |
| Epicrisis                      | Resumen clínico de la hospitalización. Su hora de emisión no es la hora de liberación de cama.                                                                                                                                               |
| RN                             | Recién nacido. Su identidad y clasificación son propias, distintas de las de su madre.                                                                                                                                                       |
| Asociación materna             | Vínculo entre RN y madre respaldado por identidad, no sólo por ubicación.                                                                                                                                                                    |
| Cuna RN sano                   | Ubicación de un RN sano, excluida del cumplimiento CUDYR. Se muestra su código, por ejemplo C-R3.                                                                                                                                            |
| Cama independiente del RN      | Cama hospitalaria ocupada por el RN con su clasificación propia. Ser RN no lo excluye automáticamente de CUDYR.                                                                                                                              |
| Cama media / intermedia        | En el área médico-quirúrgica: medias NEO1–2 y H1C1–H6C2; intermedias R1–R4. El código de cama no sustituye la modalidad de atención.                                                                                                         |
| CMA                            | Cirugía Mayor Ambulatoria. No elegible para cumplimiento CUDYR, tanto en Pabellón como en Hospitalizados.                                                                                                                                    |
| UEA                            | Ubicación de Urgencias. Excluye CUDYR mientras corresponda esa situación; no toda la hospitalización posterior.                                                                                                                              |
| Registro CUDYR                 | Categorización existente en Eloísa. Se conserva aunque no sea elegible; HHR no permite llenarla manualmente.                                                                                                                                 |
| Origen histórico               | Resultado recuperado de un informe de Eloísa. Su procedencia se distingue; sigue siendo válido.                                                                                                                                              |
| Elegibilidad                   | Decisión por paciente, episodio y turno sobre si entra al cálculo de cumplimiento. No decide si el registro existe.                                                                                                                          |
| Paciente-día                   | Un paciente en un día/turno evaluado. Una persona puede aportar varios pacientes-día en un mes.                                                                                                                                              |
| Referencia 01:00               | Instante fijo para calcular duración hospitalaria CUDYR. No exige aplicar el instrumento a esa hora.                                                                                                                                         |
| Ventana abierta / cerrada      | El turno admite registros de 00:00 inclusive hasta antes de 12:00 del día siguiente; desde las 12:00 se puede verificar el resultado final. Es la política aprobada; consultar la brecha de implementación de medianoche en DOMAIN_RULES.md. |
| Consulta completa              | Se leyeron las partes necesarias de la fuente para el caso y período, sin fallos pendientes. No certifica por sí sola toda la población censal.                                                                                              |
| Consulta incompleta / fallida  | Falta leer una parte o hubo un error. No permite concluir que no existe CUDYR.                                                                                                                                                               |
| Registrado                     | Se encontró CUDYR válido. No significa que el paciente sea elegible.                                                                                                                                                                         |
| No registrado                  | Consulta final completa, con paciente y episodio inequívocos, sin CUDYR encontrado.                                                                                                                                                          |
| Verificación pendiente         | Falta una lectura o resolver una discrepancia. No equivale a «No registrado».                                                                                                                                                                |
| No aplica                      | Caso excluido al que no se exige registro para cumplimiento. Si existe CUDYR, se conserva y se muestra.                                                                                                                                      |
| Exclusión manual justificada   | Decisión documentada que cambia elegibilidad, conservando autor y motivo. No modifica el puntaje CUDYR.                                                                                                                                      |
| Cumplimiento                   | Pacientes-día elegibles con CUDYR dividido por pacientes-día elegibles. No es el porcentaje de toda la ocupación hospitalaria.                                                                                                               |
| Mes oficial                    | Población y cálculo aprobados con trazabilidad, conservados en una proyección de Firebase. No significa 100% de cumplimiento.                                                                                                                |
| Guardado local pendiente       | Cambio conservado en el equipo que aún no tiene confirmación compartida. No es dato perdido ni guardado remoto confirmado.                                                                                                                   |
| Sincronización completa        | Finalizaron las operaciones previstas de esa ejecución. No significa que todo el mes histórico o todas las fuentes del hospital estén verificados.                                                                                           |
| Conflicto                      | Dos datos o decisiones no pueden conciliarse de forma segura. Requiere evidencia o confirmación; no se resuelve por el último navegador que escribió.                                                                                        |

## Convenciones técnicas existentes

> Vocabulario canónico del proyecto. Si un concepto aparece con un nombre
> distinto en código nuevo, es deuda — alinear con esta tabla. Aplica
> tanto a strings de UI (en español) como a identificadores de código
> (típicamente en inglés). Los pares "código vs UI" están explicitados
> donde divergen.

Las tablas siguientes conservan las convenciones de nombres de código y UI.

## Cómo usar este documento

- Antes de nombrar un nuevo símbolo (variable, función, archivo, ruta,
  evento de auditoría), busca acá.
- Si lo que necesitas no aparece, primero pregunta si es realmente nuevo
  o si calza en un término existente. Si es nuevo, agrégalo a este doc en
  el mismo PR.
- Términos en columna "Prohibido" son herencia de iteraciones tempranas.
  No se eliminan donde ya existen para no romper compatibilidad, pero
  **no aparecen en código nuevo**.
- **Enforcement automático**: solo los términos con cero uso actual en
  el repo están prohibidos por ESLint (`no-restricted-syntax`): `intake`,
  `swap`. El resto de la columna "Prohibido" es aspiracional — `diagnosis`,
  `egreso` y `release` siguen presentes en código legítimo (campos de
  formularios IEEH, workflows de CI, tipos legacy) y banearlos por lint
  generaría más ruido que señal. Si vas a introducir un término nuevo en
  esa columna y no tiene uso actual, agrégalo también al lint.

## Pacientes y movimientos

| Concepto                                  | UI (es)            | Código (en/identificador)       | Prohibido / sinónimo legacy                 |
| ----------------------------------------- | ------------------ | ------------------------------- | ------------------------------------------- |
| Persona hospitalizada                     | Paciente           | `patient`, `patientName`, `rut` | "person", "user clínico"                    |
| Cama del hospital                         | Cama               | `bed`, `bedId`, `bedName`       | "slot", "espacio"                           |
| Cuna de recién nacido asociada a una cama | Cuna RN            | `clinicalCrib` (compatibilidad) | "baby", "infant"                            |
| Ingreso de un paciente a una cama         | Admisión / Ingreso | `admission`, `admissionDate`    | "intake"                                    |
| Egreso definitivo                         | Alta               | `discharge`, `dischargeDate`    | "egreso" (en código nuevo); "release"       |
| Cambio de cama dentro del hospital        | Movimiento         | `bedMovement`, `moveOrCopy`     | "swap"                                      |
| Derivación a otro centro                  | Traslado           | `transfer`, `transferDate`      | "derivación" (en código)                    |
| Diagnóstico clínico de la cama            | Diagnóstico        | `pathology`                     | "diagnosis" en código nuevo (ya hay legacy) |
| Código CIE-10 asociado al diagnóstico     | CIE-10             | `cie10Code`, `cie10Description` | —                                           |
| Estado clínico de gravedad                | Estado             | `status`                        | "condition", "severity"                     |
| Especialidad médica que atiende           | Especialidad       | `specialty`                     | "service line"                              |

## Documentación clínica

| Concepto                                               | UI (es)           | Código                             | Prohibido                 |
| ------------------------------------------------------ | ----------------- | ---------------------------------- | ------------------------- |
| Documento clínico estructurado (epicrisis, IEEH, etc.) | Documento clínico | `clinicalDocument`                 | "doc", "report" en código |
| Epicrisis (resumen al alta)                            | Epicrisis         | `epicrisis`                        | —                         |
| Formulario IEEH (informe estadístico de egreso)        | IEEH              | `ieeh`                             | —                         |
| Foto de curación                                       | Foto de curación  | `woundCarePhoto`                   | "wound photo" en UI       |
| Consentimiento informado para fotos                    | Consentimiento    | `woundCareConsent`                 | "consent form" suelto     |
| Sesión QR para subida móvil                            | QR móvil          | `mobileUploadSession`, `sessionId` | "magic link"              |

## Auditoría y outcomes

| Concepto                                              | UI (es)             | Código                                                                                               | Prohibido                       |
| ----------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------- |
| Evento de auditoría persistido                        | Evento de auditoría | `auditLog`, `AuditLogEntry`                                                                          | "log entry" suelto              |
| Acción auditada (verbo del catálogo)                  | Acción              | `AuditAction` (`PATIENT_ADMITTED`…)                                                                  | "event type"                    |
| Outcome canónico de operación de aplicación           | —                   | `ApplicationOutcome<T>`                                                                              | `Result<T>` genérico, `boolean` |
| Estado runtime de una operación clínica visible al UI | —                   | `RuntimeOperationStatusSnapshot`                                                                     | "phase", "step status"          |
| Estado de una mutación clínica                        | —                   | `'ready' \| 'saving' \| 'pending' \| 'conflict' \| 'blocked' \| 'offline' \| 'degraded' \| 'failed'` | Cualquier set ad-hoc            |

## Roles y permisos

| Concepto                         | UI (es)               | Código (rol token)      | Notas                              |
| -------------------------------- | --------------------- | ----------------------- | ---------------------------------- |
| Personal médico tratante         | Médico                | `doctor_hospital`       | También ve audit                   |
| Médico de turno de urgencia      | Médico urgencia       | `doctor_urgency`        | Solo lectura censo                 |
| Enfermería de hospitalización    | Enfermera             | `nurse_hospital`        | Editor por defecto del censo       |
| Administrador (jefatura técnica) | Administrador         | `admin`                 | Acceso total                       |
| Sesión móvil para subir fotos QR | (no aparece como rol) | `mobile_upload_session` | Pseudo-actor, no es usuario humano |

## Turnos y handoff

| Concepto                             | UI (es)           | Código                        | Prohibido             |
| ------------------------------------ | ----------------- | ----------------------------- | --------------------- |
| Cambio de turno enfermería           | Entrega de turno  | `handoff`, `nursingHandoff`   | "shift change"        |
| Notas médicas por especialidad       | Entrega médica    | `medicalHandoff`              | "doctor handoff"      |
| Turno diurno / nocturno              | Diurno / Nocturno | `'day' \| 'night'`            | "morning" / "evening" |
| Turno completo (24h) en un día       | Turno             | `shift`                       | —                     |
| Reasignación de pacientes a una sala | Sala              | `location` (campo de la cama) | "room", "ward"        |

## Indicadores y reportes

| Concepto                                    | UI (es) | Código        | Notas                       |
| ------------------------------------------- | ------- | ------------- | --------------------------- |
| Categorización de cuidados (UCI/UTI/UPC)    | CUDYR   | `cudyr`       | Score multidimensional      |
| Cama de cuidados intensivos                 | UCI     | `BedType.UCI` | UPC subset                  |
| Cama de cuidados intermedios                | UTI     | `BedType.UTI` | UPC subset                  |
| Cama de paciente complejo (UCI o UTI)       | UPC     | `isUPC`       | Indicador derivado          |
| Cirugía/procedimiento ambulatorio mismo día | CMA     | `cma`         | "Cirugía Mayor Ambulatoria" |
| Estadística MINSAL / SINEDI                 | MINSAL  | `minsal`      | Reportes regulatorios       |

## Convenciones generales

- **Strings de UI**: español, primera letra mayúscula, sin gerundio para
  acciones inmediatas ("Guardar", no "Guardando..." salvo loading states).
- **Identificadores de código**: inglés camelCase para variables/funciones,
  PascalCase para tipos/componentes, SCREAMING_SNAKE para constantes.
- **Acciones de auditoría**: SCREAMING_SNAKE en pasado (`PATIENT_ADMITTED`,
  `WOUND_CARE_PHOTO_UPLOADED`).
- **Eventos de telemetría**: snake_case (`census_discharge_created`).
- **Ids de paths Firestore**: kebab-case (`wound-care-mobile-upload-sessions`).
- **Branches de feature flag**: SCREAMING_SNAKE (`USE_ADMIT_PATIENT_COMMAND`).

## Reglas de mantenimiento

- Si introduces un sinónimo nuevo en código, mover a la columna "Prohibido"
  el viejo y abrir un activo en
  [TECHNICAL_DEBT_REGISTER](TECHNICAL_DEBT_REGISTER.md) si el legacy
  queda en producción.
- Acciones de auditoría: agregar a este glosario antes de mergearlas para
  forzar la conversación de naming.
- Cualquier término nuevo de dominio clínico (no técnico) debe ser revisado
  por la persona responsable del producto antes de canonizarse.
