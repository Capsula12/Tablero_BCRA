/* =============================================================================
   Series page — multi-entity, multi-indicator comparison.
   ============================================================================= */
(function () {
  "use strict";

  UI.mountTopbar("series");
  UI.mountFooter();

  const STATE_KEY = "bcra.series.state";
  const state = loadState() || {
    fromYM: null, toYM: null,
    aliases: [],
    indKeys: [],
  };
  function loadState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY)); } catch { return null; }
  }
  function saveState() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch {}
  }

  const rangeHost = document.getElementById("range-picker");
  const entHost = document.getElementById("entities-picker");
  const varsHost = document.getElementById("vars-picker");
  const chartsEl = document.getElementById("series-charts");
  const statusEl = document.getElementById("series-status");
  const metaEl = document.getElementById("series-meta");
  const tableCard = document.getElementById("data-table-card");
  const tableEl = document.getElementById("data-table");
  const dlBtn = document.getElementById("download-csv");

  let rangeSlider, entMulti, varsMulti;
  let lastTableRows = null;

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

      if (!state.fromYM || !months.includes(state.fromYM)) state.fromYM = bounds.minYM;
      if (!state.toYM || !months.includes(state.toYM)) state.toYM = bounds.maxYM;

      rangeSlider = UI.dateRangeSlider(rangeHost, months, {
        from: state.fromYM,
        to: state.toYM,
        onChange: ({ from, to }) => {
          state.fromYM = from; state.toYM = to;
          saveState(); render();
        },
        onInput: ({ from, to }) => {
          state.fromYM = from; state.toYM = to;
        },
      });

      const entOpts = nomina
        .map((n) => ({
          value: n.alias,
          label: n.alias + (n.grupo_homogeneo === "GRUPO" ? " · grupo" : ""),
        }))
        .sort((a, b) => a.label.localeCompare(b.label));

      if (!state.aliases.length) {
        state.aliases = BCRA.defaultAliases(nomina);
      }

      entMulti = UI.multiselect(entHost, entOpts, {
        selected: state.aliases,
        placeholder: "Buscar entidad o grupo...",
        onChange: (vals) => { state.aliases = vals; saveState(); render(); },
      });

      const varOpts = indicators.map((i) => ({
        value: `${i.origen}|${i.codigo_dato}`,
        label: `${i.descripcion_dato} (${i.codigo_dato})`,
        badge: i.origen,
      }));
      if (!state.indKeys.length) {
        // default: ROE
        const roe = indicators.find((i) => i.codigo_dato === 800010400010 && i.origen === "indicad");
        if (roe) state.indKeys = [`${roe.origen}|${roe.codigo_dato}`];
      }
      varsMulti = UI.multiselect(varsHost, varOpts, {
        selected: state.indKeys,
        placeholder: "Buscar indicadores...",
        onChange: (vals) => { state.indKeys = vals; saveState(); render(); },
      });

      UI.hideLoading();
      render();
    } catch (e) {
      console.error(e);
      setStatus("Error inicializando: " + e.message, "error");
      UI.hideLoading();
    }
  })();

  document.addEventListener("bcra:moneda_homog", () => render());

  // -------- render ----------
  let renderToken = 0;
  async function render() {
    const myToken = ++renderToken;
    chartsEl.innerHTML = "";
    setStatus("");

    if (state.fromYM > state.toYM) {
      setStatus("El mes 'Desde' debe ser anterior o igual al mes 'Hasta'.", "warn");
      return;
    }
    if (!state.aliases.length) {
      chartsEl.innerHTML = `<div class="card padded muted">Seleccioná al menos una entidad.</div>`;
      return;
    }
    if (!state.indKeys.length) {
      chartsEl.innerHTML = `<div class="card padded muted">Seleccioná al menos un indicador.</div>`;
      return;
    }

    metaEl.textContent =
      `${state.aliases.length} entidad${state.aliases.length === 1 ? "" : "es"} · `
      + `${state.indKeys.length} indicador${state.indKeys.length === 1 ? "" : "es"} · `
      + `${labelMonth(state.fromYM)} → ${labelMonth(state.toYM)}`;

    UI.showLoading("Cargando años necesarios y calculando series...");

    try {
      const [nomina, indicators] = await Promise.all([
        BCRA.loadNomina(),
        BCRA.listIndicators(),
      ]);
      const aliasToCode = new Map(nomina.map((n) => [n.alias, n.codigo_entidad]));
      const codeToAlias = new Map(nomina.map((n) => [n.codigo_entidad, n.alias]));
      const cods = state.aliases.map((a) => aliasToCode.get(a)).filter(Boolean);
      const useHomog = UI.getMonedaHomog();

      let lastDf = null;
      for (let idx = 0; idx < state.indKeys.length; idx++) {
        if (myToken !== renderToken) return;
        const k = state.indKeys[idx];
        const [origen, codeStr] = k.split("|");
        const code = parseInt(codeStr, 10);
        const meta = indicators.find((i) => i.origen === origen && i.codigo_dato === code);

        // Card scaffold
        const card = document.createElement("div");
        card.className = "card mb-12";
        card.innerHTML = `
          <div class="card-header">
            <h3 class="card-title">${UI.escapeHtml(meta ? meta.descripcion_dato : `Código ${code}`)} <span class="muted small mono" style="margin-left:6px">${origen}</span></h3>
            <span class="muted small">cód. ${code}</span>
          </div>
          <div class="card-body">
            <div class="plotly-host" style="height:380px"></div>
            <div class="mc-info" style="margin-top:8px"></div>
          </div>`;
        chartsEl.appendChild(card);
        const chartHost = card.querySelector(".plotly-host");
        const infoHost = card.querySelector(".mc-info");

        try {
          const rows = await BCRA.querySeriesOne(origen, cods, code, state.fromYM, state.toYM, { homogeneizar: useHomog });
          if (myToken !== renderToken) return;
          if (!rows.length) {
            chartHost.innerHTML = `<div class="muted" style="padding:60px;text-align:center">Sin datos para esta selección.</div>`;
            await UI.attachHelp(infoHost, code);
            continue;
          }
          // Group by entity
          const byEnt = new Map();
          for (const r of rows) {
            if (!byEnt.has(r.codigo_entidad)) byEnt.set(r.codigo_entidad, []);
            byEnt.get(r.codigo_entidad).push(r);
          }
          const traces = [];
          let colorIdx = 0;
          // preserve user-selected order of aliases
          const orderedCodes = state.aliases.map((a) => aliasToCode.get(a)).filter(Boolean);
          const seenCodes = new Set();
          for (const c of orderedCodes) {
            if (!byEnt.has(c)) continue;
            seenCodes.add(c);
            const arr = byEnt.get(c).sort((a, b) => a.yyyymm - b.yyyymm);
            traces.push({
              x: arr.map((r) => r.mes_str),
              y: arr.map((r) => r.valor_dato),
              type: "scatter",
              mode: "lines+markers",
              name: codeToAlias.get(c) || c,
              line: { color: UI.colorFor(colorIdx), width: 2.2 },
              marker: { size: 4 },
              hovertemplate: `<b>${UI.escapeHtml(codeToAlias.get(c) || c)}</b><br>%{x}<br>` +
                (String(meta?.formato).toUpperCase() === "P" ? "%{y:.2f}%" : "%{y:,.2f}") + "<extra></extra>",
            });
            colorIdx++;
          }
          // Any leftover groups not in user order (unlikely)
          for (const [c, arr] of byEnt.entries()) {
            if (seenCodes.has(c)) continue;
            arr.sort((a, b) => a.yyyymm - b.yyyymm);
            traces.push({
              x: arr.map((r) => r.mes_str),
              y: arr.map((r) => r.valor_dato),
              type: "scatter", mode: "lines+markers",
              name: codeToAlias.get(c) || c,
              line: { color: UI.colorFor(colorIdx), width: 2.2 },
              marker: { size: 4 },
            });
            colorIdx++;
          }

          const layout = JSON.parse(JSON.stringify(UI.PLOTLY_LAYOUT));
          layout.margin = { l: 60, r: 18, t: 14, b: 70 };
          layout.xaxis = Object.assign({}, layout.xaxis, { title: { text: "Fecha", font: { color: "#7a8197" } } });
          layout.yaxis = Object.assign({}, layout.yaxis, {
            title: { text: meta && String(meta.formato).toUpperCase() === "P" ? "Valor (%)" : "Valor", font: { color: "#7a8197" } },
            tickformat: meta && String(meta.formato).toUpperCase() === "P" ? ".2f" : ",.2f",
          });
          layout.legend = Object.assign({}, layout.legend, { orientation: "h", y: -0.18 });

          Plotly.newPlot(chartHost, traces, layout, UI.PLOTLY_CONFIG);
          await UI.attachHelp(infoHost, code);

          lastDf = rows;
        } catch (e) {
          console.error(e);
          chartHost.innerHTML = `<div class="muted" style="padding:60px;text-align:center;color:var(--danger)">${UI.escapeHtml(e.message)}</div>`;
        }
      }

      // Data table
      if (lastDf && lastDf.length) {
        renderTable(lastDf);
        tableCard.hidden = false;
        lastTableRows = lastDf;
      } else {
        tableCard.hidden = true;
        lastTableRows = null;
      }
    } catch (e) {
      console.error(e);
      setStatus("Error: " + e.message, "error");
    } finally {
      if (myToken === renderToken) UI.hideLoading();
    }
  }

  function renderTable(rows) {
    const cols = ["mes_str", "descripcion_entidad", "codigo_entidad", "codigo_dato", "descripcion_dato", "valor_dato", "formato", "origen"];
    const headers = ["Fecha", "Entidad", "Cód. ent.", "Cód. dato", "Descripción", "Valor", "Fmt", "Origen"];
    const isNum = [false, false, false, false, false, true, false, false];
    const sorted = rows.slice().sort((a, b) => {
      if (a.codigo_entidad !== b.codigo_entidad) return a.codigo_entidad.localeCompare(b.codigo_entidad);
      return a.yyyymm - b.yyyymm;
    });

    const limit = 1000;
    const head = `<thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>`;
    const body = `<tbody>${
      sorted.slice(0, limit).map((r) =>
        `<tr>${
          cols.map((c, i) => {
            const v = r[c];
            if (isNum[i]) {
              return `<td class="num">${Number.isFinite(v) ? new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(v) : "—"}</td>`;
            }
            return `<td>${UI.escapeHtml(v ?? "")}</td>`;
          }).join("")
        }</tr>`
      ).join("")
    }</tbody>`;
    tableEl.innerHTML = head + body;
    if (sorted.length > limit) {
      const note = document.createElement("div");
      note.className = "muted small";
      note.style.padding = "8px 12px";
      note.textContent = `Mostrando primeras ${limit.toLocaleString("es-AR")} filas de ${sorted.length.toLocaleString("es-AR")}.`;
      tableEl.parentElement.appendChild(note);
    }
  }

  dlBtn.addEventListener("click", () => {
    if (!lastTableRows || !lastTableRows.length) return;
    const cols = ["mes_str", "descripcion_entidad", "codigo_entidad", "codigo_dato", "descripcion_dato", "valor_dato", "formato", "origen"];
    const csv = Papa.unparse({
      fields: cols,
      data: lastTableRows.map((r) => cols.map((c) => r[c] ?? "")),
    });
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `series_${Date.now()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  function labelMonth(ym) {
    return `${Math.floor(ym / 100)}-${String(ym % 100).padStart(2, "0")}`;
  }
})();
