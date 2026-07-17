# `src/features/cudyr`

## Propósito

Feature de categorización CUDYR para enfermería, con vista web, exportación y soporte de impresión/PDF para entrega de turno nocturno.

## Contratos relevantes

- `cudyrUpdatedAt`
  Último timestamp persistido cuando se modifica un puntaje CUDYR principal o de cuna clínica.

## Regla de presentación del tiempo CUDYR

- La web muestra `Últ. mod.` usando `cudyrUpdatedAt`.
- La web muestra además `cudyrUpdatedBy`; al completarse, conserva responsable y hora de cierre.
- El PDF de entrega de turno nocturno debe usar la fecha/hora fija de aplicación del instrumento nocturno (`día siguiente, 1:00 AM`).
- La tabla CUDYR incluida al final de la entrega de turno nocturna debe respetar la misma elegibilidad clínica, excluir cálculos para filas bloqueadas y reflejar también cunas clínicas elegibles.
- El formateo horario compartido se resuelve vía `formatTimeHHMM` en `src/utils/dateUtils.ts`.

## Regla de elegibilidad nocturna

- El instrumento nocturno usa como referencia fija las `01:00` del día siguiente al `record.date`.
- Solo se categoriza a pacientes con al menos `8` horas de hospitalización a ese corte.
- Ingresos del mismo `record.date` sin `admissionTime` se consideran elegibles por supuesto clínico conservador.
- Ingresos del día siguiente (`X + 1`) se bloquean para CUDYR aunque no exista `admissionTime`.
- Pacientes excluidos siguen visibles en la tabla, pero con nombre bloqueado y puntajes de solo lectura.

## Regla de edición

- Ya no existe botón manual de `Bloqueado/Desbloqueado` en la UI CUDYR.
- El CUDYR pertenece a la fecha de inicio del turno noche: turno del día `D` va de `20:00 D` a `08:00 D + 1`.
- Una medición realizada durante la mañana siguiente (`00:01`–`11:59`) se persiste en el registro `D`, aunque una sincronización diferida se ejecute después o con el censo `D + 1` visible.
- Eloísa es la fuente autoritativa del CUDYR importado: una sincronización reemplaza una copia histórica antigua o mal fechada; no se limita a completar casillas vacías.
- HHR permite completar durante `D + 1` la sincronización pendiente del registro `D`; la hora de sincronización no cambia la fecha dueña.
- La fecha dueña viaja en la mutación (`shiftDate = record.date`) y nunca se recalcula desde la hora posterior de sincronización.
- Cuando todos los pacientes elegibles tienen sus 14 campos, el CUDYR queda cerrado y enfermería pasa a solo lectura.
- El controlador de mutación y los invariantes de conflicto impiden que una pestaña antigua de enfermería modifique o reabra un CUDYR ya cerrado.
- Un CUDYR completado no se corrige desde la grilla habitual; cualquier recuperación excepcional debe usar el flujo administrativo auditado de versiones.

## Visor del instrumento

- `Ver Instrumento CUDYR` abre el PDF dentro de un visor modal interno.
- No debe abrirse en una ventana externa salvo que cambie explícitamente el contrato de UX.
