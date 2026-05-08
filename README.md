# Tablero BCRA — Análisis del sistema financiero argentino

Tablero web 100% estático para explorar variables del sistema financiero argentino (BCRA) por entidad o por grupo, en moneda nominal o homogénea (deflactada con IPC INDEC). No hay backend ni build step: el sitio se sirve tal cual desde GitHub Pages y todo el cómputo (filtrado, agregaciones, indicadores derivados, deflactor, rankings) corre en el navegador.

- **Sitio público**: <https://capsula12.github.io/Tablero_BCRA/>
- **Datos**: descargas mensuales del BCRA (`balres`, `indicad`, `inf_adi`) + IPC INDEC, ya normalizados a CSV.
- **Repo origen del pipeline** (privado): `Capsula12/DATASETBCRA` — ahí viven los scripts que producen los CSV de `data/`.

---

## Pantallas

| Pantalla | Para qué sirve |
|---|---|
| [Inicio](index.html) | KPIs del dataset y links a las pantallas. |
| [Panel](panel.html) | Mini-tablero por entidad: 12 indicadores con sparkline y deltas mes-a-mes / interanual. |
| [Series](series.html) | Compará un mismo indicador en varias entidades a lo largo del tiempo. |
| [Calculadora](calc.html) | Construí fórmulas combinando indicadores con operadores y paréntesis. |
| [Ranking](ranking.html) | Top N de entidades por valor del mes, variación interanual y variación mensual. |

Toggle global **Moneda homogénea (IPC INDEC)** en la topbar — deflacta los nominales en pesos a precios del último mes con IPC.

### Selectores de período

| Pantalla | Tipo de selector | Componente JS |
|---|---|---|
| Series, Calculadora | **Range slider** con dos thumbs (estilo Streamlit) + shortcuts (`Último año`, `3 años`, `5 años`, `Todo`) | `UI.dateRangeSlider` |
| Panel, Ranking | Combobox con búsqueda (un solo mes) | `UI.combobox` |

El range slider soporta teclado: ← / → = ±1 mes; ↑ / ↓ idem; **PageUp / PageDown = ±12 meses**; Home/End = bordes. Drag-and-drop con mouse o toque. Click sobre la barra mueve el thumb más cercano. (Para Panel y Ranking se usa combobox y no slider porque ahí solo se elige UN mes — el slider de un solo thumb agrega complejidad sin valor.)

---

## Estructura del repo

```
Tablero_BCRA/
├─ index.html  panel.html  series.html  calc.html  ranking.html
├─ .nojekyll                              # evita procesamiento Jekyll en GitHub Pages
├─ assets/
│  ├─ css/
│  │  ├─ style.css                        # tema CLARO (single source of truth de tokens), layout responsive
│  │  └─ ranking.css                      # estilos puntuales de la pantalla Ranking (consume los tokens de style.css)
│  └─ js/
│     ├─ data.js                          # capa de datos (CSV → memoria, IPC, derived, grupos)
│     ├─ ui.js                            # combobox, multiselect, topbar, helpers Plotly
│     ├─ panel.js  series.js  calc.js
│     └─ ranking.js
│
├─ data/                                  # CSVs versionados — los lee el cliente con PapaParse
│  ├─ dataset_normalizado_YYYY.csv        # particionado por año (2015..2026)
│  ├─ bcra_nomina.csv                     # codigo_entidad → nombre, alias, grupo_homogeneo
│  ├─ diccionario_datos.csv               # catálogo de indicadores (formato, origen, homogeneizable)
│  ├─ derived_indicators.csv              # indicadores derivados (VAL/VAL0/DIFF/DIV0)
│  ├─ group_entities.csv                  # composición de grupos (ABA, ADEBA, ABAPPRA, …)
│  ├─ aggregations.csv                    # cómo agrega cada indicador en grupos (sum/mean/weighted_mean)
│  ├─ ipc_indec_nacional_nivel_general.csv  # IPC INDEC para moneda homogénea
│  ├─ detalle_datos.csv                   # texto largo "Más info" por indicador
│  └─ _manifest.json                      # lista de años disponibles para la carga lazy
│
└─ .github/workflows/
   └─ deploy-pages.yml                    # publica el sitio en cada push a main
```

---

## Diseño / sistema visual

El tablero usa un **tema claro** (light), con paleta y tipografía pensadas para dashboards analíticos (referencias: Stripe, Linear, Vercel, Tableau). Todos los tokens viven como custom properties en `:root` dentro de `assets/css/style.css` — para retocar la paleta cambiá los tokens, **no toques los componentes**.

### Tokens principales (`assets/css/style.css :root`)

| Categoría | Token | Valor | Uso |
|---|---|---|---|
| Fondo | `--bg` | `#f5f7fb` | fondo de página |
| Fondo | `--bg-2` | `#eef2f7` | code, formula display, help-body |
| Superficie | `--surface` | `#ffffff` | cards, inputs, dropdowns |
| Superficie | `--surface-2` | `#f8fafc` | hover, table headers, combo-search |
| Superficie | `--surface-3` | `#eef2f7` | seg-control track, hover en options |
| Borde | `--border` / `--border-strong` | `#e2e8f0` / `#cbd5e1` | bordes default / hover |
| Brand | `--primary` / `--primary-soft` | `#2563eb` / `#1d4ed8` (blue-600/700) | acento principal |
| Brand | `--primary-tint` | `#eff6ff` | fondos suaves (chips, hover de nav, ranking de columna activa) |
| Brand | `--accent` / `--accent-tint` | `#7c3aed` / `#f5f3ff` | acento secundario (gradientes, group-tag, formula op) |
| Semántico | `--success` / `--danger` / `--warning` | `#15803d` / `#dc2626` / `#b45309` | deltas, notices |
| Texto | `--text` / `--text-soft` / `--text-muted` / `--text-dim` | `#0f172a` / `#334155` / `#64748b` / `#94a3b8` | jerarquía slate-900 → slate-400 |

### Tipografía

- Stack: `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, ...` (system-first; si `Inter` está instalado o cacheado se usa, si no cae al sans serif del SO).
- Base: `14.5px / 1.55`. KPIs `26px`. `h1` page title `26px`, hero `42px` con `letter-spacing: -1.2px`.
- Números siempre con `font-variant-numeric: tabular-nums` y/o `var(--font-mono)` para que las columnas alineen en tablas y deltas.

### Componentes (clases preservadas — no renombrar)

`.app-shell` → `.topbar` + `.container` + `.footer`. `.card` (`.padded`, `.padded-lg`, `.card-header`, `.card-title`, `.card-body`). `.filters` (grid 12-col en ≥900px, span via `.f-3 .f-4 .f-5 .f-6 .f-8 .f-12`). Form: `.input`, `.select`, `.btn` (`.primary` / `.ghost` / `.danger` / `.icon`), `.checkbox`. Datos: `.kpi`, `.mini-card`, `table.data` + `.table-wrap`. Específicos del tablero: `.multiselect` + `.combo` (custom UI en `ui.js`), `.range-slider` (dual-thumb, también `.single` en `dateMonthSlider`), `.seg-control`, `.ind-detail-card`, `.formula-display`, `.feature-card` (landing). Notices: `.notice` + `.warn` / `.error` / `.info`. Loader: `.loading-overlay` + `.spinner` + `.inline-loader`.

### Plotly (charts)

Defaults centralizados en `UI.PLOTLY_LAYOUT` (`assets/js/ui.js`) — fondo transparente, grids `#e2e8f0`, ticks `#475569`, hoverlabel blanco con borde `#cbd5e1`. La paleta de series es `UI.COLORS` (15 colores saturados, color-blind-friendly-ish, todos con buen contraste sobre blanco). Las páginas (`panel.js`, `series.js`, `calc.js`) clonan el layout default y sólo overridean lo específico (títulos de ejes, márgenes). **Si agregás un chart nuevo, partí siempre de `JSON.parse(JSON.stringify(UI.PLOTLY_LAYOUT))` — no hardcodees colores ni la fuente.**

### Reglas para mantener consistencia

1. Cualquier color visible en pantalla tiene que venir de un token (`var(--xxx)`). No usar hex literales en CSS salvo en el SVG inline del caret del `.select` y la flecha del icono.
2. Los chips, tags y "tints" usan el patrón `tint background + border al 20-25% del color base + texto en la versión `-soft`/`-700`` para legibilidad sobre claro.
3. Sombras siempre vía las cuatro escalas (`--shadow-xs/sm/md/lg`). Los cards default usan `--shadow-xs`; el hover sube a `--shadow-sm` o `--shadow-md`; los dropdowns usan `--shadow-lg`.
4. Para porcentajes / variaciones: `delta-pos` (verde) / `delta-neg` (rojo) / `delta-zero|na` (gris) — definidos en `style.css` y usados en Panel y Ranking.
5. **No agregar dependencias de fuentes externas** (Google Fonts, etc.) — el sistema tipográfico funciona 100% sin red. `Inter` está sólo como first-choice del stack.

---

## Cómo correrlo en local

No hace falta build ni Node. Cualquier servidor estático sirve:

```bash
python -m http.server 8765 --bind 127.0.0.1
# ⇒ http://127.0.0.1:8765/
```

Abrir `index.html` directamente con `file://` no funciona porque PapaParse usa `fetch` para los CSV.

---

## Cómo funciona la capa de datos

- **Carga lazy**: el cliente lee `data/_manifest.json` para saber qué años están disponibles, y descarga `dataset_normalizado_YYYY.csv` recién cuando una pantalla los pide. Panel descarga sólo el año del rango; Series, Calculadora y Ranking descargan los años del período seleccionado.
- **Schema de los CSV anuales** (UTF-8 con BOM):

  | Columna | Tipo | Descripción |
  |---|---|---|
  | `codigo_entidad` | string(5) zfill | `"00011"` (NACION) |
  | `descripcion_entidad` | string | razón social del mes |
  | `codigo_dato` | int | ej. `100010000000` |
  | `descripcion_dato` | string | descripción humana |
  | `valor_dato` | float | valor del mes (pesos nominales si aplica) |
  | `formato` | `N` o `P` | N = numérico, P = porcentaje |
  | `año` `mes` `mes_str` | | partición temporal |
  | `origen` | `balres` / `indicad` / `inf_adi` | reporte BCRA de origen |

- **Reglas de limpieza** (al consultar, no en disco):
  1. Valores `0.00` se reemplazan por el del mes anterior (forward-fill).
  2. Outliers de porcentaje con `valor_dato > 99000` se descartan.
  3. Los indicadores `derived` se computan al vuelo desde `derived_indicators.csv`.
  4. Los grupos `GRP_<id>` se calculan al vuelo según `aggregations.csv`.

- **Estado por pantalla** persiste en `localStorage` con keys `bcra.panel.state`, `bcra.series.state`, `bcra.calc.state`, `bcra.ranking.state` (el toggle de moneda homogénea queda en `bcra.moneda_homog`).

- **Dependencias CDN**: PapaParse 5.4.1 + Plotly 2.27.0 (cargadas vía `<script>` en cada HTML).

---

## Pantalla Ranking

Tabla **única sortable** (estilo planilla) con todas las entidades del indicador y mes elegidos. Cada fila trae:

| `#` | `Entidad` | `Valor` | `Var. anual` | `Var. mensual` |

Tocando un encabezado se ordena por esa columna; volverlo a tocar invierte la dirección. La columna activa queda resaltada con flecha `▲` / `▼`. Las entidades con dato faltante en la métrica de orden quedan al final (no contaminan el top).

Controles:
- **Indicador**: combo con búsqueda. El default es ROE (`indicad/800010400010`).
- **Mes**: combo con búsqueda en orden descendente (último mes primero).
- **Mostrar top**: límite de filas visibles (3–200, default 20). El orden se aplica a *toda* la población antes de cortar.
- **Universo de entidades**: **segmented control** (estilo radio inline) con dos opciones:
  - `Todas + grupos` (default) — incluye entidades reales + agregados nativos del BCRA (`AA*`: TOTAL SISTEMA FINANCIERO, BANCOS PUBLICOS, BANCOS PRIVADOS, 10 PRIMEROS BANCOS PRIVADOS, etc.) + grupos custom (`GRP_*`: ABA, ABE, ADEBA, ABAPPRA, MACRO E ITAU, ABAPPRA CON NACION).
  - `Solo entidades` — filtra **tanto** `AA*` **como** `GRP_*`, dejando solamente entidades individuales (lógica en `BCRA.isAnyGroupCode` en `assets/js/data.js`).
- **Detalle del indicador**: tarjeta que aparece automáticamente debajo de los filtros con la descripción larga del indicador activo (texto leído de `data/detalle_datos.csv` por `UI.getDetalleText`). Reemplaza al campo de búsqueda por entidad que existía antes.
- **Moneda homogénea** (toggle global de la topbar): si está activo, el ranking corre sobre valores deflactados con IPC.
- **Descargar CSV (vista actual)**: exporta exactamente lo que se ve (orden y top aplicados) con columnas `posicion, codigo_entidad, alias, es_grupo, mes_referencia, valor_actual, mes_anterior, valor_mes_anterior, anio_anterior, valor_anio_anterior, variacion_interanual, variacion_mensual, unidad_variacion, ordenado_por, direccion`.

Detalles de cálculo:
- Variaciones en `pp` para indicadores `P` (porcentaje) y en `%` sobre el valor previo para indicadores `N`.
- Var. interanual = `valor_T` vs `valor_T-12`. Var. mensual = `valor_T` vs `valor_T-1`.
- Estado persiste en `localStorage` con clave `bcra.ranking.state` (incluye `sortKey`, `sortDir`, `topN`, `includeGroups`, `indKey`, `refYM`).

---

## Deploy

> ⚠️ **El sitio público se sirve desde la branch `HTML`, NO desde `main`.** Cualquier cambio (HTML/CSS/JS/data) tiene que terminar en `HTML` para que GitHub Pages lo publique. Si pusheás sólo a `main`, el sitio en `https://capsula12.github.io/Tablero_BCRA/` queda desactualizado.

Flujo recomendado:

```bash
# Trabajar siempre sobre la branch HTML
git checkout HTML
git pull --ff-only

# ...editar archivos...

git add -A
git commit -m "feat: ..."
git push origin HTML

# (opcional) mantener main alineado con HTML para que el repo se vea ordenado
git checkout main
git merge --ff-only HTML
git push origin main
```

El workflow [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) está configurado para disparar en pushes tanto a `HTML` como a `main`, así que cualquiera de las dos rutas reconstruye Pages — pero **la branch canónica es `HTML`**.

Para configurar Pages la primera vez:
- Settings → Pages → "Build and deployment: Source = GitHub Actions" (default branch: `HTML`).

Importante: el script [`scripts/sync_tablero.py`](https://github.com/Capsula12/DATASETBCRA/blob/main/scripts/sync_tablero.py) del repo de datos hace `git commit` / `git push` **sobre la branch que esté checkouted** en `Tablero_BCRA/`. Antes de correrlo con `--push`, asegurate de tener `HTML` activa en el clon local.

---

## Sincronización con el repo de datos

Los CSV de `data/` se generan en el repo privado `Capsula12/DATASETBCRA` (pipeline mensual: descarga del BCRA + IPC INDEC + normalización). Cuando se publica un dataset nuevo, los CSV viajan a este repo público (manualmente o vía workflow) y GitHub Pages reconstruye automáticamente.

El repo privado tiene además un frontend Streamlit con autenticación que consume los mismos CSV.

---

## Convenciones

- Códigos de entidad **siempre** zero-padded a 5 dígitos (`pad5()` en JS).
- Encoding `utf-8-sig` (con BOM) en CSVs de configuración; el código tolera ambos.
- Para sumar un indicador derivado nuevo: agregar fila a `data/derived_indicators.csv` con `codigo_dato,descripcion_dato,formato,rule`. La `rule` admite `VAL(origen:codigo)`, `VAL0(...)` (NaN→0), `DIFF(...)` (mes a mes), `DIV0(num,den)` y aritmética básica.
- Para sumar un grupo nuevo (ABA, ADEBA, etc.): agregar filas a `data/group_entities.csv` y, si el método de agregación no es el default (`mean` para `P`, `sum` para `N`), una fila a `data/aggregations.csv`.
- Cuando agregás un indicador (regular o **derivado** vía `data/derived_indicators.csv`), sumá también una fila en `data/detalle_datos.csv` (`codigo_dato,descripcion_dato,detalle_dato`) con una explicación que **enfatice el significado de las variaciones** ("una suba indica X; una baja indica Y"). El detalle se busca por `codigo_dato` (no por origen), así los derivados (`9900xxxxx`) tienen su propia fila. Esto alimenta los `<details class="help">` (Panel/Series/Calc) y la tarjeta de detalle automática del Ranking.

### Universo de entidades — códigos especiales

Hay tres "tipos" de `codigo_entidad`:

| Patrón | Origen | Ejemplos | Filtrado por... |
|---|---|---|---|
| `00xxx` (5 dígitos) | Entidad real (banco, CF, caja) | `00011` (NACION), `00007` (GALICIA) | siempre incluida |
| `AAxxx` (`AA000`, `AA110`, ...) | Agregado nativo del BCRA | `AA000` (TOTAL SISTEMA FINANCIERO), `AA110` (BANCOS PUBLICOS), `AA120` (BANCOS PRIVADOS) | excluida por `BCRA.isAnyGroupCode` cuando se elige "Solo entidades" |
| `GRP_<id>` | Grupo custom calculado al vuelo desde `data/group_entities.csv` | `GRP_ABA`, `GRP_ADEBA` | excluida por `BCRA.isAnyGroupCode` o `BCRA.isGroupCode` |

`isGroupCode` solo detecta `GRP_*`; usar `isAnyGroupCode` cuando querés filtrar **todos** los agregados (custom + nativos del BCRA), como hace el toggle "Solo entidades" del Ranking.

---

## Stakeholders / referencias

- Sitio público: <https://capsula12.github.io/Tablero_BCRA/>
- Repo de datos / pipeline: <https://github.com/Capsula12/DATASETBCRA> (privado)
- Fuente BCRA: <https://www.bcra.gob.ar/PublicacionesEstadisticas/Entidades.asp>
- Fuente INDEC IPC: <https://www.indec.gob.ar/indec/web/Nivel4-Tema-3-5-31>
