/* =============================================================================
   Data layer — ports bcra_utils.py to client-side JavaScript.
   Handles CSV loading (lazy), nomina, diccionario, derived indicators,
   group aggregation (sum/mean/weighted_mean) and IPC homogeneization.

   All data lives in the global `BCRA` namespace.
   ============================================================================= */
(function () {
  "use strict";

  const DATA_BASE = "data/";
  const YEARS_GLOB = "dataset_normalizado_"; // {YYYY}.csv

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

  // Cache structure
  const cache = {
    nomina: null,         // [{codigo_entidad, entidad, alias, grupo_homogeneo}]
    diccionario: null,    // [{codigo_dato, descripcion_dato, formato, origen, homogeneizable, deflactor}]
    derived: null,        // [{codigo_dato, descripcion_dato, formato, rule, origen:'derived'}]
    groups: null,         // [{group_id, group_alias, member_alias, codigo_entidad, alias}]
    aggregations: null,   // [{codigo_dato, origen, method, weight_codigo_dato, nota}]
    ipc: null,            // [{yyyymm, ipc}]
    detalles: null,       // map: codigo_dato -> detalle
    yearData: {},         // {2024: [...rows...]}
    yearLoading: {},      // {2024: Promise}
    indexedRows: null,    // unified, indexed view
    // computed:
    indicators: null,     // sorted catalog
    nominaExt: null,      // base + groups
    groupMembersMap: null,// GRP_X -> [codigo_entidad,...]
    groupAliasMap: null,  // GRP_X -> alias
  };

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  function pad5(s) {
    s = String(s).trim();
    while (s.length < 5) s = "0" + s;
    return s;
  }

  function toInt(x) {
    if (x === null || x === undefined || x === "") return null;
    const n = parseInt(x, 10);
    return Number.isFinite(n) ? n : null;
  }
  function toFloat(x) {
    if (x === null || x === undefined || x === "") return NaN;
    const n = parseFloat(String(x).replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  }
  function lower(x) { return String(x ?? "").toLowerCase().trim(); }
  function stripAccents(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function yyyymmFromDate(d) {
    return d.getFullYear() * 100 + (d.getMonth() + 1);
  }
  function dateFromYYYYMM(yyyymm) {
    const y = Math.floor(yyyymm / 100);
    const m = yyyymm % 100;
    return new Date(Date.UTC(y, m - 1, 1));
  }
  function fmtMonth(d) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }

  function shiftMonths(yyyymm, delta) {
    const y = Math.floor(yyyymm / 100);
    const m = yyyymm % 100;
    const total = y * 12 + (m - 1) + delta;
    const ny = Math.floor(total / 12);
    const nm = (total % 12) + 1;
    return ny * 100 + nm;
  }

  function monthsRange(startYM, endYM) {
    const out = [];
    let cur = startYM;
    while (cur <= endYM) {
      out.push(cur);
      cur = shiftMonths(cur, 1);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Reference data loaders (small CSVs)
  // -------------------------------------------------------------------------
  async function loadNominaBase() {
    if (cache.nomina) return cache.nomina;
    const rows = await fetchCSV(DATA_BASE + "bcra_nomina.csv");
    const out = [];
    const seen = new Set();
    for (const r of rows) {
      const obj = {};
      for (const k of Object.keys(r)) obj[k.toLowerCase().trim()] = r[k];
      if (!obj.codigo_entidad) continue;
      const code = pad5(obj.codigo_entidad);
      if (seen.has(code)) continue;
      seen.add(code);
      out.push({
        codigo_entidad: code,
        entidad: String(obj.entidad || "").trim(),
        alias: String(obj.alias || "").trim(),
        grupo_homogeneo: String(obj.grupo_homogeneo || obj["grupo homogeneo"] || "").trim(),
      });
    }
    cache.nomina = out;
    return out;
  }

  async function loadDiccionario() {
    if (cache.diccionario) return cache.diccionario;
    const rows = await fetchCSV(DATA_BASE + "diccionario_datos.csv");
    const out = [];
    for (const r of rows) {
      const obj = {};
      for (const k of Object.keys(r)) obj[k.toLowerCase().trim().replace(/\s+/g, "_")] = r[k];
      const code = toInt(obj.codigo_dato || obj.cod_dato);
      if (code === null) continue;
      out.push({
        codigo_dato: code,
        descripcion_dato: String(obj.descripcion_dato || "").trim(),
        formato: String(obj.formato || "N").toUpperCase().trim(),
        origen: lower(obj.origen),
        homogeneizable: toInt(obj.homogeneizable) === 1 ? 1 : 0,
        deflactor: String(obj.deflactor || "").trim(),
      });
    }
    cache.diccionario = out;
    return out;
  }

  async function loadDerived() {
    if (cache.derived) return cache.derived;
    let rows = [];
    try {
      rows = await fetchCSV(DATA_BASE + "derived_indicators.csv");
    } catch (e) {
      cache.derived = [];
      return cache.derived;
    }
    const out = [];
    for (const r of rows) {
      const obj = {};
      for (const k of Object.keys(r)) obj[k.toLowerCase().trim()] = r[k];
      const code = toInt(obj.codigo_dato);
      if (code === null) continue;
      out.push({
        codigo_dato: code,
        descripcion_dato: String(obj.descripcion_dato || "").trim(),
        formato: String(obj.formato || "N").toUpperCase().trim(),
        rule: String(obj.rule || "").trim(),
        origen: "derived",
      });
    }
    cache.derived = out;
    return out;
  }

  async function loadGroups() {
    if (cache.groups) return cache.groups;
    let rows = [];
    try {
      rows = await fetchCSV(DATA_BASE + "group_entities.csv");
    } catch (e) {
      cache.groups = [];
      return cache.groups;
    }
    const out = [];
    for (const r of rows) {
      const obj = {};
      for (const k of Object.keys(r)) obj[k.toLowerCase().trim()] = r[k];
      if (!obj.group_id || !obj.codigo_entidad) continue;
      out.push({
        group_id: String(obj.group_id).trim(),
        group_alias: String(obj.group_alias).trim(),
        member_alias: String(obj.member_alias || "").trim(),
        codigo_entidad: pad5(obj.codigo_entidad),
        alias: String(obj.alias || "").trim(),
      });
    }
    cache.groups = out;
    return out;
  }

  async function loadAggregations() {
    if (cache.aggregations) return cache.aggregations;
    let rows = [];
    try {
      rows = await fetchCSV(DATA_BASE + "aggregations.csv");
    } catch (e) {
      cache.aggregations = [];
      return cache.aggregations;
    }
    const out = [];
    for (const r of rows) {
      const obj = {};
      for (const k of Object.keys(r)) obj[k.toLowerCase().trim()] = r[k];
      const code = toInt(obj.codigo_dato);
      if (code === null) continue;
      out.push({
        codigo_dato: code,
        origen: lower(obj.origen),
        method: lower(obj.method),
        weight_codigo_dato: toInt(obj.weight_codigo_dato),
        nota: String(obj.nota || "").trim(),
      });
    }
    cache.aggregations = out;
    return out;
  }

  async function loadIPC() {
    if (cache.ipc) return cache.ipc;
    let rows = [];
    try {
      rows = await fetchCSV(DATA_BASE + "ipc_indec_nacional_nivel_general.csv");
    } catch (e) {
      cache.ipc = [];
      return cache.ipc;
    }
    const out = [];
    for (const r of rows) {
      const obj = {};
      for (const k of Object.keys(r)) obj[k.toLowerCase().trim().replace(/\s+/g, "_")] = r[k];
      const ym = toInt(obj.yyyymm || obj.periodo);
      const ipc = toFloat(obj.ipc || obj.indice_ipc || obj.indice);
      if (ym === null || !Number.isFinite(ipc)) continue;
      out.push({ yyyymm: ym, ipc });
    }
    out.sort((a, b) => a.yyyymm - b.yyyymm);
    cache.ipc = out;
    return out;
  }

  async function loadDetalles() {
    if (cache.detalles) return cache.detalles;
    let rows = [];
    try {
      rows = await fetchCSV(DATA_BASE + "detalle_datos.csv");
    } catch (e) {
      cache.detalles = new Map();
      return cache.detalles;
    }
    const map = new Map();
    for (const r of rows) {
      const obj = {};
      for (const k of Object.keys(r)) obj[k.toLowerCase().trim()] = r[k];
      const code = toInt(obj.codigo_dato || obj.cod_dato);
      const det = String(obj.detalle_dato || obj.detalle || "").trim();
      if (code !== null && det) map.set(code, det);
    }
    cache.detalles = map;
    return map;
  }

  // -------------------------------------------------------------------------
  // Year datasets (lazy)
  // -------------------------------------------------------------------------
  // We use a "wide-ish" parsed format with the same columns as the CSV but with
  // typed values; we also pre-compute yyyymm.
  function parseYearRow(r) {
    const cod_ent = pad5(r.codigo_entidad);
    const cod_dato = toInt(r.codigo_dato);
    const valor = toFloat(r.valor_dato);
    const formato = String(r.formato || "N").toUpperCase();
    const ano = toInt(r["año"] || r.ano || r.year);
    const mes = toInt(r.mes);
    const origen = lower(r.origen);
    if (cod_ent === null || cod_dato === null || ano === null || mes === null) return null;
    return {
      codigo_entidad: cod_ent,
      codigo_dato: cod_dato,
      valor_dato: valor,
      formato,
      origen,
      año: ano,
      mes,
      yyyymm: ano * 100 + mes,
      mes_str: `${ano}-${String(mes).padStart(2, "0")}`,
      descripcion_dato: r.descripcion_dato || "",
      descripcion_entidad: r.descripcion_entidad || "",
    };
  }

  function loadYear(year, progressCb) {
    if (cache.yearData[year]) return Promise.resolve(cache.yearData[year]);
    if (cache.yearLoading[year]) return cache.yearLoading[year];
    const url = `${DATA_BASE}${YEARS_GLOB}${year}.csv`;
    if (progressCb) progressCb({ type: "year-start", year });
    const p = new Promise((resolve, reject) => {
      Papa.parse(url, {
        download: true,
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false,
        encoding: "utf-8",
        complete: (res) => {
          const out = [];
          for (const r of res.data) {
            const row = parseYearRow(r);
            if (row) out.push(row);
          }
          cache.yearData[year] = out;
          if (progressCb) progressCb({ type: "year-done", year, count: out.length });
          resolve(out);
        },
        error: (err) => {
          cache.yearLoading[year] = null;
          reject(err);
        },
      });
    });
    cache.yearLoading[year] = p;
    return p;
  }

  async function loadYearsRange(yyyymm_ini, yyyymm_fin, progressCb) {
    const yMin = Math.floor(yyyymm_ini / 100);
    const yMax = Math.floor(yyyymm_fin / 100);
    const need = [];
    for (let y = yMin; y <= yMax; y++) need.push(y);
    // load sequentially to avoid hammering connection
    const all = [];
    for (const y of need) {
      try {
        const rows = await loadYear(y, progressCb);
        all.push(...rows);
      } catch (e) {
        console.warn(`No se pudo cargar dataset_normalizado_${y}.csv`, e);
      }
    }
    return all;
  }

  // -------------------------------------------------------------------------
  // Catalogue & nómina derivations
  // -------------------------------------------------------------------------
  async function listIndicators() {
    if (cache.indicators) return cache.indicators;
    const [dicc, derived] = await Promise.all([loadDiccionario(), loadDerived()]);
    const out = [];
    for (const d of dicc) {
      out.push({
        codigo_dato: d.codigo_dato,
        descripcion_dato: d.descripcion_dato,
        formato: d.formato,
        origen: d.origen,
        label: `${d.descripcion_dato} (${d.codigo_dato}) — ${d.origen}`,
        homogeneizable: d.homogeneizable,
        deflactor: d.deflactor,
      });
    }
    for (const d of derived) {
      out.push({
        codigo_dato: d.codigo_dato,
        descripcion_dato: d.descripcion_dato,
        formato: d.formato,
        origen: "derived",
        label: `${d.descripcion_dato} (${d.codigo_dato}) — derived`,
        homogeneizable: 0,
        deflactor: "",
        rule: d.rule,
      });
    }
    // dedup by (codigo_dato, origen) keep last
    const seen = new Set();
    const dedup = [];
    for (let i = out.length - 1; i >= 0; i--) {
      const k = `${out[i].codigo_dato}|${out[i].origen}`;
      if (seen.has(k)) continue;
      seen.add(k);
      dedup.unshift(out[i]);
    }
    dedup.sort((a, b) => {
      if (a.origen !== b.origen) return a.origen.localeCompare(b.origen);
      return a.descripcion_dato.localeCompare(b.descripcion_dato);
    });
    cache.indicators = dedup;
    return dedup;
  }

  async function loadNomina() {
    if (cache.nominaExt) return cache.nominaExt;
    const [base, groups] = await Promise.all([loadNominaBase(), loadGroups()]);
    const ext = base.slice();
    if (groups.length) {
      const groupAliases = new Set();
      const meta = new Map();
      for (const g of groups) {
        if (!meta.has(g.group_id)) meta.set(g.group_id, g.group_alias);
      }
      const baseAliases = new Set(base.map((b) => b.alias));
      for (const [gid, galias] of meta.entries()) {
        let alias = galias;
        if (baseAliases.has(alias)) alias = alias + " (grupo)";
        ext.push({
          codigo_entidad: `GRP_${gid}`,
          entidad: galias,
          alias,
          grupo_homogeneo: "GRUPO",
        });
      }
    }
    cache.nominaExt = ext;
    return ext;
  }

  async function loadGroupMaps() {
    if (cache.groupMembersMap && cache.groupAliasMap) {
      return { members: cache.groupMembersMap, alias: cache.groupAliasMap };
    }
    const groups = await loadGroups();
    const members = new Map();
    const alias = new Map();
    for (const g of groups) {
      const k = `GRP_${g.group_id}`;
      if (!members.has(k)) members.set(k, []);
      const arr = members.get(k);
      const ce = pad5(g.codigo_entidad);
      if (!arr.includes(ce)) arr.push(ce);
      if (!alias.has(k)) alias.set(k, g.group_alias);
    }
    cache.groupMembersMap = members;
    cache.groupAliasMap = alias;
    return { members, alias };
  }

  function isGroupCode(code) {
    return String(code).startsWith("GRP_");
  }

  // -------------------------------------------------------------------------
  // IPC
  // -------------------------------------------------------------------------
  async function ipcMap() {
    const ipc = await loadIPC();
    const m = new Map();
    for (const r of ipc) m.set(r.yyyymm, r.ipc);
    return m;
  }

  async function ipcBaseMonth(requestedYYYYMM) {
    const ipc = await loadIPC();
    if (!ipc.length) return null;
    const last = ipc[ipc.length - 1].yyyymm;
    if (requestedYYYYMM == null) return last;
    let best = null;
    for (const r of ipc) {
      if (r.yyyymm <= requestedYYYYMM) best = r.yyyymm;
      else break;
    }
    return best ?? last;
  }

  async function isHomogeneizable(origen, codigo_dato) {
    const dicc = await loadDiccionario();
    const o = lower(origen);
    const code = toInt(codigo_dato);
    const m = dicc.find((r) => r.origen === o && r.codigo_dato === code);
    if (!m) return false;
    return m.homogeneizable === 1;
  }

  async function maybeHomogeneize(rows, origen, codigo_dato, yyyymm_fin, useHomog) {
    if (!useHomog || !rows || !rows.length) return rows;
    if (!(await isHomogeneizable(origen, codigo_dato))) return rows;
    const base = await ipcBaseMonth(yyyymm_fin);
    if (base == null) return rows;
    const map = await ipcMap();
    const baseIpc = map.get(base);
    if (!baseIpc) return rows;
    return rows.map((r) => {
      const ipcT = map.get(r.yyyymm);
      if (!ipcT) return r;
      return { ...r, valor_dato: r.valor_dato * (baseIpc / ipcT) };
    });
  }

  // -------------------------------------------------------------------------
  // Core query: base series for real entities
  // -------------------------------------------------------------------------
  async function queryBaseSeries(origen, cod_ent_list, cod_dato, yyyymm_ini, yyyymm_fin, opts = {}) {
    const fillZero = opts.fillZero !== false;
    const o = lower(origen);
    const code = toInt(cod_dato);
    const ents = new Set(cod_ent_list.map(pad5));
    if (ents.size === 0) return [];

    const all = await loadYearsRange(yyyymm_ini, yyyymm_fin, opts.progressCb);

    const filtered = [];
    for (const r of all) {
      if (r.origen !== o) continue;
      if (r.codigo_dato !== code) continue;
      if (!ents.has(r.codigo_entidad)) continue;
      if (r.yyyymm < yyyymm_ini || r.yyyymm > yyyymm_fin) continue;
      // filter outliers % > 99000
      if (r.formato === "P" && r.valor_dato > 99000) continue;
      filtered.push(r);
    }

    // sort by entity, year, month
    filtered.sort((a, b) => {
      if (a.codigo_entidad !== b.codigo_entidad) return a.codigo_entidad.localeCompare(b.codigo_entidad);
      return a.yyyymm - b.yyyymm;
    });

    if (fillZero) {
      // Reproduce Python: s.mask(s == 0.0, NaN).ffill().fillna(0.0)
      // Treat 0 and non-finite as "missing" → forward-fill with last good value, else 0.
      // Mutate rows in place so the returned `filtered` array reflects the change.
      const byEnt = new Map();
      for (const r of filtered) {
        if (!byEnt.has(r.codigo_entidad)) byEnt.set(r.codigo_entidad, []);
        byEnt.get(r.codigo_entidad).push(r);
      }
      for (const [, arr] of byEnt) {
        let lastGood = NaN;
        for (let i = 0; i < arr.length; i++) {
          const v = arr[i].valor_dato;
          const missing = v === 0 || !Number.isFinite(v);
          if (missing) {
            arr[i].valor_dato = Number.isFinite(lastGood) ? lastGood : 0;
          } else {
            lastGood = v;
          }
        }
      }
    }

    return filtered;
  }

  // -------------------------------------------------------------------------
  // Derived indicators (safe expression evaluator)
  // -------------------------------------------------------------------------
  // Supports VAL(orig:code), VAL0(orig:code), DIFF(orig:code), DIV0(num, den) and arithmetic

  function safeArithEval(expr, env) {
    // Tokenize numbers, identifiers, operators, parens, commas
    const tokens = [];
    const re = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|([+\-*/(),%]))/g;
    let m;
    let lastIndex = 0;
    while ((m = re.exec(expr)) !== null) {
      if (m.index !== lastIndex) {
        throw new Error(`Token inesperado en posición ${lastIndex}`);
      }
      lastIndex = re.lastIndex;
      if (m[1] !== undefined) tokens.push({ type: "num", value: parseFloat(m[1]) });
      else if (m[2] !== undefined) tokens.push({ type: "id", value: m[2] });
      else tokens.push({ type: "op", value: m[3] });
    }
    if (lastIndex !== expr.length) throw new Error(`Token inesperado al final: '${expr.slice(lastIndex)}'`);

    let i = 0;
    const peek = () => tokens[i];
    const consume = () => tokens[i++];

    // grammar:
    // expr := term (('+'|'-') term)*
    // term := factor (('*'|'/'|'%') factor)*
    // factor := ('-'|'+') factor | primary
    // primary := number | ident | ident '(' args ')' | '(' expr ')'
    function parseExpr() {
      let left = parseTerm();
      while (peek() && peek().type === "op" && (peek().value === "+" || peek().value === "-")) {
        const op = consume().value;
        const right = parseTerm();
        left = applyBin(op, left, right);
      }
      return left;
    }
    function parseTerm() {
      let left = parseFactor();
      while (peek() && peek().type === "op" && (peek().value === "*" || peek().value === "/" || peek().value === "%")) {
        const op = consume().value;
        const right = parseFactor();
        left = applyBin(op, left, right);
      }
      return left;
    }
    function parseFactor() {
      if (peek() && peek().type === "op" && (peek().value === "-" || peek().value === "+")) {
        const op = consume().value;
        const v = parseFactor();
        if (op === "-") return mapSeries(v, (x) => -x);
        return v;
      }
      return parsePrimary();
    }
    function parsePrimary() {
      const t = consume();
      if (!t) throw new Error("Expresión incompleta");
      if (t.type === "num") return t.value;
      if (t.type === "id") {
        // function call?
        if (peek() && peek().type === "op" && peek().value === "(") {
          consume(); // (
          const args = [];
          if (!(peek() && peek().type === "op" && peek().value === ")")) {
            args.push(parseExpr());
            while (peek() && peek().type === "op" && peek().value === ",") {
              consume();
              args.push(parseExpr());
            }
          }
          if (!(peek() && peek().type === "op" && peek().value === ")")) {
            throw new Error("Falta ')'");
          }
          consume(); // )
          return callFunc(t.value, args);
        }
        if (!(t.value in env)) throw new Error(`Variable no permitida: ${t.value}`);
        return env[t.value];
      }
      if (t.type === "op" && t.value === "(") {
        const v = parseExpr();
        if (!(peek() && peek().type === "op" && peek().value === ")")) {
          throw new Error("Falta ')'");
        }
        consume();
        return v;
      }
      throw new Error(`Token inesperado: ${t.value}`);
    }
    function callFunc(name, args) {
      if (name === "DIV0") {
        if (args.length !== 2) throw new Error("DIV0 requiere 2 argumentos");
        return mapBin(args[0], args[1], (a, b) => {
          if (b === 0 || !Number.isFinite(b) || Number.isNaN(b)) return NaN;
          const v = a / b;
          return Number.isFinite(v) ? v : NaN;
        });
      }
      throw new Error(`Función no permitida: ${name}`);
    }
    function applyBin(op, a, b) {
      const fn = op === "+" ? (x, y) => x + y :
                 op === "-" ? (x, y) => x - y :
                 op === "*" ? (x, y) => x * y :
                 op === "/" ? (x, y) => (y === 0 ? NaN : x / y) :
                 op === "%" ? (x, y) => (y === 0 ? NaN : x % y) :
                 () => NaN;
      return mapBin(a, b, fn);
    }
    function mapBin(a, b, fn) {
      const aIsArr = Array.isArray(a);
      const bIsArr = Array.isArray(b);
      if (!aIsArr && !bIsArr) {
        const r = fn(a, b);
        return Number.isFinite(r) ? r : NaN;
      }
      const len = aIsArr ? a.length : b.length;
      const out = new Array(len);
      for (let k = 0; k < len; k++) {
        const x = aIsArr ? a[k] : a;
        const y = bIsArr ? b[k] : b;
        if (!Number.isFinite(x) || !Number.isFinite(y)) { out[k] = NaN; continue; }
        const r = fn(x, y);
        out[k] = Number.isFinite(r) ? r : NaN;
      }
      return out;
    }
    function mapSeries(a, fn) {
      if (Array.isArray(a)) return a.map((x) => (Number.isFinite(x) ? fn(x) : NaN));
      return Number.isFinite(a) ? fn(a) : NaN;
    }

    const result = parseExpr();
    if (i !== tokens.length) throw new Error("Tokens sobrantes en expresión");
    return result;
  }

  async function evalDerivedRuleForEntity(rule, codEnt, yyyymm_ini, yyyymm_fin, useHomog) {
    rule = String(rule || "").trim();
    if (!rule) return [];

    // find references
    const valRe = /(VAL0|VAL)\(\s*([A-Za-z_]+)\s*:\s*(\d+)\s*\)/g;
    const diffRe = /DIFF\(\s*([A-Za-z_]+)\s*:\s*(\d+)\s*\)/g;
    const valRefs = [];
    let m;
    while ((m = valRe.exec(rule)) !== null) valRefs.push({ org: m[2].toLowerCase(), code: parseInt(m[3], 10) });
    while ((m = diffRe.exec(rule)) !== null) valRefs.push({ org: m[1].toLowerCase(), code: parseInt(m[2], 10) });

    if (!valRefs.length) return [];

    // Fetch each unique series for this entity
    const uniq = [];
    const seen = new Set();
    for (const r of valRefs) {
      const k = `${r.org}|${r.code}`;
      if (!seen.has(k)) { seen.add(k); uniq.push(r); }
    }

    const seriesByKey = {};
    let unionMonths = new Set();
    for (const r of uniq) {
      const rows = await queryBaseSeries(r.org, [codEnt], r.code, yyyymm_ini, yyyymm_fin, { fillZero: true });
      const homog = await maybeHomogeneize(rows, r.org, r.code, yyyymm_fin, useHomog);
      const map = new Map();
      for (const row of homog) {
        map.set(row.yyyymm, row.valor_dato);
        unionMonths.add(row.yyyymm);
      }
      seriesByKey[`VAL:${r.org}:${r.code}`] = map;
    }

    if (!unionMonths.size) return [];
    const months = Array.from(unionMonths).sort((a, b) => a - b);

    // Build env arrays aligned to months
    const env = {};
    let exprText = rule;

    exprText = exprText.replace(/(VAL0|VAL)\(\s*([A-Za-z_]+)\s*:\s*(\d+)\s*\)/g, (m, fn, org, code) => {
      const key = `VAL:${org.toLowerCase()}:${code}`;
      const map = seriesByKey[key] || new Map();
      const varName = `v_${fn}_${org.toLowerCase()}_${code}`;
      const arr = months.map((ym) => {
        const v = map.get(ym);
        if (v === undefined) return fn === "VAL0" ? 0 : NaN;
        return v;
      });
      env[varName] = arr;
      return varName;
    });

    exprText = exprText.replace(/DIFF\(\s*([A-Za-z_]+)\s*:\s*(\d+)\s*\)/g, (m, org, code) => {
      const key = `VAL:${org.toLowerCase()}:${code}`;
      const map = seriesByKey[key] || new Map();
      const varName = `v_DIFF_${org.toLowerCase()}_${code}`;
      const arr = months.map((ym, i) => {
        if (i === 0) return NaN;
        const cur = map.get(ym);
        const prev = map.get(months[i - 1]);
        if (cur === undefined || prev === undefined) return NaN;
        return cur - prev;
      });
      env[varName] = arr;
      return varName;
    });

    let result;
    try {
      result = safeArithEval(exprText, env);
    } catch (e) {
      console.warn("Error evaluando regla derived:", e, "\nRegla:", rule, "\nExpr:", exprText);
      return [];
    }

    if (!Array.isArray(result)) {
      // scalar — repeat
      result = months.map(() => result);
    }
    const out = [];
    for (let k = 0; k < months.length; k++) {
      const v = result[k];
      const ym = months[k];
      const y = Math.floor(ym / 100);
      const mo = ym % 100;
      out.push({
        codigo_entidad: pad5(codEnt),
        codigo_dato: 0, // filled by caller
        descripcion_dato: "",
        valor_dato: Number.isFinite(v) ? v : NaN,
        formato: "N",
        origen: "derived",
        año: y,
        mes: mo,
        yyyymm: ym,
        mes_str: `${y}-${String(mo).padStart(2, "0")}`,
      });
    }
    return out;
  }

  async function computeDerived(cod_dato, cod_ent_list, yyyymm_ini, yyyymm_fin, useHomog) {
    const derived = await loadDerived();
    const def = derived.find((d) => d.codigo_dato === toInt(cod_dato));
    if (!def) return [];
    const out = [];
    for (const ent of cod_ent_list) {
      const arr = await evalDerivedRuleForEntity(def.rule, ent, yyyymm_ini, yyyymm_fin, useHomog);
      for (const r of arr) {
        r.codigo_dato = def.codigo_dato;
        r.descripcion_dato = def.descripcion_dato;
        r.formato = def.formato;
        out.push(r);
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Group aggregation
  // -------------------------------------------------------------------------
  async function aggregationMethod(origen, cod_dato, formato) {
    const aggs = await loadAggregations();
    const o = lower(origen);
    const code = toInt(cod_dato);
    const row = aggs.find((a) => a.origen === o && a.codigo_dato === code);
    if (row) {
      let worg = null;
      if (row.weight_codigo_dato != null) {
        const dicc = await loadDiccionario();
        const m = dicc.find((d) => d.codigo_dato === row.weight_codigo_dato);
        if (m) worg = m.origen;
      }
      return { method: row.method, weight_code: row.weight_codigo_dato, weight_origen: worg };
    }
    if (String(formato || "").toUpperCase() === "P") return { method: "mean", weight_code: null, weight_origen: null };
    return { method: "sum", weight_code: null, weight_origen: null };
  }

  function aggregateGroup(rows, groupCode, groupName, method, weightRows, meta) {
    if (!rows.length) return [];
    const byMonth = new Map();
    for (const r of rows) {
      if (!byMonth.has(r.yyyymm)) byMonth.set(r.yyyymm, []);
      byMonth.get(r.yyyymm).push(r);
    }

    let weightByMonthEnt = null;
    if (method === "weighted_mean" && weightRows && weightRows.length) {
      weightByMonthEnt = new Map();
      for (const w of weightRows) {
        const k = `${w.yyyymm}|${w.codigo_entidad}`;
        weightByMonthEnt.set(k, w.valor_dato);
      }
    }

    const out = [];
    for (const [ym, group] of byMonth.entries()) {
      let value;
      if (method === "sum") {
        value = group.reduce((s, x) => s + (Number.isFinite(x.valor_dato) ? x.valor_dato : 0), 0);
      } else if (method === "mean") {
        let n = 0, s = 0;
        for (const x of group) {
          if (Number.isFinite(x.valor_dato)) { s += x.valor_dato; n++; }
        }
        value = n ? s / n : NaN;
      } else if (method === "weighted_mean" && weightByMonthEnt) {
        let num = 0, den = 0;
        for (const x of group) {
          const w = weightByMonthEnt.get(`${x.yyyymm}|${x.codigo_entidad}`);
          if (!Number.isFinite(w) || !Number.isFinite(x.valor_dato)) continue;
          num += x.valor_dato * w;
          den += w;
        }
        value = (den && Number.isFinite(den)) ? num / den : NaN;
      } else {
        // fallback mean
        let n = 0, s = 0;
        for (const x of group) {
          if (Number.isFinite(x.valor_dato)) { s += x.valor_dato; n++; }
        }
        value = n ? s / n : NaN;
      }

      const y = Math.floor(ym / 100);
      const mo = ym % 100;
      out.push({
        codigo_entidad: groupCode,
        descripcion_entidad: groupName,
        codigo_dato: meta.codigo_dato,
        descripcion_dato: meta.descripcion_dato,
        valor_dato: value,
        formato: meta.formato,
        origen: meta.origen,
        año: y,
        mes: mo,
        yyyymm: ym,
        mes_str: `${y}-${String(mo).padStart(2, "0")}`,
      });
    }
    out.sort((a, b) => a.yyyymm - b.yyyymm);
    return out;
  }

  // -------------------------------------------------------------------------
  // Public API: querySeriesOne
  // -------------------------------------------------------------------------
  async function querySeriesOne(origen, cod_ent_list, cod_dato, yyyymm_ini, yyyymm_fin, opts = {}) {
    const useHomog = !!opts.homogeneizar;
    const ents = cod_ent_list.map((c) => isGroupCode(c) ? c : pad5(c));
    const realEnts = ents.filter((c) => !isGroupCode(c));
    const groupEnts = ents.filter(isGroupCode);

    const indicators = await listIndicators();
    const meta = indicators.find((i) => i.codigo_dato === toInt(cod_dato) && i.origen === lower(origen));
    const formato_guess = meta ? meta.formato : "N";

    let baseRows;
    if (lower(origen) === "derived") {
      baseRows = await computeDerived(cod_dato, realEnts, yyyymm_ini, yyyymm_fin, useHomog);
    } else {
      baseRows = await queryBaseSeries(origen, realEnts, cod_dato, yyyymm_ini, yyyymm_fin, opts);
      baseRows = await maybeHomogeneize(baseRows, origen, cod_dato, yyyymm_fin, useHomog);
    }

    // Groups
    const groupRowsAll = [];
    if (groupEnts.length) {
      const { members, alias } = await loadGroupMaps();
      for (const grp of groupEnts) {
        const memList = members.get(grp) || [];
        if (!memList.length) continue;
        let memberRows;
        if (lower(origen) === "derived") {
          memberRows = await computeDerived(cod_dato, memList, yyyymm_ini, yyyymm_fin, useHomog);
        } else {
          memberRows = await queryBaseSeries(origen, memList, cod_dato, yyyymm_ini, yyyymm_fin, opts);
          memberRows = await maybeHomogeneize(memberRows, origen, cod_dato, yyyymm_fin, useHomog);
        }
        if (!memberRows.length) continue;
        const formato = memberRows[0].formato || formato_guess;
        const aggInfo = await aggregationMethod(origen, cod_dato, formato);
        let weightRows = null;
        if (aggInfo.method === "weighted_mean" && aggInfo.weight_code != null && aggInfo.weight_origen) {
          weightRows = await queryBaseSeries(aggInfo.weight_origen, memList, aggInfo.weight_code, yyyymm_ini, yyyymm_fin, opts);
        }
        const metaInfo = {
          codigo_dato: toInt(cod_dato),
          descripcion_dato: meta ? meta.descripcion_dato : (memberRows[0].descripcion_dato || ""),
          formato,
          origen: lower(origen),
        };
        const gname = alias.get(grp) || grp;
        const grouped = aggregateGroup(memberRows, grp, gname, aggInfo.method, weightRows, metaInfo);
        groupRowsAll.push(...grouped);
      }
    }

    const all = [...baseRows, ...groupRowsAll];
    if (!all.length) return [];

    // attach descripcion_entidad from nomina
    const nom = await loadNomina();
    const aliasByCode = new Map(nom.map((n) => [n.codigo_entidad, n.alias]));
    for (const r of all) {
      r.descripcion_entidad = aliasByCode.get(r.codigo_entidad) || r.descripcion_entidad || "";
      // make sure descripcion_dato is filled from indicator catalog if missing
      if (!r.descripcion_dato && meta) r.descripcion_dato = meta.descripcion_dato;
    }
    return all;
  }

  // -------------------------------------------------------------------------
  // Helpers exposed for UI
  // -------------------------------------------------------------------------
  async function getMonthBounds() {
    // Prefer data/_manifest.json (cheap, single request).
    // Fallback to HEAD-probing a year range if manifest is absent.
    let found = [];
    try {
      const res = await fetch(DATA_BASE + "_manifest.json", { cache: "no-cache" });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.years)) found = json.years.map((y) => parseInt(y, 10)).filter(Number.isFinite);
      }
    } catch (e) {
      // ignore
    }
    if (!found.length) {
      const now = new Date();
      const minProbe = 2010;
      const maxProbe = now.getFullYear() + 1;
      for (let y = minProbe; y <= maxProbe; y++) {
        const url = `${DATA_BASE}${YEARS_GLOB}${y}.csv`;
        try {
          const res = await fetch(url, { method: "HEAD" });
          if (res.ok) found.push(y);
        } catch (e) { /* ignore */ }
      }
    }
    if (!found.length) return null;
    found.sort((a, b) => a - b);
    // For end month, peek into the latest year file's data.
    const latestYear = found[found.length - 1];
    const latestRows = await loadYear(latestYear);
    let maxYM = latestYear * 100 + 1;
    for (const r of latestRows) {
      if (r.yyyymm > maxYM) maxYM = r.yyyymm;
    }
    return {
      minYM: found[0] * 100 + 1,
      maxYM,
      years: found,
    };
  }

  // -------------------------------------------------------------------------
  // Format helpers
  // -------------------------------------------------------------------------
  function fmtValue(val, formato) {
    if (val == null || !Number.isFinite(val)) return "—";
    const isPct = String(formato || "").toUpperCase() === "P";
    const opts = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    let s = new Intl.NumberFormat("es-AR", opts).format(val);
    if (isPct) s += "%";
    return s;
  }

  function fmtCompact(val) {
    if (val == null || !Number.isFinite(val)) return "—";
    const abs = Math.abs(val);
    if (abs >= 1e12) return (val / 1e12).toFixed(2).replace(".", ",") + " B"; // billón (es-AR)
    if (abs >= 1e9) return (val / 1e9).toFixed(2).replace(".", ",") + " MM";
    if (abs >= 1e6) return (val / 1e6).toFixed(2).replace(".", ",") + " M";
    if (abs >= 1e3) return (val / 1e3).toFixed(2).replace(".", ",") + " K";
    return val.toFixed(2).replace(".", ",");
  }

  function fmtDelta(val, isPct, isPP) {
    if (val == null || !Number.isFinite(val)) return { text: "—", cls: "delta-na" };
    const opts = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    const sign = val > 0 ? "+" : "";
    const num = new Intl.NumberFormat("es-AR", opts).format(val);
    let text = `${sign}${num}`;
    if (isPP) text += " pp";
    else text += "%";
    let cls = "delta-zero";
    if (val > 0) cls = "delta-pos";
    else if (val < 0) cls = "delta-neg";
    return { text, cls };
  }

  function defaultAliases(nomina) {
    const desired = ["NACION", "TOTAL SISTEMA FINANCIERO", "10 PRIMEROS BANCOS PRIVADOS"];
    const norm = new Map(nomina.map((n) => [n.alias, stripAccents(n.alias).toUpperCase()]));
    const sel = nomina.filter((n) => desired.includes(norm.get(n.alias))).map((n) => n.alias);
    if (sel.length) return sel;
    return nomina.map((n) => n.alias).sort().slice(0, 3);
  }

  // -------------------------------------------------------------------------
  // Expose
  // -------------------------------------------------------------------------
  window.BCRA = {
    // loaders
    loadNomina,
    loadDiccionario,
    loadDerived,
    loadGroups,
    loadAggregations,
    loadIPC,
    loadDetalles,
    loadYear,
    loadYearsRange,
    listIndicators,
    loadGroupMaps,
    // queries
    querySeriesOne,
    queryBaseSeries,
    computeDerived,
    // helpers
    getMonthBounds,
    isGroupCode,
    isHomogeneizable,
    ipcBaseMonth,
    pad5,
    yyyymmFromDate,
    dateFromYYYYMM,
    fmtMonth,
    monthsRange,
    shiftMonths,
    fmtValue,
    fmtCompact,
    fmtDelta,
    defaultAliases,
    stripAccents,
    // cache exposure (read-only)
    _cache: cache,
  };
})();
