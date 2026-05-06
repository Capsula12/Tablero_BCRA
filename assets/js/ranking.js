/* =============================================================================
   Ranking — Tabla única sortable de entidades por indicador y mes seleccionados.
   Cada fila muestra valor, variación interanual y variación mensual.
   El usuario ordena tocando los encabezados (estilo planilla).
   ============================================================================= */
(function () {
  "use strict";

  UI.mountTopbar("ranking");
  UI.mountFooter();

  const STATE_KEY = "bcra.ranking.state";
  const DEFAULTS = {
    indKey: null,        // 'origen|codigo_dato'
    refYM: null,         // mes de referencia (yyyymm int)
    topN: 20,
    includeGroups: true,
    sortKey: "value",    // 'value' | 'yoy' | 'mom' | 'alias'
    sortDir: "desc",     // 'asc' | 'desc'
  };
  const state = Object.assign({}, DEFAULTS, loadState() || {});
  // Migración suave de versiones viejas del estado
  if (!["value", "yoy", "mom", "alias"].includes(state.sortKey)) state.sortKey = "value";
  if (!["asc", "desc"].includes(state.sortDir)) state.sortDir = "desc";
  if (typeof state.includeGroups === "undefined") state.includeGroups = true;
  delete state.query;

  function loadState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY)); } catch { return null; }
  }
  function saveState() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch {}
  }

  const indHost = document.getElementById("indicator-picker");
  const monthHost = document.getElementById("month-picker");
  const topnInput = document.getElementById("topn-input");
  const universeHost = document.getElementById("universe-seg");
  const statusEl = document.getElementById("ranking-status");
  const metaEl = document.getElementById("ranking-meta");
  const countEl = document.getElementById("result-count");
  const tableEl = document.getElementById("rank-table");
  const dlBtn = document.getElementById("download-csv");
  const detailCard = document.getElementById("ind-detail-card");
  const detailTitle = detailCard.querySelector(".ind-detail-title");
  const detailMeta = detailCard.querySelector(".ind-detail-meta");
  const detailBody = detailCard.querySelector(".ind-detail-body");

  let indCombo, monthCombo, universeSeg;
  let lastResults = null; // { meta, records:[] }

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
        const roe = indicators.find((i) => i.codigo_dato === 800010400010 && i.origen === "indicad");
        state.indKey = roe ? `${roe.origen}|${roe.codigo_dato}` : (indOpts[0]?.value || null);
      }
      indCombo = UI.combobox(indHost, indOpts, {
        selected: state.indKey,
        placeholder: "Buscar indicador...",
        onChange: (v) => { state.indKey = v; saveState(); render(); },
      });

      topnInput.value = String(state.topN || 20);
      topnInput.addEventListener("change", () => {
        const n = parseInt(topnInput.value, 10);
        if (Number.isFinite(n) && n >= 3 && n <= 200) {
          state.topN = n;
        } else {
          state.topN = 20;
          topnInput.value = "20";
        }
        saveState();
        if (lastResults) renderTable();
      });

      universeSeg = UI.segmented(universeHost, [
        { value: "all", label: "Todas + grupos" },
        { value: "entities", label: "Solo entidades" },
      ], {
        selected: state.includeGroups ? "all" : "entities",
        onChange: (v) => {
          state.includeGroups = (v === "all");
          saveState();
          render();
        },
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

  async function renderIndicatorDetail(meta, origen, code) {
    if (!detailCard) return;
    const txt = await UI.getDetalleText(code);
    const title = meta ? meta.descripcion_dato : `Código ${code}`;
    const formatoLbl = meta && String(meta.formato).toUpperCase() === "P" ? "porcentaje (%)" : "valor numérico";
    detailMeta.innerHTML = `
      <span class="pill">${UI.escapeHtml(origen)}</span>
      <span class="pill">cód. ${code}</span>
      <span>${formatoLbl}</span>
    `;
    detailTitle.textContent = title;
    if (txt && txt.trim()) {
      detailBody.textContent = txt;
      detailBody.classList.remove("muted");
    } else {
      detailBody.textContent = "Sin detalle disponible para este indicador.";
      detailBody.classList.add("muted");
    }
    detailCard.classList.remove("hidden");
  }

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

      // Detalle desplegado automáticamente para el indicador activo.
      await renderIndicatorDetail(meta, origen, code);

      let entList;
      if (state.includeGroups) {
        entList = nomina.slice();
      } else {
        // Excluye tanto los grupos custom (GRP_*) como los agregados nativos
        // del BCRA (AA*: TOTAL SISTEMA FINANCIERO, BANCOS PUBLICOS, etc.).
        entList = nomina.filter((n) => !BCRA.isAnyGroupCode(n.codigo_entidad));
      }
      const codeToAlias = new Map(entList.map((n) => [n.codigo_entidad, n.alias]));
      const codeToIsGroup = new Map(entList.map((n) => [n.codigo_entidad, n.grupo_homogeneo === "GRUPO"]));
      const cods = entList.map((n) => n.codigo_entidad);

      const tFrom = BCRA.shiftMonths(state.refYM, -12);
      const tTo = state.refYM;
      const useHomog = UI.getMonedaHomog();

      const rows = await BCRA.querySeriesOne(origen, cods, code, tFrom, tTo, { homogeneizar: useHomog });
      if (myToken !== renderToken) return;

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
        records,
      };

      metaEl.textContent =
        `${(meta ? meta.descripcion_dato : `Código ${code}`)} · ${origen} · ` +
        `${records.length} entidad${records.length === 1 ? "" : "es"} con dato en ${labelMonth(state.refYM)}` +
        (useHomog ? " · moneda homogénea" : "");

      renderTable();
    } catch (e) {
      console.error(e);
      setStatus("Error: " + e.message, "error");
    } finally {
      if (myToken === renderToken) UI.hideLoading();
    }
  }

  // -------- ordering / filtering ----------
  // Ordena dejando los nulos al final independientemente de la dirección.
  function compareWithNulls(a, b, dir) {
    const aNull = a === null || a === undefined || Number.isNaN(a);
    const bNull = b === null || b === undefined || Number.isNaN(b);
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    return dir === "asc" ? (a - b) : (b - a);
  }

  function getSortedFiltered() {
    if (!lastResults) return [];
    const list = lastResults.records.slice();

    const k = state.sortKey;
    const dir = state.sortDir;
    list.sort((a, b) => {
      if (k === "alias") {
        const ax = (a.alias || "").toLowerCase();
        const bx = (b.alias || "").toLowerCase();
        const cmp = ax < bx ? -1 : ax > bx ? 1 : 0;
        return dir === "asc" ? cmp : -cmp;
      }
      return compareWithNulls(a[k], b[k], dir);
    });

    return list;
  }

  // -------- rendering ----------
  function fmtValue(v, formato) {
    if (!Number.isFinite(v)) return "—";
    const opts = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    if (formato === "P") return new Intl.NumberFormat("es-AR", opts).format(v) + "%";
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

  function headerCell(key, label, alignRight) {
    const isActive = state.sortKey === key;
    const arrow = isActive ? (state.sortDir === "asc" ? "▲" : "▼") : "↕";
    const cls = [
      "sortable",
      alignRight ? "rank-num" : "",
      isActive ? "sort-col" : "",
    ].filter(Boolean).join(" ");
    const arrowCls = isActive ? "sort-arrow active" : "sort-arrow";
    return `<th class="${cls}" data-sort-key="${key}" role="button" tabindex="0" aria-sort="${
      isActive ? (state.sortDir === "asc" ? "ascending" : "descending") : "none"
    }">${label} <span class="${arrowCls}">${arrow}</span></th>`;
  }

  function renderTable() {
    if (!lastResults) {
      tableEl.innerHTML = "";
      countEl.textContent = "";
      return;
    }
    const fmt = lastResults.meta.formato;
    const list = getSortedFiltered();
    const n = state.topN || 20;
    const slice = list.slice(0, n);

    const totalRec = lastResults.records.length;
    const shownCount = slice.length;
    countEl.textContent = `Mostrando ${shownCount} de ${totalRec}`;

    const head = `<thead><tr>
      <th class="rank-pos">#</th>
      ${headerCell("alias", "Entidad", false)}
      ${headerCell("value", "Valor", true)}
      ${headerCell("yoy", "Var. anual", true)}
      ${headerCell("mom", "Var. mensual", true)}
    </tr></thead>`;

    if (!slice.length) {
      tableEl.innerHTML = head +
        `<tbody><tr><td colspan="5" class="rank-empty">Sin datos suficientes para esta selección.</td></tr></tbody>`;
      attachHeaderHandlers();
      return;
    }

    const aliasSortCls = state.sortKey === "alias" ? "sort-col" : "";
    const valSortCls   = state.sortKey === "value" ? "sort-col" : "";
    const yoySortCls   = state.sortKey === "yoy"   ? "sort-col" : "";
    const momSortCls   = state.sortKey === "mom"   ? "sort-col" : "";

    const body = `<tbody>${
      slice.map((r, i) => {
        const dYoy = fmtDelta(r.yoy, fmt);
        const dMom = fmtDelta(r.mom, fmt);
        return `
          <tr>
            <td class="rank-pos ${rowMedalClass(i)}">${i + 1}</td>
            <td class="rank-name ${aliasSortCls}" title="${UI.escapeHtml(r.alias)}">
              ${UI.escapeHtml(r.alias)}${r.isGroup ? `<span class="group-tag">grupo</span>` : ""}
            </td>
            <td class="rank-num ${valSortCls}">${fmtValue(r.value, fmt)}</td>
            <td class="rank-num ${yoySortCls} ${dYoy.cls}">${dYoy.text}</td>
            <td class="rank-num ${momSortCls} ${dMom.cls}">${dMom.text}</td>
          </tr>
        `;
      }).join("")
    }</tbody>`;

    tableEl.innerHTML = head + body;
    attachHeaderHandlers();
  }

  function setSort(key) {
    if (state.sortKey === key) {
      state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
    } else {
      state.sortKey = key;
      // Default alias asc; valor/var: desc (mayor → menor) en el primer click.
      state.sortDir = key === "alias" ? "asc" : "desc";
    }
    saveState();
    renderTable();
  }

  function attachHeaderHandlers() {
    tableEl.querySelectorAll("th.sortable").forEach((th) => {
      const key = th.getAttribute("data-sort-key");
      if (!key) return;
      th.addEventListener("click", () => setSort(key));
      th.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setSort(key);
        }
      });
    });
  }

  // -------- CSV download ----------
  dlBtn.addEventListener("click", () => {
    if (!lastResults) return;
    const fmt = lastResults.meta.formato;
    const refLbl = labelMonth(lastResults.meta.refYM);
    const momLbl = labelMonth(lastResults.meta.tPrevMo);
    const yoyLbl = labelMonth(lastResults.meta.tPrevYr);
    const list = getSortedFiltered().slice(0, state.topN || 20);
    const unidadVar = fmt === "P" ? "pp" : "%";

    const rows = list.map((r, i) => ({
      posicion: i + 1,
      codigo_entidad: r.codigo_entidad,
      alias: r.alias,
      es_grupo: r.isGroup ? 1 : 0,
      mes_referencia: refLbl,
      valor_actual: r.value,
      mes_anterior: momLbl,
      valor_mes_anterior: r.prevMo,
      anio_anterior: yoyLbl,
      valor_anio_anterior: r.prevYr,
      variacion_interanual: r.yoy,
      variacion_mensual: r.mom,
      unidad_variacion: unidadVar,
      ordenado_por: state.sortKey,
      direccion: state.sortDir,
    }));

    const csv = Papa.unparse(rows);
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `ranking_${lastResults.meta.codigo_dato}_${refLbl}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
})();
