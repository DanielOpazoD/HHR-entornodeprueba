# ADR: DebouncedInput preserva intent del usuario en multi-tab

**Estado:** Vigente

## Contexto

`src/components/ui/DebouncedInput.tsx` es el input compartido para todas
las celdas editables del censo (diagnóstico, nombre, RUT, especialidad,
etc.). Su contrato original:

- Mantiene `localValue` mientras el usuario tipea.
- En blur o tras `debounceMs` ms de quietud, despacha `onChange(localValue)`.
- Mientras está focused, NO acepta cambios de la prop `value` para no
  perder el cursor / lo que el usuario está tipeando.

Este contrato producía un bug silencioso de truncamiento del diagnóstico
en uso multi-pestaña (ver `fcbfbfbc fix(census): stop multi-tab
DebouncedInput from pushing stale text on blur`).

## El bug

1. Pestaña B tiene una celda de diagnóstico focuseada (`document.activeElement`).
2. El usuario cambia a pestaña A. El browser **NO dispara blur** sobre la
   celda en B; el input sigue focused dentro del documento de B.
3. En A, el usuario escribe el diagnóstico completo y se guarda → Firestore
   recibe el valor largo.
4. La suscripción entrega el valor largo a B → la prop `value` se actualiza
   pero `localValue` se preserva (contrato "while focused don't overwrite").
5. Horas después el usuario vuelve a B, hace click en otra parte → blur
   se dispara con `localValue` aún en el snapshot viejo.
6. El handler antiguo hacía `onChange(localValue)` cada vez que
   `localValue !== value` → push del valor viejo a Firestore → diagnóstico
   queda silenciosamente truncado.

## Decisión

`DebouncedInput.handleBlur` solo despacha el push si el usuario **realmente
editó** durante esta sesión de focus. Trackeado vía `hasUserEditedRef`:

- `handleFocus` resetea el ref a `false`.
- `handleChange` lo setea a `true`.
- `handleBlur`:
  - Si `hasUserEditedRef.current && localValue !== value` → push real
    (intent del usuario gana).
  - Si `!hasUserEditedRef.current && localValue !== value` → adopta el
    valor remoto (la divergencia vino de afuera mientras estábamos focuseados;
    no es nuestro intent).

```ts
const hasUserEditedRef = useRef(false);

const handleChange = (e) => {
  setLocalValue(e.target.value);
  hasUserEditedRef.current = true;
  ...
};

const handleFocus = () => {
  setIsFocused(true);
  hasUserEditedRef.current = false;
};

const handleBlur = () => {
  setIsFocused(false);
  if (hasUserEditedRef.current && localValue !== value) {
    onChange(localValue);
  } else if (localValue !== value) {
    setLocalValue(value);  // adopt remote
  }
  hasUserEditedRef.current = false;
};
```

## Cobertura

`src/tests/components/ui/DebouncedInput.test.tsx` incluye un spec que
reproduce **exactamente el escenario multi-tab** y verifica que sin edit
del usuario el blur no pisa el valor remoto.

## Implicancia para componentes derivados

Cualquier input que actúe como DebouncedInput (write-back en blur con
preservación de localValue mientras focused) debe seguir el mismo
patrón si convive con suscripciones remotas que pueden actualizar la prop
`value` en background. Hoy `DebouncedInput` es el único componente con
ese contrato; futuros derivados deben heredar el guard de `hasUserEdited`.

## Motivo

El bug es invisible al desarrollador local (no se reproduce sin
multi-pestaña real) y silencioso al usuario (el truncamiento no muestra
banner de error). Sin un guard explícito, cualquier futura recurrencia se
vuelve a colar.

## Consecuencia

- El contrato de `DebouncedInput` es ahora **edit-aware**: solo escribe lo
  que el usuario tipeó esta vez.
- Esto NO afecta el escenario single-tab: si el usuario edita y blurrea,
  el push se dispara igual que antes.
- Un futuro refactor del componente debe mantener este guard. Si se
  rediseña la API hacia un hook puro (`useDebouncedField`), trasladar la
  invariante.
