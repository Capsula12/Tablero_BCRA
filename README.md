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

---

## Estructura del repo

```
Tablero_BCRA/
├─ index.html  panel.html  series.html  calc.html  ranking.html
├─ .nojekyll                              # evita procesamiento Jekyll en GitHub Pages
├─ assets/
│  ├─ css/
│  │  ├─ style.css                        # tema oscuro, layout responsive
│  │  └─ ranking.css                      # estilos puntuales de la pantalla Ranking
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

Para un indicador y un mes de referencia, calcula tres rankings:

- **Top por valor**: las N entidades con el valor más alto en el mes seleccionado.
- **Top por variación interanual**: comparado contra el mismo mes del año anterior.
- **Top por variación mensual**: comparado contra el mes inmediato anterior.

Detalles:
- Para indicadores en porcentaje (formato `P`) las variaciones se muestran en **puntos porcentuales (pp)**.
- Para indicadores numéricos (`N`) se muestran en **% sobre el valor previo**.
- El campo "Top N" admite valores entre 3 y 50.
- El checkbox **Incluir grupos** suma las entidades-grupo (ABA, ADEBA, etc.) al universo. Por defecto está apagado para que no dominen los rankings.
- Si el toggle **Moneda homogénea** está activo, el ranking corre sobre valores deflactados.
- Botón **Descargar CSV** baja los tres rankings en un solo CSV largo con columnas `ranking, posicion, alias, valor_actual, valor_mes_anterior, valor_anio_anterior, variacion, unidad_variacion`.

---

## Deploy

GitHub Pages servido desde `main` mediante el workflow [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml). En cada push a `main` que toque HTML/JS/CSS/data se reconstruye el artefacto de Pages y se despliega.

Para configurar Pages la primera vez:
- Settings → Pages → "Build and deployment: Source = GitHub Actions".

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

---

## Stakeholders / referencias

- Sitio público: <https://capsula12.github.io/Tablero_BCRA/>
- Repo de datos / pipeline: <https://github.com/Capsula12/DATASETBCRA> (privado)
- Fuente BCRA: <https://www.bcra.gob.ar/PublicacionesEstadisticas/Entidades.asp>
- Fuente INDEC IPC: <https://www.indec.gob.ar/indec/web/Nivel4-Tema-3-5-31>
