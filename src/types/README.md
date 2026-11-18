# `src/types`

Tipos TypeScript de entidades, contratos y valores estables. Los tipos del dominio tienen un
solo hogar, `src/types/domain/*`, y se importan desde ahí con su nombre; una forma más
estrecha lleva nombre propio, sin alias ni reexportaciones por capa
(control de higiene del repositorio, en `check:quality`). Un tipo que usa una sola área o un solo hook va en esa área.
Dónde va cada cosa: [arquitectura](../../docs/architecture.md).

Nota de dominio: `domain/patient.ts` guarda para Ginecobstetricia `ginecobstetriciaType`
(`Obstétrica` o `Ginecológica`, sin cambiar la especialidad), `deliveryRoute` (`Vaginal` o
`Cesárea`) y, si aplica, `deliveryCesareanLabor` (`Sin TdP` o `Con TdP`; opcional, no
reemplaza `deliveryRoute`). Son datos clínicos persistidos: las abreviaturas de la UI (`GyO`,
`TMT`) no cambian el valor guardado.
