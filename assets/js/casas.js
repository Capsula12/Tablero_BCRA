/* =============================================================================
   Casas data layer — carga y agrupa la info de sucursales / cajeros / terminales
   y dependencias automatizadas que produce scripts/normalizar_casas.py.

   Archivos en data/:
     casas_ubicaciones_latest.csv   (snapshot: latest month, locations w/ lat/lon)
     casas_serie_mensual.csv        (conteos por entidad x mes x categoria x provincia + partido)

   Expone: window.CASAS
   ============================================================================= */
(function () {
  "use strict";

  const DATA_BASE = "data/";

  // Orden y nombres legibles de las cuatro categorías.
  const CATEGORIES = ["sucursal", "cajero", "terminal_autoservicio", "dependencia_automatizada", "operatoria_restringida"];
  const CATEGORY_LABEL = {
    sucursal: "Sucursales",
    cajero: "Cajeros (dentro y fuera de casas operativas)",
    terminal_autoservicio: "Terminales de autoservicio",
    dependencia_automatizada: "Dependencias automatizadas",
    operatoria_restringida: "Sucursales — operatoria restringida (prestación de determinadas actividades)",
  };
  const CATEGORY_LABEL_SHORT = {
    sucursal: "Sucursales",
    cajero: "Cajeros",
    terminal_autoservicio: "TA",
    dependencia_automatizada: "DA",
    operatoria_restringida: "Op. restringida",
  };
  // Colores de marcadores en mapa y barras / líneas en charts.
  const CATEGORY_COLOR = {
    sucursal: "#2563eb",                 // azul
    cajero: "#16a34a",                   // verde
    terminal_autoservicio: "#d97706",    // naranja
    dependencia_automatizada: "#7c3aed", // violeta
    operatoria_restringida: "#dc2626",   // rojo
  };

  const cache = {
    ubicacionesLatest: null,  // { mesStr: "YYYY-MM", rows: [...] }
    serieMensual: null,       // array de {codigo_entidad, año, mes, mes_str, categoria, provincia, partido, cantidad}
    serieIndex: null,         // Map: codigo_entidad -> Map: mes_str -> Map: categoria -> {provincias: Map<prov, Map<partido, cnt>>, total}
  };

  // -------------------------------------------------------------------------
  // CSV fetcher (Papa Parse)
  // -------------------------------------------------------------------------
  function fetchCSV(url, opts = {}) {
    return new Promise((resolve, reject) => {
      Papa.parse(url, {
        download: true,
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false,
        encoding: "utf-8",
        ...opts,
        complete: (res) => resolve(res.data),
        error: (err) => reject(err),
      });
    });
  }

  function pad5(s) {
    s = String(s || "").trim();
    while (s.length < 5) s = "0" + s;
    return s;
  }

  function normalizeRow(r) {
    const obj = {};
    for (const k of Object.keys(r)) {
      obj[String(k).replace(/^﻿/, "").toLowerCase().trim()] = r[k];
    }
    return obj;
  }

  async function loadUbicacionesLatest() {
    if (cache.ubicacionesLatest) return cache.ubicacionesLatest;
    const rawRows = await fetchCSV(DATA_BASE + "casas_ubicaciones_latest.csv");
    let mesStr = "";
    const cleaned = [];
    for (const raw of rawRows) {
      const r = normalizeRow(raw);
      const code = pad5(r.codigo_entidad);
      const ms = String(r.mes_str || "").trim();
      if (!code || !ms) continue;
      if (!mesStr) mesStr = ms;
      const lat = parseFloat(r.latitud);
      const lon = parseFloat(r.longitud);
      cleaned.push({
        codigo_entidad: code,
        mes_str: ms,
        categoria: String(r.categoria || "").trim(),
        tipo_filial: String(r.tipo_filial || "").trim(),
        denominacion: String(r.denominacion || "").trim(),
        direccion: String(r.direccion || "").trim(),
        localidad: String(r.localidad || "").trim(),
        partido: String(r.partido || "").trim(),
        provincia: String(r.provincia || "").trim(),
        latitud: Number.isFinite(lat) ? lat : null,
        longitud: Number.isFinite(lon) ? lon : null,
        cantidad_cajeros: parseInt(r.cantidad_cajeros, 10) || 0,
      });
    }
    cache.ubicacionesLatest = { mesStr, rows: cleaned };
    return cache.ubicacionesLatest;
  }

  async function loadSerieMensual() {
    if (cache.serieMensual) return cache.serieMensual;
    const rawRows = await fetchCSV(DATA_BASE + "casas_serie_mensual.csv");
    const cleaned = [];
    for (const raw of rawRows) {
      const r = normalizeRow(raw);
      const code = pad5(r.codigo_entidad);
      const ms = String(r.mes_str || "").trim();
      const cat = String(r.categoria || "").trim();
      const cantStr = String(r.cantidad || "").trim();
      const cant = parseInt(cantStr, 10);
      if (!code || !ms || !cat || !Number.isFinite(cant)) continue;
      cleaned.push({
        codigo_entidad: code,
        año: parseInt(r["año"] || r.anio || 0, 10),
        mes: parseInt(r.mes || 0, 10),
        mes_str: ms,
        categoria: cat,
        provincia: String(r.provincia || "").trim(),
        partido: String(r.partido || "").trim(),
        cantidad: cant,
      });
    }
    cache.serieMensual = cleaned;
    return cleaned;
  }

  /**
   * Devuelve un índice anidado para queries rápidas:
   *   index.get(codigo_entidad).get(mes_str).get(categoria) => {
   *     total: int,
   *     porProvincia: Map<provincia, int>,
   *     porPartidoPBA: Map<partido, int>,
   *   }
   */
  async function getSerieIndex() {
    if (cache.serieIndex) return cache.serieIndex;
    const rows = await loadSerieMensual();
    const idx = new Map();
    for (const r of rows) {
      let mEnt = idx.get(r.codigo_entidad);
      if (!mEnt) { mEnt = new Map(); idx.set(r.codigo_entidad, mEnt); }
      let mMes = mEnt.get(r.mes_str);
      if (!mMes) { mMes = new Map(); mEnt.set(r.mes_str, mMes); }
      let mCat = mMes.get(r.categoria);
      if (!mCat) {
        mCat = { total: 0, porProvincia: new Map(), porPartidoPBA: new Map() };
        mMes.set(r.categoria, mCat);
      }
      mCat.total += r.cantidad;
      const prov = r.provincia || "(SIN DATO)";
      mCat.porProvincia.set(prov, (mCat.porProvincia.get(prov) || 0) + r.cantidad);
      if (prov === "BUENOS AIRES" && r.partido) {
        mCat.porPartidoPBA.set(r.partido, (mCat.porPartidoPBA.get(r.partido) || 0) + r.cantidad);
      }
    }
    cache.serieIndex = idx;
    return idx;
  }

  /** Lista de meses únicos en la serie, ascendente (YYYY-MM). */
  async function listMonths() {
    const rows = await loadSerieMensual();
    const s = new Set(rows.map((r) => r.mes_str));
    return Array.from(s).sort();
  }

  /**
   * Para un alias de entidad (puede ser GRP_X o AAxxx) devuelve el array de codigo_entidad
   * que lo componen (sólo entidades 5-dígito; los AA se expanden a sus miembros).
   * Para una entidad común, el array tiene un único elemento.
   */
  async function resolveMemberCodes(alias) {
    const nomina = await BCRA.loadNomina();
    const ent = nomina.find((n) => n.alias === alias);
    if (!ent) return [];
    const code = ent.codigo_entidad;
    if (BCRA.isGroupCode(code)) {
      const { members } = await BCRA.loadGroupMaps();
      return members.get(code) || [];
    }
    if (code.startsWith("AA")) {
      // Expandir AA → todas las entidades 5-dígito cuyo grupo_homogeneo cae dentro de
      // la sub-jerarquía del AA. Si es AA000, devolver todas.
      const aaTree = buildAaTree(nomina);
      const descendantSet = aaTree.descendants[code] || new Set([code]);
      const memberCodes = [];
      for (const n of nomina) {
        const c = n.codigo_entidad;
        if (c.startsWith("AA") || c.startsWith("GRP_")) continue;
        if (descendantSet.has(n.grupo_homogeneo)) memberCodes.push(c);
        else if (code === "AA000") memberCodes.push(c);
      }
      return memberCodes;
    }
    return [code];
  }

  // Build a small AA hierarchy from the nomina (AAxxx entries hint at their parent
  // via grupo_homogeneo).
  let _aaTreeCache = null;
  function buildAaTree(nomina) {
    if (_aaTreeCache) return _aaTreeCache;
    const aaParent = {};
    for (const n of nomina) {
      if (n.codigo_entidad.startsWith("AA")) aaParent[n.codigo_entidad] = n.grupo_homogeneo;
    }
    const children = {};
    for (const aa in aaParent) {
      const p = aaParent[aa];
      if (!p) continue;
      if (!children[p]) children[p] = new Set();
      children[p].add(aa);
    }
    const descendants = {};
    for (const aa in aaParent) {
      const stack = [aa];
      const seen = new Set();
      while (stack.length) {
        const x = stack.pop();
        if (seen.has(x)) continue;
        seen.add(x);
        for (const c of (children[x] || [])) stack.push(c);
      }
      descendants[aa] = seen;
    }
    _aaTreeCache = { aaParent, children, descendants };
    return _aaTreeCache;
  }

  /**
   * Suma conteos para una entidad (alias) y un mes (YYYY-MM), por categoría.
   * Para grupos, agrega los miembros.
   * Retorna: { total: {sucursal:N, cajero:N, ...}, porProvincia: Map<categoria, Map<prov, N>>, porPartidoPBA: Map<categoria, Map<partido, N>> }
   */
  async function getResumen(alias, mesStr) {
    const idx = await getSerieIndex();
    const codes = await resolveMemberCodes(alias);
    const total = {}; for (const c of CATEGORIES) total[c] = 0;
    const porProvincia = new Map();
    const porPartidoPBA = new Map();
    for (const cat of CATEGORIES) {
      porProvincia.set(cat, new Map());
      porPartidoPBA.set(cat, new Map());
    }
    for (const code of codes) {
      const mEnt = idx.get(code);
      if (!mEnt) continue;
      const mMes = mEnt.get(mesStr);
      if (!mMes) continue;
      for (const cat of CATEGORIES) {
        const data = mMes.get(cat);
        if (!data) continue;
        total[cat] += data.total;
        const dstProv = porProvincia.get(cat);
        for (const [k, v] of data.porProvincia) dstProv.set(k, (dstProv.get(k) || 0) + v);
        const dstPart = porPartidoPBA.get(cat);
        for (const [k, v] of data.porPartidoPBA) dstPart.set(k, (dstPart.get(k) || 0) + v);
      }
    }
    return { mesStr, total, porProvincia, porPartidoPBA, codes };
  }

  /**
   * Serie temporal de conteos. Para cada (alias, categoria), devuelve {alias, categoria, points: [{mes_str, value}, ...]}
   * Sumamos miembros para grupos.
   */
  async function getTimeSeries(aliases, categorias, fromMesStr, toMesStr) {
    const idx = await getSerieIndex();
    const months = await listMonths();
    const filteredMonths = months.filter((m) => (!fromMesStr || m >= fromMesStr) && (!toMesStr || m <= toMesStr));
    const out = [];
    for (const alias of aliases) {
      const codes = await resolveMemberCodes(alias);
      for (const cat of categorias) {
        const points = [];
        for (const m of filteredMonths) {
          let sum = 0;
          let any = false;
          for (const code of codes) {
            const cEnt = idx.get(code);
            if (!cEnt) continue;
            const cMes = cEnt.get(m);
            if (!cMes) continue;
            const cCat = cMes.get(cat);
            if (!cCat) continue;
            sum += cCat.total;
            any = true;
          }
          points.push({ mes_str: m, value: any ? sum : null });
        }
        out.push({ alias, categoria: cat, points });
      }
    }
    return out;
  }

  /**
   * Aplica la regla "valor 0 o outlier → mantener el del mes anterior".
   * En la serie de casas no hay porcentajes ni outliers grandes, pero
   * sí puede haber meses faltantes con 0 espurio. Si quedan nulos al
   * principio, los reemplazamos por el primer valor válido.
   */
  function sanitizePoints(points) {
    const out = points.map((p) => ({ ...p }));
    // Forward fill: si valor es null o 0, copia el anterior.
    let prev = null;
    for (let i = 0; i < out.length; i++) {
      const v = out[i].value;
      if (v === null || v === undefined || !Number.isFinite(v) || v === 0) {
        out[i].value = prev;
      } else {
        prev = v;
      }
    }
    // Backward fill al principio
    let next = null;
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].value == null) {
        out[i].value = next;
      } else {
        next = out[i].value;
      }
    }
    return out;
  }

  /**
   * Modo "comparar" → indexa cada serie a 100 en su primer valor válido.
   */
  function indexToBase100(points) {
    const arr = sanitizePoints(points);
    const base = arr.find((p) => p.value != null && p.value > 0);
    if (!base) return arr.map((p) => ({ ...p, value: null }));
    const baseVal = base.value;
    return arr.map((p) => ({
      mes_str: p.mes_str,
      value: p.value == null ? null : (p.value / baseVal) * 100,
    }));
  }

  // -------------------------------------------------------------------------
  // Expose
  // -------------------------------------------------------------------------
  window.CASAS = {
    CATEGORIES,
    CATEGORY_LABEL,
    CATEGORY_LABEL_SHORT,
    CATEGORY_COLOR,
    loadUbicacionesLatest,
    loadSerieMensual,
    getSerieIndex,
    listMonths,
    resolveMemberCodes,
    getResumen,
    getTimeSeries,
    sanitizePoints,
    indexToBase100,
  };
})();
