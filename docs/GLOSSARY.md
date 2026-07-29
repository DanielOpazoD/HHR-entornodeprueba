# Glosario de Dominio HHR

> Vocabulario canónico del proyecto. Si un concepto aparece con un nombre
> distinto en código nuevo, es deuda — alinear con esta tabla. Aplica
> tanto a strings de UI (en español) como a identificadores de código
> (típicamente en inglés). Los pares "código vs UI" están explicitados
> donde divergen.

Última actualización: 2026-05-03.

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
