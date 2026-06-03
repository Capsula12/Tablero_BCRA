/* =============================================================================
   Sucursales y dependencias — página completa.
   ============================================================================= */
(function () {
  "use strict";

  UI.mountTopbar("sucursales");
  UI.mountFooter();

  const STATE_KEY = "bcra.sucursales.state";
  const state = loadState() || {
    alias: "NACION",
    mesStr: null,           // YYYY-MM seleccionado para mapa+resumen
    mapMode: "choropleth",  // "choropleth" | "osm"
    distScope: "auto",      // "auto" | "provincia" | "pba_partido"
    tsAliases: [],
    tsFromMes: null,
    tsToMes: null,
    tsCats: null,           // null => default = all 4
    tsCompare: false,
  };
  function loadState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY)); } catch { return null; }
  }
  function saveState() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch {}
  }

  // ----- DOM
  const entityHost = document.getElementById("entity-picker");
  const monthHost  = document.getElementById("month-picker");
  const metaEl     = document.getElementById("suc-meta");
  const statusEl   = document.getElementById("suc-status");
  const mapEl      = document.getElementById("suc-map");
  const choroplethEl = document.getElementById("suc-choropleth");
  const mapWrapEl  = document.querySelector(".suc-map-wrap");
  const legendEl   = document.getElementById("map-legend");
  const mapNoteEl  = document.getElementById("map-month-note");
  const mapFootNote = document.getElementById("map-foot-note");
  const mapModeToggle = document.getElementById("map-mode-toggle");
  const kpisEl     = document.getElementById("suc-kpis");
  const distChartEl = document.getElementById("dist-chart");
  const distToggleHost = document.getElementById("dist-toggle");
  const tsRangeHost = document.getElementById("ts-range");
  const tsEntHost   = document.getElementById("ts-entities");
  const tsCatHost   = document.getElementById("ts-cats");
  const tsChartEl   = document.getElementById("ts-chart");
  const tsCompareEl = document.getElementById("ts-compare");

  // ----- UI components state
  let entityCombo = null;
  let monthCombo  = null;
  let distSegment = null;
  let mapModeSeg = null;
  let tsRangeSlider = null;
  let tsEntMulti = null;
  let tsCatMulti = null;
  let argentinaGeo = null;   // cache del GeoJSON de provincias

  // ----- Leaflet — mapa interactivo (puntos OSM)
  let map = null;
  let markerGroups = null;       // { sucursal: L.markerClusterGroup, ... }
  let allLocations = [];         // todas las locations del alias seleccionado en el snapshot
  let snapshotMesStr = "";       // mes del snapshot del mapa
  let categoryVisibility = { sucursal: true, cajero: true, terminal_autoservicio: true, dependencia_automatizada: true, operatoria_restringida: true };
  // ----- Leaflet — choropleth (distribución por provincia)
  let choroMap = null;           // mapa principal de Argentina
  let choroLayer = null;         // capa GeoJSON con las 24 provincias
  let choroCabaMap = null;       // mini-mapa inset con CABA
  let choroCabaLayer = null;

  function setStatus(msg, type = "info") {
    if (!msg) { statusEl.classList.add("hidden"); statusEl.textContent = ""; return; }
    statusEl.className = `notice ${type}`;
    statusEl.textContent = msg;
  }

  // -------- init ----------
  (async function init() {
    UI.showLoading("Cargando datos de casas...");
    try {
      const [nomina, months, ubi] = await Promise.all([
        BCRA.loadNomina(),
        CASAS.listMonths(),
        CASAS.loadUbicacionesLatest(),
      ]);

      if (!months.length) {
        setStatus("No encontré data/casas_serie_mensual.csv.", "error");
        UI.hideLoading();
        return;
      }
      snapshotMesStr = ubi.mesStr || months[months.length - 1];

      // -------- Entity combo (single)
      const entOpts = nomina
        .map((n) => ({
          value: n.alias,
          label: n.alias + (n.grupo_homogeneo === "GRUPO" ? " · grupo" : ""),
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
      if (!entOpts.find((o) => o.value === state.alias)) {
        const naci = entOpts.find((o) => /NACION|NACIÓN/.test(o.value));
        state.alias = naci ? naci.value : entOpts[0].value;
      }
      entityCombo = UI.combobox(entityHost, entOpts, {
        selected: state.alias,
        placeholder: "Buscar entidad o grupo...",
        onChange: (v) => { state.alias = v; saveState(); refreshMap(); refreshKPIs(); refreshDist(); },
      });

      // -------- Month combo (single, descending)
      const monthOpts = months.slice().reverse().map((m) => ({ value: m, label: m }));
      if (!state.mesStr || !monthOpts.find((o) => o.value === state.mesStr)) {
        state.mesStr = monthOpts[0].value;
      }
      monthCombo = UI.combobox(monthHost, monthOpts, {
        selected: state.mesStr,
        placeholder: "Buscar mes...",
        onChange: (v) => {
          state.mesStr = v; saveState();
          updateMapNote();
          refreshKPIs(); refreshDist();
          // El choropleth depende del mes; el OSM no (sólo snapshot).
          if (state.mapMode === "choropleth") refreshMap();
        },
      });

      // -------- Distribution scope segmented (Provincia / Partido PBA / Auto)
      distSegment = UI.segmented(distToggleHost, [
        { value: "auto", label: "Auto" },
        { value: "provincia", label: "Por provincia" },
        { value: "pba_partido", label: "PBA por partido" },
      ], { selected: state.distScope, onChange: (v) => { state.distScope = v; saveState(); refreshDist(); } });

      // -------- Map mode segmented (Choropleth provincia / OSM puntos)
      mapModeSeg = UI.segmented(mapModeToggle, [
        { value: "choropleth", label: "Distribución por provincia" },
        { value: "osm", label: "Mapa interactivo" },
      ], { selected: state.mapMode, onChange: (v) => { state.mapMode = v; saveState(); applyMapMode(); refreshMap(); } });

      // -------- Time-series range slider (uses yyyymm ints)
      const ymInts = months.map(mesToInt);
      // default: last 60 months
      const defFrom = ymInts[Math.max(0, ymInts.length - 60)];
      const defTo   = ymInts[ymInts.length - 1];
      if (!state.tsFromMes || !ymInts.includes(state.tsFromMes)) state.tsFromMes = defFrom;
      if (!state.tsToMes || !ymInts.includes(state.tsToMes)) state.tsToMes = defTo;

      tsRangeSlider = UI.dateRangeSlider(tsRangeHost, ymInts, {
        from: state.tsFromMes,
        to: state.tsToMes,
        onChange: ({ from, to }) => { state.tsFromMes = from; state.tsToMes = to; saveState(); refreshTS(); },
      });

      // -------- TS entities multiselect
      if (!state.tsAliases || !state.tsAliases.length) state.tsAliases = [state.alias];
      tsEntMulti = UI.multiselect(tsEntHost, entOpts, {
        selected: state.tsAliases,
        placeholder: "Buscar entidad o grupo...",
        onChange: (vals) => { state.tsAliases = vals; saveState(); refreshTS(); },
      });

      // -------- TS categories multiselect
      const catOpts = CASAS.CATEGORIES.map((c) => ({ value: c, label: CASAS.CATEGORY_LABEL[c] }));
      if (!state.tsCats || !state.tsCats.length) state.tsCats = CASAS.CATEGORIES.slice();
      tsCatMulti = UI.multiselect(tsCatHost, catOpts, {
        selected: state.tsCats,
        placeholder: "Buscar categoría...",
        onChange: (vals) => { state.tsCats = vals.length ? vals : CASAS.CATEGORIES.slice(); saveState(); refreshTS(); },
      });

      // -------- Compare checkbox
      tsCompareEl.checked = !!state.tsCompare;
      tsCompareEl.addEventListener("change", () => { state.tsCompare = !!tsCompareEl.checked; saveState(); refreshTS(); });

      // -------- Build the map once
      initMap();
      applyMapMode();
      updateMapNote();
      await refreshMap();
      await refreshKPIs();
      await refreshDist();
      await refreshTS();
      UI.hideLoading();
    } catch (e) {
      console.error(e);
      setStatus("Error inicializando: " + e.message, "error");
      UI.hideLoading();
    }
  })();

  function updateMapNote() {
    if (!snapshotMesStr) { mapNoteEl.textContent = ""; return; }
    if (state.mesStr === snapshotMesStr) {
      mapNoteEl.textContent = `Mapa y resumen muestran el snapshot ${snapshotMesStr}.`;
    } else {
      mapNoteEl.innerHTML = `El mapa muestra el snapshot disponible <strong>${UI.escapeHtml(snapshotMesStr)}</strong>; el resumen y la distribución usan el mes seleccionado (<strong>${UI.escapeHtml(state.mesStr)}</strong>).`;
    }
  }

  // ===========================================================================
  // MAPA
  // ===========================================================================
  function initMap() {
    // Bounds que encierran Argentina (lat sur a norte; lon oeste a este).
    const ARG_BOUNDS = [[-55.5, -73.6], [-21.5, -53.6]];
    map = L.map(mapEl, {
      zoomControl: true,
      scrollWheelZoom: true,
      // Sin maxBounds → el usuario puede pan-ear libremente fuera de
      // Argentina (la base IGN cubre el mundo entero a baja resolución).
      minZoom: 2,                            // permite alejarse hasta ver Sudamérica completa
    });
    map.fitBounds(ARG_BOUNDS, { padding: [10, 10] });
    // Control custom "↺ Centrar Argentina" en la esquina superior izquierda
    // (debajo del zoom). Re-encuadra el mapa al rectángulo del país.
    const RecenterControl = L.Control.extend({
      options: { position: "topleft" },
      onAdd: function () {
        const btn = L.DomUtil.create("a", "leaflet-control-recenter leaflet-bar leaflet-control");
        btn.href = "#";
        btn.title = "Centrar Argentina";
        btn.setAttribute("role", "button");
        btn.innerHTML = "↺";
        L.DomEvent.on(btn, "click", (e) => {
          L.DomEvent.preventDefault(e);
          map.fitBounds(ARG_BOUNDS, { padding: [10, 10] });
        });
        L.DomEvent.disableClickPropagation(btn);
        return btn;
      },
    });
    new RecenterControl().addTo(map);
    // Base IGN Argentina (ArgenMap) — cartografía oficial del Instituto
    // Geográfico Nacional. Usamos esta en vez de OpenStreetMap porque OSM
    // rotula el archipiélago como "Falkland Islands"; IGN lo rotula
    // correctamente como "Islas Malvinas (ARG)". El endpoint es TMS (Y
    // invertida); usamos el placeholder `{-y}` en la URL en lugar de la
    // opción `tms: true` porque, en pruebas con Leaflet 1.9.4, esta forma
    // carga tiles correctamente en todos los niveles de zoom (con
    // `tms: true` el layer no creaba <img> al zoomear a z=2).
    L.tileLayer(
      "https://wms.ign.gob.ar/geoserver/gwc/service/tms/1.0.0/capabaseargenmap@EPSG:3857@png/{z}/{x}/{-y}.png",
      {
        attribution: "© <a href=\"https://www.ign.gob.ar/\" target=\"_blank\" rel=\"noopener\">IGN Argentina</a> · ArgenMap",
        maxZoom: 18,
        minZoom: 2,
        noWrap: true,
      }
    ).addTo(map);

    markerGroups = {};
    for (const c of CASAS.CATEGORIES) {
      markerGroups[c] = L.markerClusterGroup({
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        disableClusteringAtZoom: 11,
        chunkedLoading: true,
        maxClusterRadius: 50,
        iconCreateFunction: makeClusterIconFactory(CASAS.CATEGORY_COLOR[c]),
      });
      map.addLayer(markerGroups[c]);
    }
  }

  function makeClusterIconFactory(color) {
    return function (cluster) {
      const n = cluster.getChildCount();
      const size = n < 10 ? 28 : n < 100 ? 34 : n < 500 ? 40 : 48;
      const html = `<div style="background:${color};color:#fff;width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:600;border:3px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.3);font-size:12px">${n}</div>`;
      return L.divIcon({ html, className: "casa-cluster", iconSize: [size, size] });
    };
  }

  function makeMarkerIcon(color) {
    return L.divIcon({
      className: "casa-marker",
      html: `<div style="background:${color};width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.3)"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
  }

  function applyMapMode() {
    if (!mapWrapEl) return;
    mapWrapEl.classList.toggle("mode-osm", state.mapMode === "osm");
    mapWrapEl.classList.toggle("mode-choropleth", state.mapMode === "choropleth");
    // La leyenda ahora vive afuera del .suc-map-wrap → la mostramos/ocultamos
    // directamente. Sólo aplica al modo "Mapa interactivo".
    if (legendEl) legendEl.hidden = state.mapMode !== "osm";
    // Invalidar size de los mapas Leaflet al cambiar de modo — sin esto,
    // el mapa que estaba escondido renderea con dimensiones cero.
    if (state.mapMode === "osm" && map) {
      setTimeout(() => map.invalidateSize(), 50);
    }
    if (state.mapMode === "choropleth" && choroMap) {
      setTimeout(() => {
        choroMap.invalidateSize();
        if (choroCabaMap) choroCabaMap.invalidateSize();
        if (choroLayer) choroMap.fitBounds(choroLayer.getBounds(), { padding: [8, 8] });
        if (choroCabaLayer) choroCabaMap.fitBounds(choroCabaLayer.getBounds(), { padding: [3, 3] });
      }, 50);
    }
  }

  async function refreshMap() {
    if (state.mapMode === "osm") {
      await refreshOSM();
    } else {
      await refreshChoropleth();
    }
  }

  async function refreshOSM() {
    if (!map) return;
    // Reset markers
    for (const c of CASAS.CATEGORIES) markerGroups[c].clearLayers();

    const [ubi, nomina] = await Promise.all([
      CASAS.loadUbicacionesLatest(),
      BCRA.loadNomina(),
    ]);
    // codigo_entidad → { alias, entidad } para enriquecer el popup con el
    // nombre de la entidad (no viene en casas_ubicaciones_latest.csv).
    const entityByCode = new Map();
    for (const n of nomina) {
      if (!n.codigo_entidad || n.codigo_entidad.startsWith("AA") || n.codigo_entidad.startsWith("GRP_")) continue;
      entityByCode.set(n.codigo_entidad, { alias: n.alias || "", entidad: n.entidad || "" });
    }
    const codes = new Set(await CASAS.resolveMemberCodes(state.alias));
    const counts = { sucursal: 0, cajero: 0, terminal_autoservicio: 0, dependencia_automatizada: 0, operatoria_restringida: 0 };
    const located = { sucursal: 0, cajero: 0, terminal_autoservicio: 0, dependencia_automatizada: 0, operatoria_restringida: 0 };
    const filtered = [];
    for (const r of ubi.rows) {
      if (!codes.has(r.codigo_entidad)) continue;
      const cat = r.categoria;
      if (!(cat in counts)) continue;
      counts[cat]++;
      if (r.latitud != null && r.longitud != null && r.latitud !== 0 && r.longitud !== 0) {
        located[cat]++;
        filtered.push(r);
      }
    }
    allLocations = filtered;

    for (const r of filtered) {
      const color = CASAS.CATEGORY_COLOR[r.categoria];
      const icon = makeMarkerIcon(color);
      const marker = L.marker([r.latitud, r.longitud], { icon });
      const ent = entityByCode.get(r.codigo_entidad) || { alias: "", entidad: "" };
      // Mostramos alias destacado + razón social completa abajo (si difieren).
      const aliasLabel = ent.alias || ent.entidad || r.codigo_entidad;
      const fullLabel = ent.entidad && ent.entidad.toUpperCase() !== aliasLabel.toUpperCase() ? ent.entidad : "";
      const popup = `
        <div>
          <div class="pop-entity"><span class="pop-tag" style="background:${color}">${UI.escapeHtml(CASAS.CATEGORY_LABEL_SHORT[r.categoria])}</span><b>${UI.escapeHtml(aliasLabel)}</b></div>
          ${fullLabel ? `<div class="muted small pop-ent-full">${UI.escapeHtml(fullLabel)}</div>` : ""}
          <div class="pop-suc"><b>${UI.escapeHtml(r.denominacion || r.tipo_filial || "(sin denominación)")}</b></div>
          <span class="muted small">${UI.escapeHtml(r.tipo_filial || "")}</span><br>
          ${UI.escapeHtml(r.direccion || "")}<br>
          ${UI.escapeHtml(r.localidad || "")}${r.partido ? ` — ${UI.escapeHtml(r.partido)}` : ""}<br>
          <span class="muted small">${UI.escapeHtml(r.provincia || "")}</span>
        </div>`;
      marker.bindPopup(popup);
      markerGroups[r.categoria].addLayer(marker);
    }

    renderLegend(counts, located);
    mapFootNote.innerHTML = state.mesStr === snapshotMesStr
      ? `Mapa interactivo del snapshot <strong>${UI.escapeHtml(snapshotMesStr)}</strong>. ${filtered.length.toLocaleString("es-AR")} puntos.`
      : `El mapa interactivo sólo dispone del snapshot disponible <strong>${UI.escapeHtml(snapshotMesStr)}</strong>; el resumen y la distribución sí cambian con el mes. Para ver provincias mes a mes, usá la vista "Distribución por provincia".`;
  }

  async function loadArgentinaGeo() {
    if (argentinaGeo) return argentinaGeo;
    const res = await fetch("data/argentina_provincias.geo.json");
    argentinaGeo = await res.json();
    return argentinaGeo;
  }

  // ===========================================================================
  // Choropleth — implementación basada en Leaflet (NO Plotly).
  //
  // Por qué: Plotly choropleth viene fallando en este caso — aún con bordes
  // explícitos y colorscale agresiva, el mapa rendereado quedaba con
  // provincias indistinguibles del fondo (probablemente por el rendering
  // SVG/Canvas de Plotly + interacción con los stops continuos). Pasamos a
  // Leaflet + L.geoJSON donde cada provincia es un <path> con `fillColor`,
  // `color` (stroke) y `weight` explícitos — sin sorpresas de rendering.
  //
  // Layout: contenedor padre #suc-choropleth tiene dos hijos:
  //   #choro-main   — mapa principal Argentina (24 provincias) ocupa el
  //                   ancho disponible
  //   #choro-caba   — inset cuadrado en la esquina superior derecha,
  //                   absoluto, sólo con CABA
  // Y un panel #choro-legend con los 7 buckets de color.
  // ===========================================================================
  // Bins discretos estilo mapa electoral. Cada provincia cae en un único
  // bucket (no se interpola). Son fracciones del máximo de la entidad, así
  // la escala se adapta: NACION (max ~200) y un banco chico (max ~20) usan
  // los mismos cortes relativos.
  const CHORO_BIN_COLORS = [
    "#e5e7eb", // 0:      gris muy claro (sin presencia)
    "#bbf7d0", // <5%:    verde muy claro
    "#4ade80", // 5-15%:  verde
    "#eab308", // 15-30%: amarillo
    "#f97316", // 30-55%: naranja
    "#dc2626", // 55-80%: rojo
    "#7f1d1d", // ≥80%:   rojo oscuro
  ];
  const CHORO_BIN_BREAKS = [0.0001, 0.05, 0.15, 0.30, 0.55, 0.80];
  const CHORO_BIN_LABELS = ["0 (sin presencia)", "< 5%", "5–15%", "15–30%", "30–55%", "55–80%", "≥ 80%"];

  function pickBin(value, zMax) {
    if (zMax <= 0 || !Number.isFinite(value)) return 0;
    const frac = value / zMax;
    let bin = 0;
    for (let i = 0; i < CHORO_BIN_BREAKS.length; i++) {
      if (frac >= CHORO_BIN_BREAKS[i]) bin = i + 1;
    }
    return bin;
  }

  function buildChoroContainers() {
    // Replace #suc-choropleth content with our own structure once.
    if (choroplethEl.querySelector("#choro-main")) return;
    choroplethEl.innerHTML = `
      <div id="choro-main"></div>
      <div id="choro-caba-wrap">
        <div class="choro-caba-label">CABA</div>
        <div id="choro-caba"></div>
      </div>
      <div id="choro-legend" class="choro-legend"></div>`;
  }

  function initChoroMaps(geo) {
    // Main map — sin tiles base. Sólo polygons.
    if (!choroMap) {
      choroMap = L.map(document.getElementById("choro-main"), {
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        dragging: false,
        boxZoom: false,
        keyboard: false,
        touchZoom: false,
      });
    }
    if (!choroCabaMap) {
      choroCabaMap = L.map(document.getElementById("choro-caba"), {
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        dragging: false,
        boxZoom: false,
        keyboard: false,
        touchZoom: false,
      });
    }
  }

  function styleFor(provName, sucMap, zMax) {
    const v = sucMap.get(provName) || 0;
    const bin = pickBin(v, zMax);
    return {
      fillColor: CHORO_BIN_COLORS[bin],
      fillOpacity: 1,
      color: "#0f172a",     // borde oscuro
      weight: 1.2,
      opacity: 1,
    };
  }

  function tooltipFor(provName, sucMap, breakdown) {
    const suc = sucMap.get(provName) || 0;
    return `
      <div class="choro-tip">
        <div class="choro-tip-head">${UI.escapeHtml(provName)}</div>
        <div class="choro-tip-suc">Sucursales: <b>${suc.toLocaleString("es-AR")}</b></div>
        <div class="choro-tip-bd">${breakdown(provName)}</div>
      </div>`;
  }

  async function refreshChoropleth() {
    const [geo, cur] = await Promise.all([
      loadArgentinaGeo(),
      CASAS.getResumen(state.alias, state.mesStr),
    ]);

    // Asegurar contenedores y mapas Leaflet.
    buildChoroContainers();
    initChoroMaps(geo);

    // Datos: coloreamos por sucursales (la categoría sucursal únicamente).
    const sucMap = cur.porProvincia.get("sucursal") || new Map();
    const provNames = geo.features.map((f) => f.properties.provincia);
    const z = provNames.map((p) => sucMap.get(p) || 0);
    const zMax = Math.max(1, ...z);

    function breakdown(p) {
      const parts = [];
      for (const cat of CASAS.CATEGORIES) {
        const m = cur.porProvincia.get(cat);
        const v = m ? (m.get(p) || 0) : 0;
        if (v > 0) parts.push(`${CASAS.CATEGORY_LABEL_SHORT[cat]}: ${v.toLocaleString("es-AR")}`);
      }
      return parts.length ? parts.join("<br>") : "<span style='color:#94a3b8'>(sin presencia)</span>";
    }

    // ----- Main map: 23 provincias (todo salvo CABA) -------------------------
    const mainGeo = {
      type: "FeatureCollection",
      features: geo.features.filter((f) => f.properties.provincia !== "CABA"),
    };
    if (choroLayer) choroMap.removeLayer(choroLayer);
    choroLayer = L.geoJSON(mainGeo, {
      style: (f) => styleFor(f.properties.provincia, sucMap, zMax),
      onEachFeature: (f, layer) => {
        layer.bindTooltip(tooltipFor(f.properties.provincia, sucMap, breakdown), {
          sticky: true,
          direction: "top",
          className: "choro-tooltip",
          offset: [0, -6],
        });
        layer.on("mouseover", (e) => e.target.setStyle({ weight: 2.5, color: "#000" }).bringToFront());
        layer.on("mouseout",  (e) => choroLayer.resetStyle(e.target));
      },
    }).addTo(choroMap);
    choroMap.fitBounds(choroLayer.getBounds(), { padding: [8, 8] });

    // ----- CABA inset --------------------------------------------------------
    const cabaGeo = {
      type: "FeatureCollection",
      features: geo.features.filter((f) => f.properties.provincia === "CABA"),
    };
    if (choroCabaLayer) choroCabaMap.removeLayer(choroCabaLayer);
    choroCabaLayer = L.geoJSON(cabaGeo, {
      style: (f) => Object.assign(styleFor(f.properties.provincia, sucMap, zMax), { weight: 1.4 }),
      onEachFeature: (f, layer) => {
        layer.bindTooltip(tooltipFor(f.properties.provincia, sucMap, breakdown), {
          sticky: true,
          direction: "top",
          className: "choro-tooltip",
        });
      },
    }).addTo(choroCabaMap);
    choroCabaMap.fitBounds(choroCabaLayer.getBounds(), { padding: [3, 3] });

    // ----- Leyenda -----------------------------------------------------------
    const legendEl2 = document.getElementById("choro-legend");
    const labels = CHORO_BIN_LABELS.map((lbl, i) => {
      const v = i === 0 ? 0 : Math.round(CHORO_BIN_BREAKS[i - 1] * zMax);
      const vNext = i === CHORO_BIN_LABELS.length - 1 ? zMax : Math.round(CHORO_BIN_BREAKS[i] * zMax) - 1;
      const range = i === 0 ? "0" : (vNext > v ? `${v.toLocaleString("es-AR")}–${vNext.toLocaleString("es-AR")}` : `${v.toLocaleString("es-AR")}`);
      return `<div class="choro-legend-row">
        <span class="choro-legend-swatch" style="background:${CHORO_BIN_COLORS[i]}"></span>
        <span class="choro-legend-range">${range}</span>
      </div>`;
    }).join("");
    legendEl2.innerHTML = `<div class="choro-legend-title">Sucursales</div>${labels}`;

    // ----- Foot note ---------------------------------------------------------
    const total = z.reduce((a, b) => a + b, 0);
    const maxProv = z.reduce((acc, v, i) => (v > acc.v ? { v, p: provNames[i] } : acc), { v: -1, p: "" });
    const maxNote = maxProv.v > 0 ? ` · pico en <strong>${UI.escapeHtml(maxProv.p)}</strong> (${maxProv.v.toLocaleString("es-AR")})` : "";
    mapFootNote.innerHTML = `Mapa coloreado por <strong>cantidad de sucursales</strong> · escala 0 a ${zMax.toLocaleString("es-AR")} · <strong>${UI.escapeHtml(state.alias)}</strong> · <strong>${UI.escapeHtml(state.mesStr)}</strong> · total país ${total.toLocaleString("es-AR")} sucursales${maxNote}. CABA se muestra ampliada arriba a la derecha. El hover trae el desglose por categoría.`;

    // Importante: recalcular el tamaño del map cuando el contenedor cambia
    // (ej. al alternar modos). Sin esto, Leaflet renderea con dimensiones
    // viejas y queda gris.
    setTimeout(() => {
      choroMap && choroMap.invalidateSize();
      choroCabaMap && choroCabaMap.invalidateSize();
      if (choroLayer) choroMap.fitBounds(choroLayer.getBounds(), { padding: [8, 8] });
      if (choroCabaLayer) choroCabaMap.fitBounds(choroCabaLayer.getBounds(), { padding: [3, 3] });
    }, 50);
  }

  function renderLegend(counts, located) {
    const rows = CASAS.CATEGORIES.map((c) => {
      const color = CASAS.CATEGORY_COLOR[c];
      const off = categoryVisibility[c] ? "" : "off";
      const label = CASAS.CATEGORY_LABEL[c];
      const cnt = counts[c] || 0;
      const loc = located[c] || 0;
      return `
        <label class="legend-row ${off}" data-cat="${c}">
          <input type="checkbox" ${categoryVisibility[c] ? "checked" : ""}>
          <span class="dot" style="background:${color}"></span>
          <span class="legend-label">${label}</span>
          <span class="legend-count" title="puntos ubicados / total">${loc.toLocaleString("es-AR")} / ${cnt.toLocaleString("es-AR")}</span>
        </label>`;
    }).join("");
    legendEl.innerHTML = `<h4>Capas</h4>${rows}`;
    legendEl.querySelectorAll(".legend-row").forEach((row) => {
      const cat = row.getAttribute("data-cat");
      row.querySelector("input").addEventListener("change", (e) => {
        const checked = !!e.target.checked;
        categoryVisibility[cat] = checked;
        row.classList.toggle("off", !checked);
        if (checked) map.addLayer(markerGroups[cat]);
        else map.removeLayer(markerGroups[cat]);
      });
    });
  }

  // ===========================================================================
  // KPI cards (Panel-like)
  // ===========================================================================
  async function refreshKPIs() {
    kpisEl.innerHTML = "";
    const months = await CASAS.listMonths();
    const monthsAsc = months.slice();
    const idx = monthsAsc.indexOf(state.mesStr);
    const prevMesStr = idx > 0 ? monthsAsc[idx - 1] : null;
    const prevYMes = (() => {
      const y = parseInt(state.mesStr.slice(0, 4), 10) - 1;
      const m = state.mesStr.slice(5);
      const cand = `${y}-${m}`;
      return monthsAsc.includes(cand) ? cand : null;
    })();

    const [cur, prevM, prevY] = await Promise.all([
      CASAS.getResumen(state.alias, state.mesStr),
      prevMesStr ? CASAS.getResumen(state.alias, prevMesStr) : Promise.resolve(null),
      prevYMes ? CASAS.getResumen(state.alias, prevYMes) : Promise.resolve(null),
    ]);

    metaEl.textContent = `${state.alias} · ${state.mesStr}`;

    for (const cat of CASAS.CATEGORIES) {
      const val = cur.total[cat] || 0;
      const prevMVal = prevM ? (prevM.total[cat] || 0) : null;
      const prevYVal = prevY ? (prevY.total[cat] || 0) : null;
      const dm = prevMVal != null && prevMVal !== 0 ? ((val - prevMVal) / prevMVal * 100) : null;
      const dy = prevYVal != null && prevYVal !== 0 ? ((val - prevYVal) / prevYVal * 100) : null;
      const dmText = formatDeltaPct(dm);
      const dyText = formatDeltaPct(dy);
      const dmAbs  = prevMVal != null ? (val - prevMVal) : null;
      const dyAbs  = prevYVal != null ? (val - prevYVal) : null;

      const card = document.createElement("div");
      card.className = "mini-card";
      card.innerHTML = `
        <div class="mc-origen" style="background:${CASAS.CATEGORY_COLOR[cat]}22;color:${CASAS.CATEGORY_COLOR[cat]}">${UI.escapeHtml(CASAS.CATEGORY_LABEL_SHORT[cat])}</div>
        <div class="mc-title">${UI.escapeHtml(CASAS.CATEGORY_LABEL[cat])}</div>
        <div class="mc-stats" style="border-top:none;padding-top:0">
          <div class="mc-actual" style="font-size:32px">${val.toLocaleString("es-AR")}</div>
          <div class="mc-deltas">
            <span><span class="delta-label">vs mes ant.:</span> <span class="delta ${dmText.cls}">${dmText.text}${dmAbs != null ? ` <small class="muted">(${fmtSigned(dmAbs)})</small>` : ""}</span></span>
            <span><span class="delta-label">vs año ant.:</span> <span class="delta ${dyText.cls}">${dyText.text}${dyAbs != null ? ` <small class="muted">(${fmtSigned(dyAbs)})</small>` : ""}</span></span>
          </div>
        </div>`;
      kpisEl.appendChild(card);
    }

    // Tarjeta destacada: "Sucursales + anexos" (factor combinado = sucursales
    // plenas + operatoria restringida + dependencias automatizadas). Mismo
    // criterio que el indicador casas 991000006 que viaja por Panel/Ranking.
    const comboVal  = comboTotal(cur);
    const comboPrevM = prevM ? comboTotal(prevM) : null;
    const comboPrevY = prevY ? comboTotal(prevY) : null;
    const cdm = comboPrevM != null && comboPrevM !== 0 ? ((comboVal - comboPrevM) / comboPrevM * 100) : null;
    const cdy = comboPrevY != null && comboPrevY !== 0 ? ((comboVal - comboPrevY) / comboPrevY * 100) : null;
    const cdmText = formatDeltaPct(cdm);
    const cdyText = formatDeltaPct(cdy);
    const cdmAbs = comboPrevM != null ? (comboVal - comboPrevM) : null;
    const cdyAbs = comboPrevY != null ? (comboVal - comboPrevY) : null;
    const comboCard = document.createElement("div");
    comboCard.className = "mini-card kpi-combo";
    comboCard.innerHTML = `
      <div class="mc-origen" style="background:${COMBO_COLOR}22;color:${COMBO_COLOR}">Suc. + anexos</div>
      <div class="mc-title">${UI.escapeHtml(COMBO_LABEL_FULL)}</div>
      <div class="mc-stats" style="border-top:none;padding-top:0">
        <div class="mc-actual" style="font-size:32px">${comboVal.toLocaleString("es-AR")}</div>
        <div class="mc-deltas">
          <span><span class="delta-label">vs mes ant.:</span> <span class="delta ${cdmText.cls}">${cdmText.text}${cdmAbs != null ? ` <small class="muted">(${fmtSigned(cdmAbs)})</small>` : ""}</span></span>
          <span><span class="delta-label">vs año ant.:</span> <span class="delta ${cdyText.cls}">${cdyText.text}${cdyAbs != null ? ` <small class="muted">(${fmtSigned(cdyAbs)})</small>` : ""}</span></span>
        </div>
      </div>`;
    kpisEl.insertBefore(comboCard, kpisEl.firstChild);
  }

  // Factor combinado "Sucursales + anexos": suma de sucursales plenas +
  // operatoria restringida + dependencias automatizadas (excluye cajeros y TA).
  const COMBO_CATS = ["sucursal", "operatoria_restringida", "dependencia_automatizada"];
  const COMBO_COLOR = "#0f766e";
  const COMBO_LABEL_FULL = "Sucursales + anexos (suc. + op. restringida + dependencias)";
  function comboTotal(resumen) {
    return COMBO_CATS.reduce((s, c) => s + (resumen.total[c] || 0), 0);
  }

  function fmtSigned(n) { return (n > 0 ? "+" : "") + n.toLocaleString("es-AR"); }
  function formatDeltaPct(v) {
    if (v == null || !Number.isFinite(v)) return { text: "—", cls: "delta-na" };
    const sign = v > 0 ? "+" : "";
    const cls = v > 0 ? "delta-pos" : v < 0 ? "delta-neg" : "delta-zero";
    return { text: `${sign}${v.toFixed(1)}%`, cls };
  }

  // ===========================================================================
  // Distribution chart
  // ===========================================================================
  async function refreshDist() {
    const cur = await CASAS.getResumen(state.alias, state.mesStr);
    // ¿modo provincia o partido PBA?
    let mode = state.distScope;
    if (mode === "auto") {
      // Si la entidad concentra >50% en PBA, mostrar partidos
      const totSucPBA = cur.porProvincia.get("sucursal")?.get("BUENOS AIRES") || 0;
      const totSuc = cur.total["sucursal"] || 0;
      mode = (totSuc > 0 && totSucPBA / totSuc > 0.5) ? "pba_partido" : "provincia";
    }

    let labels = [];
    let traceData = {};  // {categoria: [counts aligned to labels]}
    for (const c of CASAS.CATEGORIES) traceData[c] = [];

    if (mode === "pba_partido") {
      // PBA por partido — sumar contribución de todas las categorías a partido
      const partTotals = new Map();
      for (const c of CASAS.CATEGORIES) {
        const m = cur.porPartidoPBA.get(c);
        if (!m) continue;
        for (const [k, v] of m) partTotals.set(k, (partTotals.get(k) || 0) + v);
      }
      labels = Array.from(partTotals.keys()).sort((a, b) => partTotals.get(b) - partTotals.get(a)).slice(0, 40);
      for (const lab of labels) {
        for (const c of CASAS.CATEGORIES) {
          const m = cur.porPartidoPBA.get(c);
          traceData[c].push(m ? (m.get(lab) || 0) : 0);
        }
      }
    } else {
      // Por provincia
      const provTotals = new Map();
      for (const c of CASAS.CATEGORIES) {
        const m = cur.porProvincia.get(c);
        if (!m) continue;
        for (const [k, v] of m) provTotals.set(k, (provTotals.get(k) || 0) + v);
      }
      labels = Array.from(provTotals.keys()).sort((a, b) => provTotals.get(b) - provTotals.get(a));
      for (const lab of labels) {
        for (const c of CASAS.CATEGORIES) {
          const m = cur.porProvincia.get(c);
          traceData[c].push(m ? (m.get(lab) || 0) : 0);
        }
      }
    }

    if (!labels.length) {
      Plotly.purge(distChartEl);
      distChartEl.innerHTML = `<div class="muted" style="padding:60px;text-align:center">Sin datos de distribución para ${UI.escapeHtml(state.alias)} en ${UI.escapeHtml(state.mesStr)}.</div>`;
      return;
    }

    const traces = CASAS.CATEGORIES.map((c) => ({
      x: labels,
      y: traceData[c],
      name: CASAS.CATEGORY_LABEL_SHORT[c],
      type: "bar",
      marker: { color: CASAS.CATEGORY_COLOR[c] },
      hovertemplate: `<b>%{x}</b><br>${CASAS.CATEGORY_LABEL[c]}: %{y:,}<extra></extra>`,
    }));

    const layout = JSON.parse(JSON.stringify(UI.PLOTLY_LAYOUT));
    layout.barmode = "stack";
    layout.margin = { l: 50, r: 18, t: 14, b: 110 };
    layout.xaxis = Object.assign({}, layout.xaxis, {
      tickangle: -45, automargin: true,
      title: { text: mode === "pba_partido" ? "Partido (PBA)" : "Provincia", font: { color: "#64748b" } },
    });
    layout.yaxis = Object.assign({}, layout.yaxis, {
      title: { text: "Cantidad", font: { color: "#64748b" } },
      tickformat: ",d",
    });
    Plotly.newPlot(distChartEl, traces, layout, UI.PLOTLY_CONFIG);
  }

  // ===========================================================================
  // Evolución mensual (time series)
  // ===========================================================================
  async function refreshTS() {
    if (!state.tsAliases.length) {
      Plotly.purge(tsChartEl);
      tsChartEl.innerHTML = `<div class="muted" style="padding:60px;text-align:center">Seleccioná al menos una entidad.</div>`;
      return;
    }
    const cats = state.tsCats && state.tsCats.length ? state.tsCats : CASAS.CATEGORIES.slice();
    const months = await CASAS.listMonths();
    const fromStr = intToMes(state.tsFromMes);
    const toStr   = intToMes(state.tsToMes);
    const series = await CASAS.getTimeSeries(state.tsAliases, cats, fromStr, toStr);

    if (!series.length) {
      Plotly.purge(tsChartEl);
      tsChartEl.innerHTML = `<div class="muted" style="padding:60px;text-align:center">Sin datos en el rango seleccionado.</div>`;
      return;
    }

    const traces = [];
    let colorIdx = 0;
    for (const s of series) {
      const pts = state.tsCompare ? CASAS.indexToBase100(s.points) : CASAS.sanitizePoints(s.points);
      const xs = pts.map((p) => p.mes_str);
      const ys = pts.map((p) => p.value);
      const label = `${s.alias} · ${CASAS.CATEGORY_LABEL_SHORT[s.categoria]}`;
      // Dash pattern por categoría para distinguir cuando hay múltiples entidades
      const dash = ({ sucursal: "solid", cajero: "dot", terminal_autoservicio: "dash", dependencia_automatizada: "dashdot", operatoria_restringida: "longdash" })[s.categoria] || "solid";
      // Color por entidad (asignamos un color por alias, no por categoría, para distinguir bancos);
      // si hay 1 sola entidad y varias categorías, sí coloreamos por categoría.
      let color;
      if (state.tsAliases.length === 1) {
        color = CASAS.CATEGORY_COLOR[s.categoria];
      } else {
        const aliasIdx = state.tsAliases.indexOf(s.alias);
        color = UI.colorFor(aliasIdx);
      }
      traces.push({
        x: xs, y: ys,
        type: "scatter", mode: "lines+markers",
        name: label,
        line: { color, width: 2, dash },
        marker: { size: 4, color },
        hovertemplate: `<b>${label}</b><br>%{x}<br>` + (state.tsCompare ? "Índice: %{y:.1f}" : "Cantidad: %{y:,.0f}") + "<extra></extra>",
        connectgaps: true,
      });
      colorIdx++;
    }

    const layout = JSON.parse(JSON.stringify(UI.PLOTLY_LAYOUT));
    layout.margin = { l: 60, r: 18, t: 14, b: 70 };
    layout.xaxis = Object.assign({}, layout.xaxis, { title: { text: "Fecha", font: { color: "#64748b" } } });
    layout.yaxis = Object.assign({}, layout.yaxis, {
      title: { text: state.tsCompare ? "Índice (100 = primer mes)" : "Cantidad", font: { color: "#64748b" } },
      tickformat: state.tsCompare ? ".1f" : ",d",
    });
    layout.legend = Object.assign({}, layout.legend, { orientation: "h", y: -0.18 });
    Plotly.newPlot(tsChartEl, traces, layout, UI.PLOTLY_CONFIG);
  }

  // ----- helpers --------------------------------------------------------
  function mesToInt(s) {
    const [y, m] = String(s).split("-");
    return parseInt(y, 10) * 100 + parseInt(m, 10);
  }
  function intToMes(n) {
    if (n == null) return null;
    const y = Math.floor(n / 100);
    const m = String(n % 100).padStart(2, "0");
    return `${y}-${m}`;
  }
})();
