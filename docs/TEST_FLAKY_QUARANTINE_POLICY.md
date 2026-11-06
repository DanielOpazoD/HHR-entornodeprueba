# Política de cuarentena de tests flaky

Cómo y cuándo usar `scripts/config/flaky-quarantine.json`. El objetivo es desbloquear el pipeline ante un flake real **sin convertir la cuarentena en un basurero permanente**.

## Medir antes de decidir

`npm run report:ci-reruns -- --days 7` lista los intentos de `CI/CD Pipeline` que fallaron y
pasaron al reintentar el mismo commit, agrupados por job y por prueba (o por el primer paso
fallido cuando no hay prueba). Solo lee con `gh api`; `--json` da el detalle con los mensajes.

## Cuándo cuarentenar

Usar **sólo** si se cumplen las tres condiciones:

1. El test **falla de forma no reproducible** (pasa >50% de los reruns locales).
2. El fallo **bloquea una merge/release legítima** — no pura incomodidad local.
3. El mantenedor ya abrió un issue/PR de investigación o tiene un plan escrito.

**No cuarentenar** si:

- El test falla por un bug real del código. Arregla el bug.
- El test es lento pero correcto. Optimízalo o mueve a smoke.
- No hay owner dispuesto a mirarlo. Elimina el test o arregla el código en el mismo PR.

## Cómo cuarentenar

1. Edita `scripts/config/flaky-quarantine.json` y añade una entrada:

   ```json
   {
     "quarantined": [
       {
         "file": "src/tests/integration/sync-resilience.test.ts",
         "owner": "daniel.opazo",
         "sla": "2026-05-15",
         "reason": "Race condition con firestore emulator; investigación en #NN"
       }
     ]
   }
   ```

2. Campos obligatorios (validados por `check:flaky-quarantine`):
   - `file`: ruta relativa al repo. El check falla si no existe.
   - `owner`: persona que debe resolverlo.
   - `sla`: **YYYY-MM-DD, ≤ 30 días en el futuro**. El check **falla si la SLA vence** — eso obliga a decidir.
   - `reason`: 1-2 líneas explicando la hipótesis y el link a issue/PR.

3. El test puede dejar de ejecutarse agregando un `.skip` o etiquetándolo, pero la entrada de cuarentena **no skipa automáticamente** — el check solo lleva la contabilidad. El skip es decisión explícita del owner.

4. Commit separado. El título del commit debe empezar por `test(quarantine):`.

## Cuándo salir de cuarentena

- Antes del SLA, idealmente. Si la SLA vence, `check:flaky-quarantine` bloquea CI — **esa es la feature**.
- Salir requiere:
  1. Eliminar la entrada de `flaky-quarantine.json`.
  2. Eliminar cualquier `.skip` en el test.
  3. Verificar 3 corridas locales seguidas sin fallos antes de merge.

## Límites duros

- Máximo **5 entradas activas** simultáneas. Si se llega a ese número, el backlog es el problema — no meter más tests en cuarentena hasta vaciar.
- SLA máxima: **30 días**. Extender una SLA requiere un comentario del owner explicando por qué no se pudo resolver.

## Qué valida el check

`scripts/check-flaky-quarantine.mjs`:

- JSON válido con `quarantined: []`.
- Cada entrada tiene los 4 campos no vacíos.
- El archivo referenciado existe.
- `sla` es fecha válida y **no ha vencido**.

Se ejecuta en `npm run check:quality` (CI merge gate).
