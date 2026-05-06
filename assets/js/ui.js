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
    ];
    const navHtml = pages.map((p) => {
      const cls = p.key === activePage ? "active" : "";
      return `<a class="${cls}" href="${p.href}"><span style="font-size:13px;opacity:0.7">${p.icon}</span>${p.label}</a>`;
    }).join("");
    return `
      <div class="topbar">
        <a href="index.html" class="brand">
          <span class="brand-mark">B</span>
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
        <div>Datos: BCRA + INDEC. Reglas: outliers % &gt; 99000 ignorados; valores 0 reemplazados por el mes previo.</div>
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
  // Plotly default layout (dark theme)
  // -------------------------------------------------------------------------
  const PLOTLY_LAYOUT = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: "#e7eaf3", family: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif", size: 12 },
    margin: { l: 50, r: 18, t: 30, b: 40 },
    xaxis: {
      gridcolor: "#262e3d",
      zerolinecolor: "#3a455c",
      tickfont: { color: "#b6bccb", size: 11 },
      title: { font: { color: "#7a8197", size: 11 } },
    },
    yaxis: {
      gridcolor: "#262e3d",
      zerolinecolor: "#3a455c",
      tickfont: { color: "#b6bccb", size: 11 },
      title: { font: { color: "#7a8197", size: 11 } },
    },
    legend: {
      bgcolor: "rgba(0,0,0,0)",
      font: { color: "#b6bccb", size: 11 },
      orientation: "h",
      y: -0.18,
    },
    hoverlabel: {
      bgcolor: "#1e2532",
      bordercolor: "#3a455c",
      font: { color: "#e7eaf3", size: 12 },
    },
  };

  const PLOTLY_CONFIG = {
    displaylogo: false,
    responsive: true,
    locale: "es-AR",
    modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"],
  };

  // Color palette for series (color-blind friendly-ish)
  const COLORS = [
    "#9bd1ff", "#c084fc", "#21c87a", "#f4b740", "#ff8aa0",
    "#6fa8ff", "#ffd166", "#86e3ce", "#fa8baf", "#a78bfa",
    "#7dd3fc", "#fb7185", "#34d399", "#fbbf24", "#60a5fa",
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
    debounce,
    escapeHtml,
    PLOTLY_LAYOUT,
    PLOTLY_CONFIG,
    colorFor,
    attachHelp,
    getMonedaHomog,
  };
})();
