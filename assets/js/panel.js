/* =============================================================================
   Panel page — entity dashboard with mini-charts (12 months) and deltas.
   ============================================================================= */
(function () {
  "use strict";

  UI.mountTopbar("panel");
  UI.mountFooter();

  // -------- defaults (mirrors pages/1_panel.py) --------
  const DEFAULT_PAIRS = [
    { code: 800010400010, origen: "indicad" }, // ROE
    { code: 800010400170, origen: "indicad" }, // Gastos personal / administración
    { code: 310000000070, origen: "inf_adi" }, // Dotación de personal
    { code: 800010300020, origen: "indicad" }, // Rentabilidad sobre gastos de estructura
    { code: 100010303010, origen: "balres" },  // Hipotecarios
    { code: 990000002,    origen: "derived" }, // Cuentas por empleado
  ];

  // State
  const STATE_KEY = "bcra.panel.state";
  const state = loadState() || {
    endYM: null,
    alias: "NACION",
    selectedKeys: [], // ["origen|code", ...]
  };

  function loadState() {
    try {
      const s = localStorage.getItem(STATE_KEY);
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  }
  function saveState() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch {}
  }

  // -------- UI components ----------
  const monthHost = document.getElementById("month-picker");
  const entityHost = document.getElementById("entity-picker");
  const varsHost = document.getElementById("vars-picker");
  const grid = document.getElementById("panel-grid");
  const statusEl = document.getElementById("panel-status");
  const metaEl = document.getElementById("panel-meta");

  let monthCombo = null;
  let entityCombo = null;
  let varsMulti = null;

  function setStatus(msg, type = "info") {
    if (!msg) {
      statusEl.classList.add("hidden");
      statusEl.textContent = "";
      return;
    }
    statusEl.className = `notice ${type}`;
    statusEl.textContent = msg;
  }

  // -------- init ----------
  (async function init() {
    UI.showLoading("Cargando catálogo y nómina...");
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
      if (!state.endYM || !months.includes(state.endYM)) {
        state.endYM = bounds.maxYM;
      }
      monthCombo = UI.dateMonthSlider(monthHost, months, {
        value: state.endYM,
        onChange: (v) => { state.endYM = v; saveState(); render(); },
        onInput: (v) => { state.endYM = v; },
      });

      // Entity options (incl. groups)
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
        placeholder: "Buscar entidad...",
        onChange: (v) => { state.alias = v; saveState(); render(); },
      });

      // Variables multiselect
      const varOpts = indicators.map((i) => ({
        value: `${i.origen}|${i.codigo_dato}`,
        label: `${i.descripcion_dato} (${i.codigo_dato})`,
        badge: i.origen,
      }));
      if (!state.selectedKeys.length) {
        state.selectedKeys = DEFAULT_PAIRS
          .map((p) => `${p.origen}|${p.code}`)
          .filter((k) => varOpts.find((o) => o.value === k));
      }
      varsMulti = UI.multiselect(varsHost, varOpts, {
        selected: state.selectedKeys,
        placeholder: "Buscar variable o código...",
        onChange: (vals) => { state.selectedKeys = vals; saveState(); render(); },
      });

      UI.hideLoading();
      render();
    } catch (e) {
      console.error(e);
      setStatus("Error inicializando: " + e.message, "error");
      UI.hideLoading();
    }
  })();

  // React to global toggle
  document.addEventListener("bcra:moneda_homog", () => render());

  // -------- render ----------
  let renderToken = 0;
  async function render() {
    const myToken = ++renderToken;
    grid.innerHTML = "";
    setStatus("");

    if (!state.selectedKeys.length) {
      grid.innerHTML = `<div class="card padded muted">Seleccioná al menos una variable.</div>`;
      return;
    }

    const nomina = await BCRA.loadNomina();
    const ent = nomina.find((n) => n.alias === state.alias);
    if (!ent) { setStatus("Entidad no encontrada.", "warn"); return; }

    const endYM = state.endYM;
    const startYM = BCRA.shiftMonths(endYM, -13);
    const yyyymm_ini = startYM, yyyymm_fin = endYM;

    metaEl.textContent = `${state.alias} · ${labelMonth(endYM)} · ventana de 14 meses (gráfico: 12 meses)`;

    UI.showLoading("Calculando series...");

    try {
      const indicators = await BCRA.listIndicators();
      const useHomog = UI.getMonedaHomog();

      // Build placeholder cards in order
      const items = state.selectedKeys.map((k) => {
        const [origen, code] = k.split("|");
        const meta = indicators.find((i) => i.origen === origen && i.codigo_dato === parseInt(code, 10));
        return { key: k, origen, code: parseInt(code, 10), meta };
      });

      for (const item of items) {
        const card = document.createElement("div");
        card.className = "mini-card";
        card.innerHTML = `
          <div class="mc-origen">${UI.escapeHtml(item.origen)}</div>
          <div class="mc-title">${UI.escapeHtml(item.meta ? item.meta.descripcion_dato : `Código ${item.code}`)}</div>
          <div class="mc-chart"></div>
          <div class="mc-stats">
            <div class="mc-actual">—</div>
            <div class="mc-deltas">
              <span><span class="delta-label">vs mes ant.:</span> <span class="delta delta-na">—</span></span>
              <span><span class="delta-label">vs año ant.:</span> <span class="delta delta-na">—</span></span>
            </div>
          </div>
          <div class="mc-info"></div>
        `;
        grid.appendChild(card);
      }

      // Render each item
      for (let idx = 0; idx < items.length; idx++) {
        if (myToken !== renderToken) return; // user changed selection; abort
        const item = items[idx];
        const card = grid.children[idx];
        const chartHost = card.querySelector(".mc-chart");
        const actualEl = card.querySelector(".mc-actual");
        const deltasEl = card.querySelector(".mc-deltas");
        const infoHost = card.querySelector(".mc-info");

        try {
          const rows = await BCRA.querySeriesOne(
            item.origen, [ent.codigo_entidad], item.code, yyyymm_ini, yyyymm_fin,
            { homogeneizar: useHomog }
          );
          if (!rows.length) {
            actualEl.textContent = "—";
            chartHost.innerHTML = `<div class="muted small" style="padding:30px 0;text-align:center">Sin datos en el período.</div>`;
            await UI.attachHelp(infoHost, item.code);
            continue;
          }
          rows.sort((a, b) => a.yyyymm - b.yyyymm);

          // current / prev month / prev year
          const byYM = new Map(rows.map((r) => [r.yyyymm, r.valor_dato]));
          const cur = byYM.get(endYM);
          const prevM = byYM.get(BCRA.shiftMonths(endYM, -1));
          const prevY = byYM.get(BCRA.shiftMonths(endYM, -12));

          const formato = item.meta ? item.meta.formato : (rows[0].formato || "N");
          actualEl.textContent = BCRA.fmtValue(cur, formato);

          let dmText, dmCls, dyText, dyCls;
          if (String(formato).toUpperCase() === "P") {
            const dm = (Number.isFinite(cur) && Number.isFinite(prevM)) ? cur - prevM : NaN;
            const dy = (Number.isFinite(cur) && Number.isFinite(prevY)) ? cur - prevY : NaN;
            const fdm = BCRA.fmtDelta(dm, false, true);
            const fdy = BCRA.fmtDelta(dy, false, true);
            dmText = fdm.text; dmCls = fdm.cls;
            dyText = fdy.text; dyCls = fdy.cls;
          } else {
            const dm = (Number.isFinite(cur) && Number.isFinite(prevM) && prevM !== 0) ? ((cur - prevM) / prevM * 100) : NaN;
            const dy = (Number.isFinite(cur) && Number.isFinite(prevY) && prevY !== 0) ? ((cur - prevY) / prevY * 100) : NaN;
            const fdm = BCRA.fmtDelta(dm, true, false);
            const fdy = BCRA.fmtDelta(dy, true, false);
            dmText = fdm.text; dmCls = fdm.cls;
            dyText = fdy.text; dyCls = fdy.cls;
          }
          deltasEl.innerHTML = `
            <span><span class="delta-label">vs mes ant.:</span> <span class="delta ${dmCls}">${dmText}</span></span>
            <span><span class="delta-label">vs año ant.:</span> <span class="delta ${dyCls}">${dyText}</span></span>
          `;

          // Last 12 months filter
          const startPlot = BCRA.shiftMonths(endYM, -11);
          const plotRows = rows.filter((r) => r.yyyymm >= startPlot && r.yyyymm <= endYM);
          const xs = plotRows.map((r) => r.mes_str);
          const ys = plotRows.map((r) => r.valor_dato);

          const trace = {
            x: xs, y: ys,
            mode: "lines+markers",
            type: "scatter",
            line: { color: "#9bd1ff", width: 2.4, shape: "linear" },
            marker: { size: 5, color: "#9bd1ff" },
            hovertemplate: "<b>%{x}</b><br>" + (String(formato).toUpperCase() === "P" ? "%{y:.2f}%" : "%{y:,.2f}") + "<extra></extra>",
          };
          const layout = JSON.parse(JSON.stringify(UI.PLOTLY_LAYOUT));
          layout.height = 150;
          layout.margin = { l: 42, r: 8, t: 6, b: 28 };
          layout.showlegend = false;
          layout.xaxis = Object.assign({}, layout.xaxis, { tickfont: { color: "#7a8197", size: 9 } });
          layout.yaxis = Object.assign({}, layout.yaxis, { tickfont: { color: "#7a8197", size: 9 } });

          Plotly.newPlot(chartHost, [trace], layout, Object.assign({}, UI.PLOTLY_CONFIG, { displayModeBar: false }));
          await UI.attachHelp(infoHost, item.code);
        } catch (e) {
          console.error("Item failed:", item, e);
          actualEl.textContent = "—";
          chartHost.innerHTML = `<div class="muted small" style="padding:30px 0;text-align:center">Error: ${UI.escapeHtml(e.message)}</div>`;
        }
      }
    } catch (e) {
      console.error(e);
      setStatus("Error: " + e.message, "error");
    } finally {
      if (myToken === renderToken) UI.hideLoading();
    }
  }

  function labelMonth(ym) {
    const y = Math.floor(ym / 100);
    const m = ym % 100;
    const monthNames = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
    return `${monthNames[m - 1]} ${y}`;
  }
})();
