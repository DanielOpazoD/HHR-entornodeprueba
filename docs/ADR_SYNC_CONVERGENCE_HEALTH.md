# ADR: Salud de convergencia clínica

**Estado:** Vigente (2026-07-03)
**Ámbito:** `dailyRecord` · censo diario · entrega enfermería · entrega médica · outbox · observabilidad
**Relacionado:** `ADR_DAILY_CENSUS_TRUTH_CONTRACT.md`, `ADR_CONFLICT_VERSION_RECOVERY.md`, `RUNBOOK_SYNC_RESILIENCE.md`

## Decisión

La aplicación debe distinguir entre guardar un cambio clínico y comprobar que todos los planos
relevantes convergieron. El diagnóstico de convergencia clínica compara:

- registro local;
- registro remoto;
- outbox local;
- auditoría reciente;
- disponibilidad de snapshots recuperables.

Este diagnóstico no elige verdad clínica ni reemplaza la autoridad transaccional. Su rol es
explicar rápido si el sistema está sano, recuperable o requiere revisión humana.

## Estados

| Estado         | Significado operativo                                                                               | Acción esperada                                                         |
| -------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `healthy`      | Local, remoto, outbox y evidencia no muestran divergencias activas.                                 | No hacer nada.                                                          |
| `recoverable`  | Hay trabajo local pendiente o replay idempotente que puede reintentarse sin decidir verdad clínica. | Reintentar outbox, refrescar remoto o confirmar ack local ya aplicado.  |
| `needs_review` | Existe divergencia clínica o falta evidencia suficiente; puede haber snapshot revisable.            | Admin/Hospitalizados HHR revisa contexto antes de preservar o bloquear. |
| `unsafe`       | Hay un estado que no debe autorresolverse, como paciente activo duplicado.                          | Bloquear reparación automática y escalar revisión clínica/soporte.      |

## Superficies cubiertas

- Censo activo: pacientes duplicados, cama activa y divergencias por episodio.
- Movimientos: altas, traslados y CMA visibles localmente pero no reflejados remoto.
- Entrega enfermería: notas por cama/episodio y novedades globales de turno.
- Entrega médica: entregas por especialidad, entradas por paciente y novedades médicas derivadas.
- Outbox: tareas antiguas, replay repetido y mutaciones ya reconocidas por autoridad/remoto.
- Snapshots: disponible, faltante, expirado, permiso denegado, fallo de guardado o estado desconocido.

## Contrato de verdad

La verdad final sigue siendo:

1. mutación aceptada por autoridad clínica;
2. merge por intención clínica;
3. invariantes post-merge;
4. restauración manual auditada solo cuando un usuario autorizado decide preservar otra versión.

El diagnóstico de convergencia opera después o alrededor de ese contrato. Puede decir "esto requiere
revisión", pero no puede saltarse `authority mode`, ni los guardrails anti-rollback del restore.

## Evidencia mínima por hallazgo

Cada hallazgo debe exponer, cuando exista:

- fecha del censo;
- módulo clínico;
- paciente, RUT y cama;
- path técnico;
- severidad;
- si hay outbox pendiente relacionado;
- estado de snapshot;
- acción operacional sugerida.

## Fuera de alcance

- Crear un motor CRDT.
- Reemplazar el centro de conflictos clínicos.
- Resolver automáticamente estados `needs_review` o `unsafe`.
- Rediseñar observabilidad o exportar reportes paciente-céntricos.

Esta ADR limita el PR a visibilidad y recuperación operacional de bajo riesgo.
