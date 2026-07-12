/* =============================================================================
   UI utilities — shared header, multiselect, combobox, loader, chart helpers
   ============================================================================= */
(function () {
  "use strict";

  // -------------------------------------------------------------------------
  // Topbar
  // -------------------------------------------------------------------------
  function renderTopbar(activePage) {
    const pages = [
      { key: "index", label: "Inicio", href: "index.html", icon: "▣" },
      { key: "panel", label: "Panel", href: "panel.html", icon: "▤" },
      { key: "series", label: "Series", href: "series.html", icon: "▥" },
      { key: "calc", label: "Calculadora", href: "calc.html", icon: "≡" },
      { key: "ranking", label: "Ranking", href: "ranking.html", icon: "★" },
      { key: "sucursales", label: "Sucursales", href: "sucursales.html", icon: "◉" },
    ];
    const navHtml = pages.map((p) => {
      const cls = p.key === activePage ? "active" : "";
      return `<a class="${cls}" href="${p.href}"><span style="font-size:13px;opacity:0.7">${p.icon}</span>${p.label}</a>`;
    }).join("");
    return `
      <div class="topbar">
        <a href="index.html" class="brand">
          <span class="brand-logo"><img src="assets/img/logo.png" alt="La Bancaria" loading="eager"></span>
          <span>Tablero BCRA</span>
        </a>
        <nav class="nav">${navHtml}</nav>
        <div class="spacer"></div>
        <div class="actions">
          <label class="checkbox" title="Deflacta valores nominales en pesos a precios del último mes con IPC INDEC">
            <input type="checkbox" id="moneda-homog-toggle" checked>
            <span>Moneda homogénea</span>
          </label>
          <a class="gh-link" href="https://github.com/Capsula12/Tablero_BCRA" target="_blank" rel="noopener">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.3c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.9 1.3 1.9 1.3 1.1 1.9 2.9 1.4 3.6 1 .1-.8.4-1.4.8-1.7-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.3-3.2-.1-.4-.6-1.6.1-3.3 0 0 1-.3 3.4 1.3a11.7 11.7 0 0 1 6.2 0c2.4-1.6 3.4-1.3 3.4-1.3.7 1.7.2 3 .1 3.3.8.8 1.3 1.9 1.3 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3"/></svg>
            GitHub
          </a>
        </div>
      </div>`;
  }

  function mountTopbar(activePage) {
    const el = document.getElementById("topbar-host");
    if (!el) return;
    el.innerHTML = renderTopbar(activePage);
    // Wire moneda homogénea toggle (persisted in localStorage)
    const tog = document.getElementById("moneda-homog-toggle");
    if (tog) {
      const saved = localStorage.getItem("bcra.moneda_homog");
      if (saved !== null) tog.checked = saved === "1";
      tog.addEventListener("change", () => {
        localStorage.setItem("bcra.moneda_homog", tog.checked ? "1" : "0");
        // Notify via custom event so pages can react
        document.dispatchEvent(new CustomEvent("bcra:moneda_homog", { detail: { value: tog.checked } }));
      });
    }
  }

  function getMonedaHomog() {
    const t = document.getElementById("moneda-homog-toggle");
    if (t) return !!t.checked;
    const saved = localStorage.getItem("bcra.moneda_homog");
    return saved !== "0";
  }

  // -------------------------------------------------------------------------
  // Footer
  // -------------------------------------------------------------------------
  function mountFooter() {
    const el = document.getElementById("footer-host");
    if (!el) return;
    el.innerHTML = `
      <div class="footer">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span style="display:inline-flex;align-items:center;background:#fff;border:1px solid var(--border);border-radius:7px;padding:5px 8px;box-shadow:0 1px 2px rgba(16,40,60,.12)"><img src="assets/img/logo.png" alt="La Bancaria" style="height:30px;display:block"></span>
          <span>Datos: BCRA + INDEC. Reglas: outliers % &gt; 99000 ignorados; valores 0 reemplazados por el mes previo.</span>
        </div>
        <div>
          <a href="https://github.com/Capsula12/Tablero_BCRA" target="_blank" rel="noopener">Capsula12/Tablero_BCRA</a>
        </div>
      </div>`;
  }

  // -------------------------------------------------------------------------
  // Loading overlay
  // -------------------------------------------------------------------------
  let _overlay = null;
  function showLoading(msg) {
    if (!_overlay) {
      _overlay = document.createElement("div");
      _overlay.className = "loading-overlay";
      _overlay.innerHTML = `<div class="spinner"></div><div class="loading-msg"></div>`;
      document.body.appendChild(_overlay);
    }
    _overlay.querySelector(".loading-msg").textContent = msg || "Cargando...";
    _overlay.style.display = "flex";
  }
  function hideLoading() {
    if (_overlay) _overlay.style.display = "none";
  }

  // -------------------------------------------------------------------------
  // Multiselect (custom)
  // -------------------------------------------------------------------------
  /**
   * Mount a multiselect inside `host`.
   * options: [{value, label, badge?}]
   * onChange(values: string[])
   * returns API: { setSelected(arr), getSelected(), setOptions(arr) }
   */
  function multiselect(host, options, opts = {}) {
    const selected = new Set(opts.selected || []);
    let filteredOptions = options.slice();
    let allOptions = options.slice();
    let highlightIdx = -1;

    host.classList.add("multiselect");
    host.innerHTML = `
      <div class="ms-control">
        <input type="text" class="ms-input" placeholder="${opts.placeholder || "Buscar..."}" />
        <span class="ms-caret">▾</span>
      </div>
      <div class="ms-dropdown" role="listbox"></div>
    `;
    const control = host.querySelector(".ms-control");
    const input = host.querySelector(".ms-input");
    const dropdown = host.querySelector(".ms-dropdown");

    function render() {
      // Render chips before input
      const chips = Array.from(selected).map((v) => {
        const opt = allOptions.find((o) => o.value === v);
        const label = opt ? opt.label : v;
        return `<span class="chip" data-value="${escapeHtml(v)}" title="${escapeHtml(label)}">
          <span style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(label)}</span>
          <span class="x" data-remove="${escapeHtml(v)}" aria-label="Quitar">×</span>
        </span>`;
      }).join("");
      // Find input index, replace nodes before it
      // Simpler: remove and re-add
      Array.from(control.querySelectorAll(".chip")).forEach((n) => n.remove());
      input.insertAdjacentHTML("beforebegin", chips);

      // Dropdown options
      const term = input.value.toLowerCase().trim();
      filteredOptions = allOptions.filter((o) =>
        !term ||
        o.label.toLowerCase().includes(term) ||
        String(o.value).toLowerCase().includes(term)
      );
      if (filteredOptions.length === 0) {
        dropdown.innerHTML = `<div class="ms-empty">Sin resultados</div>`;
      } else {
        dropdown.innerHTML = filteredOptions.slice(0, 200).map((o, i) => {
          const sel = selected.has(o.value) ? "selected" : "";
          const active = i === highlightIdx ? "active" : "";
          const badge = o.badge ? `<span class="badge">${escapeHtml(o.badge)}</span>` : "";
          return `<div class="ms-option ${sel} ${active}" data-value="${escapeHtml(o.value)}">${escapeHtml(o.label)}${badge}</div>`;
        }).join("");
      }
    }

    function open() {
      host.classList.add("open");
    }
    function close() {
      host.classList.remove("open");
      highlightIdx = -1;
    }

    function emitChange() {
      if (typeof opts.onChange === "function") {
        opts.onChange(Array.from(selected));
      }
    }

    // Events
    control.addEventListener("click", (e) => {
      if (e.target.matches(".x")) {
        const v = e.target.getAttribute("data-remove");
        selected.delete(v);
        render();
        emitChange();
        return;
      }
      input.focus();
      open();
    });
    input.addEventListener("input", () => { highlightIdx = -1; render(); open(); });
    input.addEventListener("focus", open);
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        highlightIdx = Math.min(filteredOptions.length - 1, highlightIdx + 1);
        render();
        scrollHighlightIntoView();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        highlightIdx = Math.max(0, highlightIdx - 1);
        render();
        scrollHighlightIntoView();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (highlightIdx >= 0 && filteredOptions[highlightIdx]) {
          const v = filteredOptions[highlightIdx].value;
          if (selected.has(v)) selected.delete(v); else selected.add(v);
          render();
          emitChange();
        }
      } else if (e.key === "Escape") {
        close();
      } else if (e.key === "Backspace" && !input.value && selected.size > 0) {
        // remove last chip
        const arr = Array.from(selected);
        selected.delete(arr[arr.length - 1]);
        render();
        emitChange();
      }
    });
    dropdown.addEventListener("click", (e) => {
      const opt = e.target.closest(".ms-option");
      if (!opt) return;
      const v = opt.getAttribute("data-value");
      if (selected.has(v)) selected.delete(v); else selected.add(v);
      render();
      emitChange();
      input.focus();
    });
    const onDocClick = (e) => { if (!host.contains(e.target)) close(); };
    document.addEventListener("click", onDocClick);

    function scrollHighlightIntoView() {
      const el = dropdown.querySelector(".ms-option.active");
      if (el) el.scrollIntoView({ block: "nearest" });
    }

    render();

    return {
      setSelected(arr) {
        selected.clear();
        for (const v of arr || []) selected.add(v);
        render();
      },
      getSelected() { return Array.from(selected); },
      setOptions(arr) { allOptions = arr.slice(); render(); },
      addOption(opt) { allOptions.push(opt); render(); },
      destroy() {
        document.removeEventListener("click", onDocClick);
        host.innerHTML = "";
        host.classList.remove("multiselect", "open");
      },
    };
  }

  // -------------------------------------------------------------------------
  // Combobox (single-select with search)
  // -------------------------------------------------------------------------
  function combobox(host, options, opts = {}) {
    let allOptions = options.slice();
    let filteredOptions = options.slice();
    let selected = opts.selected || (allOptions[0] ? allOptions[0].value : null);
    let highlightIdx = -1;

    host.classList.add("combo");
    host.innerHTML = `
      <button type="button" class="combo-control">
        <span class="combo-value"></span>
        <span class="combo-caret">▾</span>
      </button>
      <div class="combo-dropdown">
        <div class="combo-search"><input type="text" placeholder="${opts.placeholder || "Buscar..."}"/></div>
        <div class="combo-list" role="listbox"></div>
      </div>
    `;
    const control = host.querySelector(".combo-control");
    const valueEl = host.querySelector(".combo-value");
    const dropdown = host.querySelector(".combo-dropdown");
    const search = host.querySelector(".combo-search input");
    const list = host.querySelector(".combo-list");

    function renderValue() {
      const opt = allOptions.find((o) => o.value === selected);
      valueEl.textContent = opt ? opt.label : (opts.emptyText || "—");
      if (!opt) valueEl.style.color = "var(--text-muted)";
      else valueEl.style.color = "";
    }

    function renderList() {
      const term = search.value.toLowerCase().trim();
      filteredOptions = allOptions.filter((o) =>
        !term ||
        o.label.toLowerCase().includes(term) ||
        String(o.value).toLowerCase().includes(term)
      );
      if (filteredOptions.length === 0) {
        list.innerHTML = `<div class="ms-empty">Sin resultados</div>`;
      } else {
        list.innerHTML = filteredOptions.slice(0, 300).map((o, i) => {
          const sel = o.value === selected ? "selected" : "";
          const act = i === highlightIdx ? "active" : "";
          return `<div class="combo-option ${sel} ${act}" data-value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</div>`;
        }).join("");
      }
    }

    function scrollActiveIntoView() {
      const el = list.querySelector(".combo-option.active") || list.querySelector(".combo-option.selected");
      if (el) el.scrollIntoView({ block: "nearest" });
    }

    function open() {
      if (host.classList.contains("open")) return;
      host.classList.add("open");
      // Pre-highlight the currently-selected row so Enter reselects it and
      // the user can see where they are in the list.
      const selIdx = filteredOptions.findIndex((o) => o.value === selected);
      highlightIdx = selIdx;
      renderList();
      setTimeout(() => {
        search.focus();
        scrollActiveIntoView();
      }, 0);
    }
    function close() {
      host.classList.remove("open");
      search.value = "";
      highlightIdx = -1;
    }

    function commit(value) {
      if (value == null) return;
      selected = value;
      renderValue();
      close();
      if (typeof opts.onChange === "function") opts.onChange(selected);
    }

    const onControlClick = () => { if (host.classList.contains("open")) close(); else open(); };
    const onSearchInput = () => {
      // Render once to recompute filteredOptions for the new search term,
      // then auto-highlight the first match so Enter selects it.
      highlightIdx = -1;
      renderList();
      highlightIdx = filteredOptions.length > 0 ? 0 : -1;
      renderList();
      scrollActiveIntoView();
    };
    const onSearchKey = (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        highlightIdx = Math.min(filteredOptions.length - 1, (highlightIdx < 0 ? -1 : highlightIdx) + 1);
        renderList();
        scrollActiveIntoView();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        highlightIdx = Math.max(0, (highlightIdx < 0 ? 0 : highlightIdx) - 1);
        renderList();
        scrollActiveIntoView();
      } else if (e.key === "Enter") {
        e.preventDefault();
        let idx = highlightIdx;
        if (idx < 0 && filteredOptions.length > 0) idx = 0;
        if (idx >= 0 && filteredOptions[idx]) commit(filteredOptions[idx].value);
      } else if (e.key === "Escape") {
        close();
      }
    };
    const onListClick = (e) => {
      const opt = e.target.closest(".combo-option");
      if (!opt) return;
      commit(opt.getAttribute("data-value"));
    };
    const onDocClick = (e) => { if (!host.contains(e.target)) close(); };

    control.addEventListener("click", onControlClick);
    search.addEventListener("input", onSearchInput);
    search.addEventListener("keydown", onSearchKey);
    list.addEventListener("click", onListClick);
    document.addEventListener("click", onDocClick);

    renderValue();

    return {
      getValue() { return selected; },
      setValue(v) { selected = v; renderValue(); },
      setOptions(arr) {
        allOptions = arr.slice();
        if (!allOptions.find((o) => o.value === selected)) {
          selected = allOptions[0] ? allOptions[0].value : null;
        }
        renderValue();
      },
      destroy() {
        // Remove listeners that live on document / persist between renders.
        document.removeEventListener("click", onDocClick);
        host.innerHTML = "";
        host.classList.remove("combo", "open");
      },
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function debounce(fn, wait) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  // -------------------------------------------------------------------------
  // Plotly — locale es-AR
  // PLOTLY_CONFIG declara locale "es-AR", pero Plotly necesita el diccionario
  // registrado para usarlo (si no, cae silenciosamente al inglés: "Apr 2025",
  // decimales con punto). Se registra inline para no sumar otro <script> CDN.
  // Cubre: nombres de meses/días en ejes de fecha, separadores (coma decimal,
  // punto de miles — reforzado con layout.separators) y textos del modebar.
  // -------------------------------------------------------------------------
  if (typeof Plotly !== "undefined" && Plotly.register) {
    Plotly.register({
      moduleType: "locale",
      name: "es-AR",
      dictionary: {
        "Zoom": "Zoom",
        "Pan": "Desplazar",
        "Zoom in": "Acercar",
        "Zoom out": "Alejar",
        "Reset axes": "Restablecer ejes",
        "Download plot as a png": "Descargar como png",
        "Toggle Spike Lines": "Alternar líneas guía",
        "Show closest data on hover": "Mostrar el dato más cercano",
        "Compare data on hover": "Comparar datos al pasar el cursor",
      },
      format: {
        days: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
        shortDays: ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"],
        months: ["enero", "febrero", "marzo", "abril", "mayo", "junio",
                 "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
        shortMonths: ["ene", "feb", "mar", "abr", "may", "jun",
                      "jul", "ago", "sep", "oct", "nov", "dic"],
        date: "%d/%m/%Y",
        decimal: ",",
        thousands: ".",
      },
    });
  }

  // -------------------------------------------------------------------------
  // Plotly default layout (dark theme)
  // -------------------------------------------------------------------------
  const PLOTLY_LAYOUT = {
    // Separadores es-AR: coma decimal, punto de miles (aplica a ticks y hover).
    separators: ",.",
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: "#0e2233", family: "IBM Plex Sans, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif", size: 12 },
    margin: { l: 50, r: 18, t: 30, b: 40 },
    xaxis: {
      gridcolor: "#e6ecf1",
      zerolinecolor: "#c2ccd6",
      linecolor: "#c2ccd6",
      tickfont: { color: "#46586a", size: 11 },
      title: { font: { color: "#6b7c8c", size: 11 } },
    },
    yaxis: {
      gridcolor: "#e6ecf1",
      zerolinecolor: "#c2ccd6",
      linecolor: "#c2ccd6",
      tickfont: { color: "#46586a", size: 11 },
      title: { font: { color: "#6b7c8c", size: 11 } },
    },
    legend: {
      bgcolor: "rgba(255,255,255,0)",
      font: { color: "#46586a", size: 11 },
      orientation: "h",
      y: -0.18,
    },
    hoverlabel: {
      bgcolor: "#ffffff",
      bordercolor: "#c2ccd6",
      font: { color: "#0e2233", size: 12 },
    },
  };

  const PLOTLY_CONFIG = {
    displaylogo: false,
    responsive: true,
    locale: "es-AR",
    modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"],
  };

  // Color palette for series — anclada en la identidad La Bancaria (los 6
  // primeros son la paleta categórica del sistema de diseño) y extendida con
  // tonos distinguibles, legibles sobre fondo claro y razonablemente
  // color-blind friendly.
  const COLORS = [
    "#0e9e74", "#1890d8", "#123c6b", "#e8a23d", "#6d5bd0",
    "#2ba8e0", "#c62f38", "#0a6e52", "#1268a8", "#b5179e",
    "#5c8001", "#9a6212", "#45c0e8", "#7a5195", "#475569",
  ];
  function colorFor(idx) { return COLORS[idx % COLORS.length]; }

  // -------------------------------------------------------------------------
  // Help (more info) collapsible
  // -------------------------------------------------------------------------
  async function attachHelp(host, codigo_dato) {
    const detalles = await BCRA.loadDetalles();
    const txt = detalles.get(parseInt(codigo_dato, 10)) || "Sin detalle disponible para este indicador.";
    host.innerHTML = `
      <details class="help">
        <summary>Más info</summary>
        <div class="help-body">${escapeHtml(txt)}</div>
      </details>`;
  }

  async function getDetalleText(codigo_dato) {
    const detalles = await BCRA.loadDetalles();
    return detalles.get(parseInt(codigo_dato, 10)) || "";
  }

  // -------------------------------------------------------------------------
  // Date range slider (dual-thumb) — replaces "Desde / Hasta" comboboxes.
  // Estilo Streamlit: una sola barra con dos handles que se arrastran sobre
  // el rango disponible de meses (yyyymm).
  //
  //   months: [yyyymm, yyyymm, ...] sorted asc
  //   opts.from / opts.to: yyyymm iniciales (caen al borde si no están)
  //   opts.onChange({from, to}) — disparado al soltar / al teclado
  //   opts.onInput({from, to})  — disparado en vivo durante el drag
  // -------------------------------------------------------------------------
  function dateRangeSlider(host, months, opts = {}) {
    if (!Array.isArray(months) || months.length === 0) {
      host.innerHTML = `<div class="muted small">Sin períodos disponibles.</div>`;
      return { setRange() {}, getRange() { return { from: null, to: null }; }, destroy() {} };
    }
    const minIdx = 0;
    const maxIdx = months.length - 1;
    let leftIdx = months.indexOf(opts.from);
    let rightIdx = months.indexOf(opts.to);
    if (leftIdx < 0) leftIdx = minIdx;
    if (rightIdx < 0) rightIdx = maxIdx;
    if (leftIdx > rightIdx) [leftIdx, rightIdx] = [rightIdx, leftIdx];

    function lbl(ym) { return `${Math.floor(ym / 100)}-${String(ym % 100).padStart(2, "0")}`; }

    host.classList.add("range-slider");
    host.innerHTML = `
      <div class="rs-labels">
        <span class="rs-label rs-label-from">${lbl(months[leftIdx])}</span>
        <span class="rs-arrow">→</span>
        <span class="rs-label rs-label-to">${lbl(months[rightIdx])}</span>
        <span class="rs-spacer"></span>
        <span class="rs-bounds">Disponible ${lbl(months[minIdx])} – ${lbl(months[maxIdx])}</span>
      </div>
      <div class="rs-track" role="group" aria-label="Rango de meses">
        <div class="rs-rail"></div>
        <div class="rs-range"></div>
        <div class="rs-thumb rs-thumb-left" tabindex="0" role="slider"
             aria-label="Mes inicial"
             aria-valuemin="${months[minIdx]}" aria-valuemax="${months[maxIdx]}" aria-valuenow="${months[leftIdx]}"></div>
        <div class="rs-thumb rs-thumb-right" tabindex="0" role="slider"
             aria-label="Mes final"
             aria-valuemin="${months[minIdx]}" aria-valuemax="${months[maxIdx]}" aria-valuenow="${months[rightIdx]}"></div>
      </div>
      <div class="rs-shortcuts">
        <button type="button" class="rs-shortcut" data-months="12">Último año</button>
        <button type="button" class="rs-shortcut" data-months="36">3 años</button>
        <button type="button" class="rs-shortcut" data-months="60">5 años</button>
        <button type="button" class="rs-shortcut" data-months="all">Todo</button>
      </div>
    `;

    const track = host.querySelector(".rs-track");
    const range = host.querySelector(".rs-range");
    const thumbLeft = host.querySelector(".rs-thumb-left");
    const thumbRight = host.querySelector(".rs-thumb-right");
    const labelFrom = host.querySelector(".rs-label-from");
    const labelTo = host.querySelector(".rs-label-to");

    function pctFor(idx) {
      if (maxIdx === minIdx) return 0;
      return ((idx - minIdx) / (maxIdx - minIdx)) * 100;
    }
    function idxAtX(clientX) {
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return minIdx;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return Math.round(minIdx + ratio * (maxIdx - minIdx));
    }

    function render() {
      const lp = pctFor(leftIdx);
      const rp = pctFor(rightIdx);
      thumbLeft.style.left = lp + "%";
      thumbRight.style.left = rp + "%";
      range.style.left = lp + "%";
      range.style.right = (100 - rp) + "%";
      labelFrom.textContent = lbl(months[leftIdx]);
      labelTo.textContent = lbl(months[rightIdx]);
      thumbLeft.setAttribute("aria-valuenow", String(months[leftIdx]));
      thumbRight.setAttribute("aria-valuenow", String(months[rightIdx]));
    }

    function fireInput() {
      if (typeof opts.onInput === "function") {
        opts.onInput({ from: months[leftIdx], to: months[rightIdx] });
      }
    }
    function fireChange() {
      if (typeof opts.onChange === "function") {
        opts.onChange({ from: months[leftIdx], to: months[rightIdx] });
      }
    }

    let dragging = null;
    function onPointerMove(e) {
      if (!dragging) return;
      let idx = idxAtX(e.clientX);
      if (dragging === "left") {
        idx = Math.max(minIdx, Math.min(rightIdx, idx));
        if (idx !== leftIdx) { leftIdx = idx; render(); fireInput(); }
      } else {
        idx = Math.min(maxIdx, Math.max(leftIdx, idx));
        if (idx !== rightIdx) { rightIdx = idx; render(); fireInput(); }
      }
    }
    function onPointerUp() {
      if (!dragging) return;
      dragging = null;
      document.body.classList.remove("rs-dragging");
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      fireChange();
    }
    function startDrag(side, e) {
      e.preventDefault();
      try { (e.target.setPointerCapture && e.pointerId != null) && e.target.setPointerCapture(e.pointerId); } catch {}
      dragging = side;
      document.body.classList.add("rs-dragging");
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
    }
    thumbLeft.addEventListener("pointerdown", (e) => startDrag("left", e));
    thumbRight.addEventListener("pointerdown", (e) => startDrag("right", e));

    track.addEventListener("pointerdown", (e) => {
      if (e.target === thumbLeft || e.target === thumbRight) return;
      const idx = idxAtX(e.clientX);
      const dl = Math.abs(idx - leftIdx);
      const dr = Math.abs(idx - rightIdx);
      const side = dl <= dr ? "left" : "right";
      // Move the closest thumb to the click point and start dragging it.
      if (side === "left") {
        leftIdx = Math.min(rightIdx, Math.max(minIdx, idx));
      } else {
        rightIdx = Math.max(leftIdx, Math.min(maxIdx, idx));
      }
      render();
      fireInput();
      startDrag(side, e);
    });

    function onKey(side, e) {
      let delta = 0;
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") delta = -1;
      else if (e.key === "ArrowRight" || e.key === "ArrowUp") delta = 1;
      else if (e.key === "PageDown") delta = -12;
      else if (e.key === "PageUp") delta = 12;
      else if (e.key === "Home") {
        e.preventDefault();
        if (side === "left") leftIdx = minIdx; else rightIdx = leftIdx;
        render(); fireChange(); return;
      } else if (e.key === "End") {
        e.preventDefault();
        if (side === "right") rightIdx = maxIdx; else leftIdx = rightIdx;
        render(); fireChange(); return;
      } else return;
      e.preventDefault();
      if (side === "left") {
        leftIdx = Math.max(minIdx, Math.min(rightIdx, leftIdx + delta));
      } else {
        rightIdx = Math.min(maxIdx, Math.max(leftIdx, rightIdx + delta));
      }
      render();
      fireChange();
    }
    thumbLeft.addEventListener("keydown", (e) => onKey("left", e));
    thumbRight.addEventListener("keydown", (e) => onKey("right", e));

    host.querySelectorAll(".rs-shortcut").forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = btn.getAttribute("data-months");
        if (v === "all") {
          leftIdx = minIdx;
          rightIdx = maxIdx;
        } else {
          const n = parseInt(v, 10);
          rightIdx = maxIdx;
          leftIdx = Math.max(minIdx, maxIdx - (n - 1));
        }
        render();
        fireChange();
      });
    });

    render();

    return {
      setRange(from, to) {
        const lf = months.indexOf(from);
        const rt = months.indexOf(to);
        if (lf >= 0) leftIdx = lf;
        if (rt >= 0) rightIdx = rt;
        if (leftIdx > rightIdx) [leftIdx, rightIdx] = [rightIdx, leftIdx];
        render();
      },
      getRange() {
        return { from: months[leftIdx], to: months[rightIdx] };
      },
      destroy() {
        host.innerHTML = "";
        host.classList.remove("range-slider");
      },
    };
  }

  // -------------------------------------------------------------------------
  // Single-month slider (one thumb) — para Panel y Ranking.
  // -------------------------------------------------------------------------
  function dateMonthSlider(host, months, opts = {}) {
    if (!Array.isArray(months) || months.length === 0) {
      host.innerHTML = `<div class="muted small">Sin períodos disponibles.</div>`;
      return { setValue() {}, getValue() { return null; }, destroy() {} };
    }
    const minIdx = 0;
    const maxIdx = months.length - 1;
    let idx = months.indexOf(opts.value);
    if (idx < 0) idx = maxIdx;

    function lbl(ym) { return `${Math.floor(ym / 100)}-${String(ym % 100).padStart(2, "0")}`; }

    host.classList.add("range-slider", "single");
    host.innerHTML = `
      <div class="rs-labels">
        <span class="rs-label rs-label-cur">${lbl(months[idx])}</span>
        <span class="rs-spacer"></span>
        <span class="rs-bounds">Disponible ${lbl(months[minIdx])} – ${lbl(months[maxIdx])}</span>
      </div>
      <div class="rs-track" role="group" aria-label="Mes">
        <div class="rs-rail"></div>
        <div class="rs-range"></div>
        <div class="rs-thumb rs-thumb-single" tabindex="0" role="slider"
             aria-label="Mes"
             aria-valuemin="${months[minIdx]}" aria-valuemax="${months[maxIdx]}" aria-valuenow="${months[idx]}"></div>
      </div>
    `;
    const track = host.querySelector(".rs-track");
    const range = host.querySelector(".rs-range");
    const thumb = host.querySelector(".rs-thumb-single");
    const labelCur = host.querySelector(".rs-label-cur");

    function pctFor(i) {
      if (maxIdx === minIdx) return 0;
      return ((i - minIdx) / (maxIdx - minIdx)) * 100;
    }
    function idxAtX(clientX) {
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return minIdx;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return Math.round(minIdx + ratio * (maxIdx - minIdx));
    }

    function render() {
      const p = pctFor(idx);
      thumb.style.left = p + "%";
      range.style.left = "0%";
      range.style.right = (100 - p) + "%";
      labelCur.textContent = lbl(months[idx]);
      thumb.setAttribute("aria-valuenow", String(months[idx]));
    }

    function fireInput() {
      if (typeof opts.onInput === "function") opts.onInput(months[idx]);
    }
    function fireChange() {
      if (typeof opts.onChange === "function") opts.onChange(months[idx]);
    }

    let dragging = false;
    function onMove(e) {
      if (!dragging) return;
      const ni = Math.max(minIdx, Math.min(maxIdx, idxAtX(e.clientX)));
      if (ni !== idx) { idx = ni; render(); fireInput(); }
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("rs-dragging");
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      fireChange();
    }
    function startDrag(e) {
      e.preventDefault();
      try { (e.target.setPointerCapture && e.pointerId != null) && e.target.setPointerCapture(e.pointerId); } catch {}
      dragging = true;
      document.body.classList.add("rs-dragging");
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    }
    thumb.addEventListener("pointerdown", startDrag);
    track.addEventListener("pointerdown", (e) => {
      if (e.target === thumb) return;
      idx = Math.max(minIdx, Math.min(maxIdx, idxAtX(e.clientX)));
      render();
      fireInput();
      startDrag(e);
    });
    thumb.addEventListener("keydown", (e) => {
      let delta = 0;
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") delta = -1;
      else if (e.key === "ArrowRight" || e.key === "ArrowUp") delta = 1;
      else if (e.key === "PageDown") delta = -12;
      else if (e.key === "PageUp") delta = 12;
      else if (e.key === "Home") { e.preventDefault(); idx = minIdx; render(); fireChange(); return; }
      else if (e.key === "End") { e.preventDefault(); idx = maxIdx; render(); fireChange(); return; }
      else return;
      e.preventDefault();
      idx = Math.max(minIdx, Math.min(maxIdx, idx + delta));
      render();
      fireChange();
    });

    render();

    return {
      setValue(v) {
        const i = months.indexOf(v);
        if (i >= 0) { idx = i; render(); }
      },
      getValue() { return months[idx]; },
      destroy() {
        host.innerHTML = "";
        host.classList.remove("range-slider", "single");
      },
    };
  }

  // -------------------------------------------------------------------------
  // Segmented control (radio-like buttons inline)
  // -------------------------------------------------------------------------
  function segmented(host, options, opts = {}) {
    let selected = opts.selected || (options[0] && options[0].value);
    host.classList.add("seg-control");
    host.innerHTML = options.map((o) => `
      <button type="button" class="seg-btn ${selected === o.value ? "active" : ""}" data-value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</button>
    `).join("");
    host.querySelectorAll(".seg-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = btn.getAttribute("data-value");
        if (v === selected) return;
        selected = v;
        host.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b.getAttribute("data-value") === selected));
        if (typeof opts.onChange === "function") opts.onChange(selected);
      });
    });
    return {
      getValue() { return selected; },
      setValue(v) {
        if (v === selected) return;
        selected = v;
        host.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b.getAttribute("data-value") === selected));
      },
    };
  }

  // -------------------------------------------------------------------------
  // Expose
  // -------------------------------------------------------------------------
  window.UI = {
    mountTopbar,
    mountFooter,
    showLoading,
    hideLoading,
    multiselect,
    combobox,
    dateRangeSlider,
    dateMonthSlider,
    segmented,
    debounce,
    escapeHtml,
    PLOTLY_LAYOUT,
    PLOTLY_CONFIG,
    colorFor,
    attachHelp,
    getDetalleText,
    getMonedaHomog,
  };
})();
