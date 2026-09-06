# `src/features/clinical-library`

## Propósito

Biblioteca de documentos y herramientas clínicas del censo diario. Un botón «Documentos» en la
barra de fechas abre un panel lateral con:

- **Formularios** locales listos para imprimir o completar (PDF, DOCX).
- **Protocolos** e **infografías** del Servicio de Hospitalizados (categorías preparadas; se
  publican agregando archivos y entradas al catálogo).
- **Herramientas** que funcionan sin conexión: dilución y velocidad de infusión, cálculo de dosis y
  antropometría, y scores clínicos (qSOFA, Glasgow, CURB-65, Wells TEP, Padua, CHA₂DS₂-VASc).

El módulo **no persiste nada** y **no contiene datos de pacientes**: el catálogo es estático y vive
en el repositorio; las calculadoras operan sólo con lo que se escribe en el formulario.

## Estructura

```text
clinical-library/
├── components/
│   ├── ClinicalLibraryQuickAction.tsx   # botón de la barra de fechas (carga el panel bajo demanda)
│   ├── ClinicalLibraryDrawer.tsx        # panel lateral: búsqueda, categorías, lista y herramientas
│   ├── LibraryEntryList.tsx             # agrupación por categoría, tarjetas y estados vacíos
│   ├── LibraryDocumentCard.tsx          # abrir / imprimir / descargar un documento
│   ├── libraryPresentation.ts           # etiquetas, formato de tamaños y números es-CL
│   └── tools/                           # InfusionCalculatorTool, DosingCalculatorTool, ScoresTool
├── domain/
│   ├── libraryCatalog.ts                # catálogo (documentos + herramientas) y categorías
│   ├── librarySearch.ts                 # búsqueda sin tildes, filtros y agrupación
│   ├── infusionCalculator.ts            # mL/h ⇄ dosis (mg, mcg, UI; por kg; por min u hora)
│   ├── infusionPresets.ts               # diluciones de referencia y rangos habituales
│   ├── doseCalculator.ts                # Devine, peso ajustado, IMC, Mosteller, Cockcroft-Gault
│   ├── scoreEngine.ts                   # motor declarativo de scores
│   └── scoreDefinitions.ts              # definiciones con puntos de corte y referencia
├── services/libraryDocumentActions.ts   # abrir en pestaña nueva, imprimir por iframe, href codificado
├── public.ts · index.ts · quick-action.ts
```

## Cómo agregar un documento

1. Copiar el archivo a `public/docs/biblioteca/` (PDF, DOCX o imagen). Esa carpeta queda fuera del
   precache de la PWA, igual que `public/docs/` y `public/templates/`.
2. Agregar una entrada en `domain/libraryCatalog.ts` con `category` (`forms`, `protocols` o
   `infographics`), `format`, `url`, `sizeKb`, `pages` y `keywords`.
3. Correr `npx vitest run src/tests/features/clinical-library/libraryCatalog.test.ts`: el test
   verifica que el archivo exista, que el tamaño declarado coincida y que no haya identificadores de
   pacientes en el catálogo.

Sólo publicar formularios en blanco o material institucional: el repositorio es público.

## Cómo agregar un score

Los scores son datos, no componentes: agregar una `ScoreDefinition` en `domain/scoreDefinitions.ts`
con ítems booleanos o de elección, bandas contiguas de interpretación y referencia con DOI. El test
`scoreDefinitions.test.ts` comprueba que las bandas cubran todos los totales alcanzables.

## Reglas

- Las herramientas muestran siempre el aviso de apoyo a la decisión clínica y la referencia.
- Las diluciones de referencia son orientativas: la interfaz pide confirmar con el protocolo local y
  farmacia, y avisa cuando una dosis queda fuera del rango habitual del fármaco.
- Consumo externo sólo por `@/features/clinical-library` (o `quick-action` desde el shell
  autenticado, declarado en `scripts/feature-public-api-allowlist.json`).
