/* =============================================================================
   Calculadora — formula builder across indicators.
   ============================================================================= */
(function () {
  "use strict";

  UI.mountTopbar("calc");
  UI.mountFooter();

  const STATE_KEY = "bcra.calc.state";
  const state = loadState() || {
    fromYM: null, toYM: null,
    aliases: [],
    rows: [],   // [{id, paren:'', op:'+', ind: 'origen|code'}]
  };
  function loadState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY)); } catch { return null; }
  }
  function saveState() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch {}
  }

  const fromHost = document.getElementById("from-picker");
  const toHost = document.getElementById("to-picker");
  const entHost = document.getElementById("entities-picker");
  const rowsHost = document.getElementById("rows");
  const formulaEl = document.getElementById("formula-display");
  const statusEl = document.getElementById("calc-status");
  const chartCard = document.getElementById("calc-chart-card");
  const chartHost = document.getElementById("calc-chart");
  const tableCard = document.getElementById("data-table-card");
  const tableEl = document.getElementById("data-table");
  const dlBtn = document.getElementById("download-csv");
  const metaEl = document.getElementById("calc-meta");

  let fromCombo, toCombo, entMulti;
  let varOptions = [];
  let lastTableData = null;
  // Track combobox instances per row so we can destroy them on re-render
  // (removes document click listeners and avoids ghosts from previous render passes).
  const indCombos = new Map(); // row.id -> combobox API

  function setStatus(msg, type = "info") {
    if (!msg) { statusEl.classList.add("hidden"); return; }
    statusEl.className = `notice ${type}`;
    statusEl.textContent = msg;
  }

  // -------- init ----------
  (async function init() {
    UI.showLoading("Cargando catálogos...");
    try {
      const [bounds, nomina, indicators] = await Promise.all([
        BCRA.getMonthBounds(),
        BCRA.loadNomina(),
        BCRA.listIndicators(),
      ]);
      if (!bounds) {
        setStatus("No encontré ningún archivo dataset_normalizado_*.csv en /data.", "error");
        UI.hideLoading();
        return;
      }
      const months = BCRA.monthsRange(bounds.minYM, bounds.maxYM);
      const monthOpts = months.map((ym) => ({
        value: String(ym),
        label: `${Math.floor(ym / 100)}-${String(ym % 100).padStart(2, "0")}`,
      }));
      const monthOptsDesc = monthOpts.slice().reverse();

      if (!state.fromYM) state.fromYM = bounds.minYM;
      if (!state.toYM) state.toYM = bounds.maxYM;

      fromCombo = UI.combobox(fromHost, monthOpts, {
        selected: String(state.fromYM),
        onChange: (v) => { state.fromYM = parseInt(v, 10); saveState(); render(); },
      });
      toCombo = UI.combobox(toHost, monthOptsDesc, {
        selected: String(state.toYM),
        onChange: (v) => { state.toYM = parseInt(v, 10); saveState(); render(); },
      });

      const entOpts = nomina
        .map((n) => ({
          value: n.alias,
          label: n.alias + (n.grupo_homogeneo === "GRUPO" ? " · grupo" : ""),
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
      if (!state.aliases.length) state.aliases = BCRA.defaultAliases(nomina);
      entMulti = UI.multiselect(entHost, entOpts, {
        selected: state.aliases,
        placeholder: "Buscar entidad o grupo...",
        onChange: (vals) => { state.aliases = vals; saveState(); render(); },
      });

      varOptions = indicators.map((i) => ({
        value: `${i.origen}|${i.codigo_dato}`,
        label: `${i.descripcion_dato} (${i.codigo_dato})`,
        badge: i.origen,
      }));

      if (!state.rows.length) {
        // Seed with one ROE variable
        const roe = indicators.find((i) => i.codigo_dato === 800010400010 && i.origen === "indicad");
        state.rows = [{
          id: makeId(),
          paren: "",
          op: "",
          ind: roe ? `${roe.origen}|${roe.codigo_dato}` : (varOptions[0]?.value || ""),
        }];
      }

      renderRows();
      UI.hideLoading();
      render();
    } catch (e) {
      console.error(e);
      setStatus("Error inicializando: " + e.message, "error");
      UI.hideLoading();
    }
  })();

  document.addEventListener("bcra:moneda_homog", () => render());

  document.getElementById("add-row").addEventListener("click", () => {
    state.rows.push({
      id: makeId(),
      paren: "",
      op: state.rows.length ? "+" : "",
      ind: varOptions[0]?.value || "",
    });
    saveState();
    renderRows();
    render();
  });
  document.getElementById("clear-rows").addEventListener("click", () => {
    state.rows = [];
    saveState();
    renderRows();
    chartCard.hidden = true;
    tableCard.hidden = true;
    formulaEl.innerHTML = "Sin fórmula.";
    metaEl.textContent = "";
  });

  // -------- rows ----------
  function renderRows() {
    // Destroy any existing combobox instances so their document-level
    // click listeners don't leak and capture clicks meant for the new rows.
    for (const api of indCombos.values()) {
      try { api.destroy && api.destroy(); } catch { /* ignore */ }
    }
    indCombos.clear();

    rowsHost.innerHTML = "";
    state.rows.forEach((row, idx) => {
      const div = document.createElement("div");
      div.className = "calc-row";
      div.innerHTML = `
        <select class="select" data-field="paren">
          <option value="">—</option>
          <option value="(">(</option>
          <option value=")">)</option>
        </select>
        ${idx === 0
          ? `<div class="first-op">—</div>`
          : `<select class="select" data-field="op">
              <option value="+">+</option>
              <option value="-">−</option>
              <option value="*">×</option>
              <option value="/">÷</option>
            </select>`}
        <div data-field="ind"></div>
        <button type="button" class="btn icon danger" data-action="remove-row" title="Quitar variable">×</button>
      `;
      rowsHost.appendChild(div);

      const parenSel = div.querySelector("[data-field='paren']");
      parenSel.value = row.paren || "";
      parenSel.addEventListener("change", () => {
        row.paren = parenSel.value;
        saveState(); render();
      });

      if (idx > 0) {
        const opSel = div.querySelector("[data-field='op']");
        opSel.value = row.op || "+";
        opSel.addEventListener("change", () => {
          row.op = opSel.value; saveState(); render();
        });
      }

      const indHost = div.querySelector("[data-field='ind']");
      const combo = UI.combobox(indHost, varOptions, {
        selected: row.ind,
        placeholder: "Buscar indicador...",
        onChange: (v) => {
          row.ind = v; saveState(); render();
        },
      });
      indCombos.set(row.id, combo);

      // IMPORTANTE: el combobox monta un <button class="combo-control">
      // dentro del row, así que querySelector("button") agarraba ESE botón.
      // Resultado: clickear el indicador eliminaba la fila, y el "X" no hacía nada.
      // Seleccionamos por data-action para evitar la colisión.
      div.querySelector("[data-action='remove-row']").addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        state.rows = state.rows.filter((r) => r.id !== row.id);
        if (state.rows.length) state.rows[0].op = "";
        saveState();
        renderRows();
        render();
      });
    });
  }

  // -------- expression building ----------
  function buildExpression() {
    // Returns { exprText: string, humanHtml: string, tokens: Array<{ kind, text }>, valid: bool, error?: string }
    const tokens = [];
    const stack = [];
    state.rows.forEach((row, i) => {
      if (i > 0) {
        const op = ["+", "-", "*", "/"].includes(row.op) ? row.op : "+";
        tokens.push({ kind: "op", text: op });
      }
      if (row.paren === "(") {
        tokens.push({ kind: "paren", text: "(" });
        stack.push(tokens.length - 1);
      }
      tokens.push({ kind: "var", text: `v${i + 1}`, ind: row.ind });
      if (row.paren === ")") {
        if (stack.length) {
          tokens.push({ kind: "paren", text: ")" });
          stack.pop();
        }
        // unmatched ) => ignored
      }
    });
    // remove unmatched '(' from start of stack indices
    if (stack.length) {
      const drop = new Set(stack);
      const filtered = tokens.filter((_, idx) => !drop.has(idx));
      tokens.length = 0;
      tokens.push(...filtered);
    }

    const exprText = tokens.map((t) => t.text).join(" ");
    const humanHtml = tokens.map((t, i) => {
      if (t.kind === "op") return `<span class="op">${t.text}</span>`;
      if (t.kind === "paren") return `<span class="paren">${t.text}</span>`;
      const opt = varOptions.find((o) => o.value === t.ind);
      const label = opt ? opt.label : "(?)";
      return `<span class="var" title="${UI.escapeHtml(label)}">${t.text}</span>`;
    }).join(" ");

    // basic validation
    if (!exprText.trim()) return { exprText: "", humanHtml: "", tokens, valid: false, error: "Vacío" };
    return { exprText, humanHtml, tokens, valid: true };
  }

  // Evaluate a token list against per-entity series
  // valuesByVar: { v1: [{ym, val}], ... } per entity
  function evalForEntity(tokens, seriesByVar) {
    // Build aligned arrays per yyyymm union
    const months = new Set();
    for (const k of Object.keys(seriesByVar)) {
      for (const r of seriesByVar[k]) months.add(r.ym);
    }
    const monthsArr = Array.from(months).sort((a, b) => a - b);
    const env = {};
    for (const k of Object.keys(seriesByVar)) {
      const map = new Map(seriesByVar[k].map((r) => [r.ym, r.val]));
      env[k] = monthsArr.map((ym) => {
        const v = map.get(ym);
        return Number.isFinite(v) ? v : NaN;
      });
    }

    // Build expression with var names already in tokens
    const exprText = tokens.map((t) => t.text).join(" ");
    let result;
    try {
      result = window._calc_safe_eval(exprText, env);
    } catch (e) {
      throw new Error("Error evaluando: " + e.message);
    }
    if (!Array.isArray(result)) {
      // scalar — repeat
      result = monthsArr.map(() => result);
    }
    return monthsArr.map((ym, i) => ({ ym, val: Number.isFinite(result[i]) ? result[i] : NaN }));
  }

  // We expose the safe arithmetic evaluator from data.js indirectly:
  // Replicate a small wrapper since it's an internal of data.js.
  // Easier: paste a minimal copy here for tokens consisting of var names + ops + parens.
  window._calc_safe_eval = function (expr, env) {
    const tokens = [];
    const re = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|([+\-*/(),%]))/g;
    let m, lastIndex = 0;
    while ((m = re.exec(expr)) !== null) {
      if (m.index !== lastIndex) throw new Error(`Token inesperado en posición ${lastIndex}`);
      lastIndex = re.lastIndex;
      if (m[1] !== undefined) tokens.push({ type: "num", value: parseFloat(m[1]) });
      else if (m[2] !== undefined) tokens.push({ type: "id", value: m[2] });
      else tokens.push({ type: "op", value: m[3] });
    }
    if (lastIndex !== expr.length) throw new Error(`Token inesperado: '${expr.slice(lastIndex)}'`);

    let i = 0;
    const peek = () => tokens[i];
    const take = () => tokens[i++];

    function mapBin(a, b, fn) {
      const aA = Array.isArray(a), bA = Array.isArray(b);
      if (!aA && !bA) {
        const r = fn(a, b);
        return Number.isFinite(r) ? r : NaN;
      }
      const len = aA ? a.length : b.length;
      const out = new Array(len);
      for (let k = 0; k < len; k++) {
        const x = aA ? a[k] : a;
        const y = bA ? b[k] : b;
        if (!Number.isFinite(x) || !Number.isFinite(y)) { out[k] = NaN; continue; }
        const r = fn(x, y);
        out[k] = Number.isFinite(r) ? r : NaN;
      }
      return out;
    }
    function neg(a) {
      if (Array.isArray(a)) return a.map((x) => Number.isFinite(x) ? -x : NaN);
      return Number.isFinite(a) ? -a : NaN;
    }

    function E() {
      let l = T();
      while (peek() && peek().type === "op" && (peek().value === "+" || peek().value === "-")) {
        const op = take().value, r = T();
        l = mapBin(l, r, op === "+" ? (x, y) => x + y : (x, y) => x - y);
      }
      return l;
    }
    function T() {
      let l = F();
      while (peek() && peek().type === "op" && (peek().value === "*" || peek().value === "/" || peek().value === "%")) {
        const op = take().value, r = F();
        l = mapBin(l, r,
          op === "*" ? (x, y) => x * y :
          op === "/" ? (x, y) => (y === 0 ? NaN : x / y) :
                       (x, y) => (y === 0 ? NaN : x % y));
      }
      return l;
    }
    function F() {
      if (peek() && peek().type === "op" && (peek().value === "+" || peek().value === "-")) {
        const op = take().value;
        const v = F();
        return op === "-" ? neg(v) : v;
      }
      return P();
    }
    function P() {
      const t = take();
      if (!t) throw new Error("Expresión incompleta");
      if (t.type === "num") return t.value;
      if (t.type === "id") {
        if (peek() && peek().type === "op" && peek().value === "(") {
          // function call
          take();
          const args = [];
          if (!(peek() && peek().type === "op" && peek().value === ")")) {
            args.push(E());
            while (peek() && peek().type === "op" && peek().value === ",") {
              take(); args.push(E());
            }
          }
          if (!(peek() && peek().type === "op" && peek().value === ")")) throw new Error("Falta ')'");
          take();
          if (t.value === "DIV0") {
            return mapBin(args[0], args[1], (a, b) => (b === 0 ? NaN : a / b));
          }
          throw new Error(`Función no permitida: ${t.value}`);
        }
        if (!(t.value in env)) throw new Error(`Variable no permitida: ${t.value}`);
        return env[t.value];
      }
      if (t.type === "op" && t.value === "(") {
        const v = E();
        if (!(peek() && peek().type === "op" && peek().value === ")")) throw new Error("Falta ')'");
        take();
        return v;
      }
      throw new Error(`Token inesperado: ${t.value}`);
    }
    const res = E();
    if (i !== tokens.length) throw new Error("Tokens sobrantes");
    return res;
  };

  // -------- render ----------
  let renderToken = 0;
  async function render() {
    const myToken = ++renderToken;
    setStatus("");

    const built = buildExpression();
    formulaEl.innerHTML = built.humanHtml || "Sin fórmula.";

    if (!state.rows.length) {
      chartCard.hidden = true; tableCard.hidden = true; metaEl.textContent = "";
      return;
    }
    if (!state.aliases.length) {
      chartCard.hidden = true; tableCard.hidden = true;
      setStatus("Seleccioná al menos una entidad.", "warn");
      return;
    }
    if (state.fromYM > state.toYM) {
      setStatus("El mes 'Desde' debe ser anterior o igual al mes 'Hasta'.", "warn");
      return;
    }
    if (!built.valid) return;

    // make sure each row has an indicator
    for (let i = 0; i < state.rows.length; i++) {
      if (!state.rows[i].ind) {
        setStatus(`Falta seleccionar el indicador en la variable v${i + 1}.`, "warn");
        return;
      }
    }

    metaEl.textContent =
      `${state.aliases.length} entidad${state.aliases.length === 1 ? "" : "es"} · `
      + `${state.rows.length} variable${state.rows.length === 1 ? "" : "s"} · `
      + `${labelMonth(state.fromYM)} → ${labelMonth(state.toYM)}`;

    UI.showLoading("Calculando fórmula...");
    try {
      const nomina = await BCRA.loadNomina();
      const aliasToCode = new Map(nomina.map((n) => [n.alias, n.codigo_entidad]));
      const codeToAlias = new Map(nomina.map((n) => [n.codigo_entidad, n.alias]));
      const useHomog = UI.getMonedaHomog();

      // For each variable, fetch series for ALL selected entities at once
      const varSeries = {}; // varSeries[varName] = Map<codigo_entidad, [{ym,val}]>
      for (let i = 0; i < state.rows.length; i++) {
        const varName = `v${i + 1}`;
        const [origen, codeStr] = state.rows[i].ind.split("|");
        const code = parseInt(codeStr, 10);
        const cods = state.aliases.map((a) => aliasToCode.get(a)).filter(Boolean);
        const rows = await BCRA.querySeriesOne(origen, cods, code, state.fromYM, state.toYM, { homogeneizar: useHomog });
        if (myToken !== renderToken) return;
        const byEnt = new Map();
        for (const r of rows) {
          if (!byEnt.has(r.codigo_entidad)) byEnt.set(r.codigo_entidad, []);
          byEnt.get(r.codigo_entidad).push({ ym: r.yyyymm, val: r.valor_dato });
        }
        for (const [, arr] of byEnt) arr.sort((a, b) => a.ym - b.ym);
        varSeries[varName] = byEnt;
      }

      // For each entity, evaluate
      const entCodes = state.aliases.map((a) => aliasToCode.get(a)).filter(Boolean);
      const traces = [];
      const tableRows = [];
      let colorIdx = 0;

      for (const ce of entCodes) {
        const seriesByVar = {};
        for (const v of Object.keys(varSeries)) {
          seriesByVar[v] = varSeries[v].get(ce) || [];
        }
        let evaluated;
        try {
          evaluated = evalForEntity(built.tokens, seriesByVar);
        } catch (e) {
          setStatus("No pude evaluar la fórmula. " + e.message, "error");
          UI.hideLoading();
          return;
        }
        const nonEmpty = evaluated.filter((p) => Number.isFinite(p.val));
        if (!nonEmpty.length) continue;

        const xs = nonEmpty.map((p) => `${Math.floor(p.ym / 100)}-${String(p.ym % 100).padStart(2, "0")}`);
        const ys = nonEmpty.map((p) => p.val);
        const alias = codeToAlias.get(ce) || ce;

        traces.push({
          x: xs, y: ys,
          type: "scatter", mode: "lines+markers",
          name: alias,
          line: { color: UI.colorFor(colorIdx), width: 2.2 },
          marker: { size: 4 },
          hovertemplate: `<b>${UI.escapeHtml(alias)}</b><br>%{x}<br>%{y:,.4f}<extra></extra>`,
        });
        colorIdx++;

        for (const p of evaluated) {
          tableRows.push({
            mes: `${Math.floor(p.ym / 100)}-${String(p.ym % 100).padStart(2, "0")}`,
            entidad: alias,
            codigo_entidad: ce,
            resultado: p.val,
          });
        }
      }

      if (!traces.length) {
        chartCard.hidden = true;
        tableCard.hidden = true;
        setStatus("Sin datos suficientes para evaluar la fórmula en el rango/entidades seleccionadas.", "warn");
        return;
      }

      // Plot
      chartCard.hidden = false;
      const layout = JSON.parse(JSON.stringify(UI.PLOTLY_LAYOUT));
      layout.margin = { l: 60, r: 18, t: 14, b: 70 };
      layout.xaxis = Object.assign({}, layout.xaxis, { title: { text: "Fecha", font: { color: "#7a8197" } } });
      layout.yaxis = Object.assign({}, layout.yaxis, { title: { text: "Resultado", font: { color: "#7a8197" } } });
      layout.legend = Object.assign({}, layout.legend, { orientation: "h", y: -0.18 });
      Plotly.newPlot(chartHost, traces, layout, UI.PLOTLY_CONFIG);

      // Table
      lastTableData = tableRows;
      renderTable(tableRows);
      tableCard.hidden = false;
    } catch (e) {
      console.error(e);
      setStatus("Error: " + e.message, "error");
    } finally {
      if (myToken === renderToken) UI.hideLoading();
    }
  }

  function renderTable(rows) {
    const sorted = rows.slice().sort((a, b) => {
      if (a.entidad !== b.entidad) return a.entidad.localeCompare(b.entidad);
      return a.mes.localeCompare(b.mes);
    });
    const limit = 1000;
    const head = `<thead><tr><th>Fecha</th><th>Entidad</th><th>Cód.</th><th>Resultado</th></tr></thead>`;
    const body = `<tbody>${
      sorted.slice(0, limit).map((r) =>
        `<tr>
          <td>${r.mes}</td>
          <td>${UI.escapeHtml(r.entidad)}</td>
          <td class="mono small muted">${r.codigo_entidad}</td>
          <td class="num">${Number.isFinite(r.resultado) ? new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(r.resultado) : "—"}</td>
        </tr>`
      ).join("")
    }</tbody>`;
    tableEl.innerHTML = head + body;
  }

  dlBtn.addEventListener("click", () => {
    if (!lastTableData || !lastTableData.length) return;
    const csv = Papa.unparse(lastTableData);
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `calc_${Date.now()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  function labelMonth(ym) {
    return `${Math.floor(ym / 100)}-${String(ym % 100).padStart(2, "0")}`;
  }
  function makeId() { return Math.random().toString(36).slice(2, 10); }
})();
