/* =============================================================================
   Ranking — Top N de entidades por valor / variación interanual / variación mensual
   para un indicador y un mes seleccionados.
   ============================================================================= */
(function () {
  "use strict";

  UI.mountTopbar("ranking");
  UI.mountFooter();

  const STATE_KEY = "bcra.ranking.state";
  const state = loadState() || {
    indKey: null,    // 'origen|codigo_dato'
    refYM: null,     // mes de referencia (yyyymm int)
    topN: 10,
    includeGroups: false,
  };
  function loadState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY)); } catch { return null; }
  }
  function saveState() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch {}
  }

  const indHost = document.getElementById("indicator-picker");
  const monthHost = document.getElementById("month-picker");
  const topnInput = document.getElementById("topn-input");
  const incGroupsToggle = document.getElementById("include-groups-toggle");
  const statusEl = document.getElementById("ranking-status");
  const metaEl = document.getElementById("ranking-meta");

  const valTable = document.getElementById("rank-value-table");
  const yoyTable = document.getElementById("rank-yoy-table");
  const momTable = document.getElementById("rank-mom-table");
  const valMeta = document.getElementById("rank-value-meta");
  const yoyMeta = document.getElementById("rank-yoy-meta");
  const momMeta = document.getElementById("rank-mom-meta");
  const dlBtn = document.getElementById("download-csv");

  let indCombo, monthCombo;
  let lastResults = null; // { meta, top_value, top_yoy, top_mom }

  function setStatus(msg, type = "info") {
    if (!msg) { statusEl.classList.add("hidden"); return; }
    statusEl.className = `notice ${type}`;
    statusEl.textContent = msg;
  }

  function labelMonth(ym) {
    return `${Math.floor(ym / 100)}-${String(ym % 100).padStart(2, "0")}`;
  }

  // -------- init ----------
  (async function init() {
    UI.showLoading("Cargando catálogos...");
    try {
      const [bounds, indicators] = await Promise.all([
        BCRA.getMonthBounds(),
        BCRA.listIndicators(),
      ]);
      if (!bounds) {
        setStatus("No encontré ningún archivo dataset_normalizado_*.csv en /data.", "error");
        UI.hideLoading();
        return;
      }
      const months = BCRA.monthsRange(bounds.minYM, bounds.maxYM);
      const monthOptsDesc = months.slice().reverse().map((ym) => ({
        value: String(ym),
        label: labelMonth(ym),
      }));
      if (!state.refYM || !months.includes(state.refYM)) state.refYM = bounds.maxYM;

      monthCombo = UI.combobox(monthHost, monthOptsDesc, {
        selected: String(state.refYM),
        onChange: (v) => { state.refYM = parseInt(v, 10); saveState(); render(); },
      });

      const indOpts = indicators.map((i) => ({
        value: `${i.origen}|${i.codigo_dato}`,
        label: `${i.descripcion_dato} (${i.codigo_dato})`,
        badge: i.origen,
      }));
      if (!state.indKey || !indOpts.find((o) => o.value === state.indKey)) {
        // default: ROE if available, else first indicator
        const roe = indicators.find((i) => i.codigo_dato === 800010400010 && i.origen === "indicad");
        state.indKey = roe ? `${roe.origen}|${roe.codigo_dato}` : (indOpts[0]?.value || null);
      }
      indCombo = UI.combobox(indHost, indOpts, {
        selected: state.indKey,
        placeholder: "Buscar indicador...",
        onChange: (v) => { state.indKey = v; saveState(); render(); },
      });

      topnInput.value = String(state.topN || 10);
      topnInput.addEventListener("change", () => {
        const n = parseInt(topnInput.value, 10);
        if (Number.isFinite(n) && n >= 3 && n <= 50) {
          state.topN = n;
        } else {
          state.topN = 10;
          topnInput.value = "10";
        }
        saveState();
        // re-render rankings only (no need to re-fetch)
        if (lastResults) renderRankings(lastResults);
      });

      incGroupsToggle.checked = !!state.includeGroups;
      incGroupsToggle.addEventListener("change", () => {
        state.includeGroups = !!incGroupsToggle.checked;
        saveState();
        render();
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

  // -------- core: fetch and rank ----------
  let renderToken = 0;
  async function render() {
    const myToken = ++renderToken;
    setStatus("");

    if (!state.indKey) {
      setStatus("Seleccioná un indicador.", "warn");
      return;
    }

    const [origen, codeStr] = state.indKey.split("|");
    const code = parseInt(codeStr, 10);

    UI.showLoading("Calculando ranking…");
    try {
      const [nomina, indicators] = await Promise.all([
        BCRA.loadNomina(),
        BCRA.listIndicators(),
      ]);
      const meta = indicators.find((i) => i.origen === origen && i.codigo_dato === code);
      const formato = (meta && meta.formato) ? String(meta.formato).toUpperCase() : "N";

      // entidades a considerar
      let entList;
      if (state.includeGroups) {
        entList = nomina.slice();
      } else {
        entList = nomina.filter((n) => !BCRA.isGroupCode(n.codigo_entidad));
      }
      const codeToAlias = new Map(entList.map((n) => [n.codigo_entidad, n.alias]));
      const codeToIsGroup = new Map(entList.map((n) => [n.codigo_entidad, n.grupo_homogeneo === "GRUPO"]));
      const cods = entList.map((n) => n.codigo_entidad);

      // Necesitamos T-12 .. T para tener YoY y MoM
      const tFrom = BCRA.shiftMonths(state.refYM, -12);
      const tTo = state.refYM;
      const useHomog = UI.getMonedaHomog();

      const rows = await BCRA.querySeriesOne(origen, cods, code, tFrom, tTo, { homogeneizar: useHomog });
      if (myToken !== renderToken) return;

      // Indexar por entidad y mes
      const byEnt = new Map();
      for (const r of rows) {
        if (!byEnt.has(r.codigo_entidad)) byEnt.set(r.codigo_entidad, new Map());
        byEnt.get(r.codigo_entidad).set(r.yyyymm, r.valor_dato);
      }

      const tPrevMo = BCRA.shiftMonths(state.refYM, -1);
      const tPrevYr = BCRA.shiftMonths(state.refYM, -12);

      const records = [];
      for (const [ce, monthMap] of byEnt.entries()) {
        const cur = monthMap.get(state.refYM);
        if (!Number.isFinite(cur)) continue;
        const prevMo = monthMap.get(tPrevMo);
        const prevYr = monthMap.get(tPrevYr);

        // Variaciones: pp para %, % sobre previo para N
        let yoy = NaN;
        let mom = NaN;
        if (Number.isFinite(prevYr)) {
          if (formato === "P") yoy = cur - prevYr;
          else if (prevYr !== 0) yoy = ((cur / prevYr) - 1) * 100;
        }
        if (Number.isFinite(prevMo)) {
          if (formato === "P") mom = cur - prevMo;
          else if (prevMo !== 0) mom = ((cur / prevMo) - 1) * 100;
        }

        records.push({
          codigo_entidad: ce,
          alias: codeToAlias.get(ce) || ce,
          isGroup: !!codeToIsGroup.get(ce),
          value: cur,
          prevMo: Number.isFinite(prevMo) ? prevMo : null,
          prevYr: Number.isFinite(prevYr) ? prevYr : null,
          yoy: Number.isFinite(yoy) ? yoy : null,
          mom: Number.isFinite(mom) ? mom : null,
        });
      }

      const top_value = records
        .slice()
        .sort((a, b) => b.value - a.value);

      const top_yoy = records
        .filter((r) => r.yoy !== null)
        .sort((a, b) => b.yoy - a.yoy);

      const top_mom = records
        .filter((r) => r.mom !== null)
        .sort((a, b) => b.mom - a.mom);

      lastResults = {
        meta: {
          codigo_dato: code,
          origen,
          descripcion_dato: meta ? meta.descripcion_dato : `Código ${code}`,
          formato,
          refYM: state.refYM,
          tPrevMo, tPrevYr,
          useHomog,
          totalEntidades: records.length,
        },
        top_value, top_yoy, top_mom,
      };

      // metas por card
      valMeta.textContent = `Mes ${labelMonth(state.refYM)}`;
      yoyMeta.textContent = `vs. ${labelMonth(tPrevYr)}`;
      momMeta.textContent = `vs. ${labelMonth(tPrevMo)}`;

      metaEl.textContent =
        `${(meta ? meta.descripcion_dato : `Código ${code}`)} · ${origen} · ` +
        `${records.length} entidad${records.length === 1 ? "" : "es"} con dato en ${labelMonth(state.refYM)}` +
        (useHomog ? " · moneda homogénea" : "");

      renderRankings(lastResults);
    } catch (e) {
      console.error(e);
      setStatus("Error: " + e.message, "error");
    } finally {
      if (myToken === renderToken) UI.hideLoading();
    }
  }

  // -------- rendering ----------
  function fmtValue(v, formato) {
    if (!Number.isFinite(v)) return "—";
    const opts = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    if (formato === "P") return new Intl.NumberFormat("es-AR", opts).format(v) + "%";
    // N: usar formato compacto (M, MM, B) si valor grande, sino crudo
    if (Math.abs(v) >= 1e6) return BCRA.fmtCompact(v);
    return new Intl.NumberFormat("es-AR", opts).format(v);
  }

  function fmtDelta(v, formato) {
    if (!Number.isFinite(v)) return { text: "—", cls: "delta-na" };
    const opts = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    const sign = v > 0 ? "+" : "";
    const num = new Intl.NumberFormat("es-AR", opts).format(v);
    const suffix = formato === "P" ? " pp" : "%";
    let cls = "delta-zero";
    if (v > 0.005 || v < -0.005) cls = v > 0 ? "delta-pos" : "delta-neg";
    return { text: `${sign}${num}${suffix}`, cls };
  }

  function rowMedalClass(idx) {
    if (idx === 0) return "medal-1";
    if (idx === 1) return "medal-2";
    if (idx === 2) return "medal-3";
    return "";
  }

  function renderTableValue(host, list, formato, n) {
    const head = `<thead><tr>
      <th class="rank-pos">#</th>
      <th>Entidad</th>
      <th class="rank-num">Valor</th>
    </tr></thead>`;
    if (!list.length) {
      host.innerHTML = head + `<tbody><tr><td colspan="3" class="rank-empty">Sin datos para esta selección.</td></tr></tbody>`;
      return;
    }
    const body = `<tbody>${
      list.slice(0, n).map((r, i) => `
        <tr>
          <td class="rank-pos ${rowMedalClass(i)}">${i + 1}</td>
          <td class="rank-name" title="${UI.escapeHtml(r.alias)}">
            ${UI.escapeHtml(r.alias)}${r.isGroup ? `<span class="group-tag">grupo</span>` : ""}
          </td>
          <td class="rank-num">${fmtValue(r.value, formato)}</td>
        </tr>
      `).join("")
    }</tbody>`;
    host.innerHTML = head + body;
  }

  function renderTableDelta(host, list, formato, n, deltaKey, prevKey, prevLabel) {
    const head = `<thead><tr>
      <th class="rank-pos">#</th>
      <th>Entidad</th>
      <th class="rank-num">Variación</th>
      <th class="rank-prev">${prevLabel}</th>
    </tr></thead>`;
    if (!list.length) {
      host.innerHTML = head + `<tbody><tr><td colspan="4" class="rank-empty">Sin datos suficientes para la variación.</td></tr></tbody>`;
      return;
    }
    const body = `<tbody>${
      list.slice(0, n).map((r, i) => {
        const d = fmtDelta(r[deltaKey], formato);
        const prev = fmtValue(r[prevKey], formato);
        return `
          <tr>
            <td class="rank-pos ${rowMedalClass(i)}">${i + 1}</td>
            <td class="rank-name" title="${UI.escapeHtml(r.alias)}">
              ${UI.escapeHtml(r.alias)}${r.isGroup ? `<span class="group-tag">grupo</span>` : ""}
            </td>
            <td class="rank-num ${d.cls}">${d.text}</td>
            <td class="rank-prev">${prev}</td>
          </tr>
        `;
      }).join("")
    }</tbody>`;
    host.innerHTML = head + body;
  }

  function renderRankings(res) {
    const n = state.topN || 10;
    const fmt = res.meta.formato;
    renderTableValue(valTable, res.top_value, fmt, n);
    renderTableDelta(yoyTable, res.top_yoy, fmt, n, "yoy", "prevYr", labelMonth(res.meta.tPrevYr));
    renderTableDelta(momTable, res.top_mom, fmt, n, "mom", "prevMo", labelMonth(res.meta.tPrevMo));
  }

  // -------- CSV download ----------
  dlBtn.addEventListener("click", () => {
    if (!lastResults) return;
    const fmt = lastResults.meta.formato;
    const refLbl = labelMonth(lastResults.meta.refYM);
    const momLbl = labelMonth(lastResults.meta.tPrevMo);
    const yoyLbl = labelMonth(lastResults.meta.tPrevYr);
    const n = state.topN || 10;

    const rows = [];
    const pushBlock = (titulo, list, deltaKey, prevKey) => {
      list.slice(0, n).forEach((r, i) => {
        rows.push({
          ranking: titulo,
          posicion: i + 1,
          codigo_entidad: r.codigo_entidad,
          alias: r.alias,
          es_grupo: r.isGroup ? 1 : 0,
          valor_actual: r.value,
          valor_mes_anterior: r.prevMo,
          valor_anio_anterior: r.prevYr,
          variacion: deltaKey ? r[deltaKey] : null,
          unidad_variacion: deltaKey ? (fmt === "P" ? "pp" : "%") : "",
        });
      });
    };
    pushBlock(`valor_${refLbl}`, lastResults.top_value, null, null);
    pushBlock(`yoy_${refLbl}_vs_${yoyLbl}`, lastResults.top_yoy, "yoy", "prevYr");
    pushBlock(`mom_${refLbl}_vs_${momLbl}`, lastResults.top_mom, "mom", "prevMo");

    const csv = Papa.unparse(rows);
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `ranking_${lastResults.meta.codigo_dato}_${refLbl}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
})();
