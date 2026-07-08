# Daily Record Movement Tombstones

## Objetivo

Los movimientos del censo diario (`discharges`, `transfers`, `cma`) no deben eliminarse
fisicamente cuando el usuario borra o deshace un movimiento. Deben quedar marcados con
`deletedAt` para que un cliente antiguo o una cola local stale no pueda resucitarlos por
accidente.

## Contrato

Campos opcionales comunes:

- `deletedAt`: timestamp ISO que marca el borrado logico.
- `deletedBy`: actor opcional que ejecuto el borrado.
- `deletedReason`: motivo tecnico o funcional. El valor por defecto es `manual_delete`.

Un movimiento con `deletedAt`:

- se conserva en el snapshot persistido;
- no se muestra como movimiento activo en el censo;
- no debe contar en exportaciones, PDF, CSV, MINSAL ni agregados estadisticos;
- debe ganar contra snapshots antiguos en las politicas de merge del siguiente bloque.

## Identidad De Episodio Legacy

Mientras no exista `clinicalEpisodeId` persistido, el episodio se identifica asi:

1. si existe `admissionTime`, se usa `rut + admissionDate/firstSeenDate + admissionTime`;
2. si falta `admissionTime`, se mantiene el key legacy `rut + admissionDate/firstSeenDate`;
3. si tambien faltan fechas confiables, el sistema conserva el comportamiento legacy y debe
   tratar el caso como ambiguo.

Esto permite distinguir dos hospitalizaciones del mismo RUT en el mismo dia cuando la hora
esta disponible, sin romper documentos o registros historicos que ya usan el key antiguo.

## Siguiente Bloque

El PR siguiente debe usar estos tombstones en el merge anti-resurreccion y en el contrato
extensible de outbox (`syncContract`). La metrica esperada despues del bloque 1+2 es que
las reparaciones `daily_record_clinical_consistency` bajen de forma marcada.
