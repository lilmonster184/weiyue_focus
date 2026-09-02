(() => {
  "use strict";

  const BUTTON_ATTRIBUTE = "data-wr-reader-fullscreen";
  const BACKGROUND_BUTTON_ATTRIBUTE = "data-wr-reader-background-button";
  const BACKGROUND_PICKER_ATTRIBUTE = "data-wr-reader-background-picker";
  const STYLE_ID = "wr-reader-fullscreen-style";
  const BOOK_SELECTOR = ".readerChapterContent";
  const TOOLBAR_SELECTOR = ".readerControls";
  const FALLBACK_CLASS = "wr-reader-fullscreen-fallback";
  const ROOT_FULLSCREEN_CLASS = "wr-reader-root-fullscreen";
  const SCROLL_READER_CLASS = "wr-reader-scroll-mode";
  const READING_MODE_READY_CLASS = "wr-reader-mode-ready";
  const IDLE_CURSOR_CLASS = "wr-reader-idle-cursor";
  const BACKGROUND_STORAGE_KEY = "wr-reader-reading-background";
  const CURSOR_IDLE_DELAY_MS = 1800;
  const FULLSCREEN_ICON_URL = chrome.runtime.getURL("fullscreen-icon.svg");

  const BACKGROUND_OPTIONS = [
    { id: "white", label: "白纸", color: "#ffffff" },
    { id: "eye", label: "护眼", color: "#edf5df" },
    { id: "paper", label: "纸质", color: "#f6f0e2" },
    { id: "parchment", label: "羊皮", color: "#ecdfc5" },
    { id: "mist", label: "雾蓝", color: "#edf3f4" },
    { id: "stone", label: "暖灰", color: "#f0efeb" }
  ];

  const ENTER_ICON = `<img src="${FULLSCREEN_ICON_URL}" alt="" aria-hidden="true">`;
  const BACKGROUND_ICON = `
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <rect x="14" y="13" width="20" height="22" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/>
      <circle cx="28.5" cy="19" r="1.8" fill="currentColor"/>
      <path d="M17.5 29c2.7-2.9 5.5-2.9 8.2 0 1.7-2 3.8-2.6 5.8-3.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  const EXIT_ICON = `
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path d="M20 14v6h-6M14 20l7-7M28 14v6h6M34 20l-7-7M20 34v-6h-6M14 28l7 7M28 34v-6h6M34 28l-7 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

  let cursorIdleTimer = 0;
  let readerRefreshFrame = 0;
  let readerRefreshTimer = 0;
  let layoutResizeFrame = 0;
  let layoutResizeTimer = 0;
  let layoutResizeActive = false;
  let backgroundInitialized = false;

  function getBook() {
    return document.querySelector(BOOK_SELECTOR);
  }

  function updateReadingMode() {
    const book = getBook();
    const hasScrollControl = Boolean(document.querySelector(".readerControls_item.isNormalReader"));
    const hasPreRenderLayer = Boolean(book?.querySelector(".preRenderContainer"));
    const hasRenderTarget = Boolean(book?.querySelector(".renderTargetContainer"));
    const modeIsReady = Boolean(book && (hasScrollControl || hasPreRenderLayer || hasRenderTarget));
    const scrollMode = modeIsReady && (hasScrollControl || (hasRenderTarget && !hasPreRenderLayer));
    document.documentElement.classList.toggle(SCROLL_READER_CLASS, scrollMode);
    document.documentElement.classList.toggle(READING_MODE_READY_CLASS, modeIsReady);
    if (book) {
      book.classList.toggle(SCROLL_READER_CLASS, scrollMode);
      book.classList.toggle(READING_MODE_READY_CLASS, modeIsReady);
    }
  }

  function queueReaderRefresh() {
    if (!readerRefreshFrame) {
      readerRefreshFrame = window.requestAnimationFrame(() => {
        readerRefreshFrame = 0;
        updateReadingMode();
        if (!document.querySelector(`[${BUTTON_ATTRIBUTE}]`) || !document.querySelector(`[${BACKGROUND_BUTTON_ATTRIBUTE}]`)) {
          ensureButton();
        }
      });
    }

    window.clearTimeout(readerRefreshTimer);
    readerRefreshTimer = window.setTimeout(() => {
      readerRefreshTimer = 0;
      updateReadingMode();
      if (!document.querySelector(`[${BUTTON_ATTRIBUTE}]`) || !document.querySelector(`[${BACKGROUND_BUTTON_ATTRIBUTE}]`)) {
        ensureButton();
      }
    }, 120);
  }

  function getFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function isRootFullscreen() {
    return document.documentElement.classList.contains(ROOT_FULLSCREEN_CLASS);
  }

  function getBackgroundOption(id) {
    return BACKGROUND_OPTIONS.find((option) => option.id === id) || BACKGROUND_OPTIONS[0];
  }

  function getBackgroundPicker() {
    return document.querySelector(`[${BACKGROUND_PICKER_ATTRIBUTE}]`);
  }

  function updateBackgroundButtonState() {
    const option = getBackgroundOption(document.documentElement.dataset.wrReaderBackground);
    const button = document.querySelector(`[${BACKGROUND_BUTTON_ATTRIBUTE}]`);
    if (button) {
      button.dataset.activeBackground = option.id;
      button.setAttribute("aria-label", `阅读背景：${option.label}`);
      button.title = `阅读背景：${option.label}`;
    }

    const picker = getBackgroundPicker();
    if (!picker) return;
    picker.querySelectorAll("[data-wr-reader-background-option]").forEach((swatch) => {
      swatch.classList.toggle("is-selected", swatch.dataset.wrReaderBackgroundOption === option.id);
    });
  }

  function applyReadingBackground(id, persist = true) {
    const option = getBackgroundOption(id);
    document.documentElement.dataset.wrReaderBackground = option.id;
    if (persist) {
      try {
        window.localStorage.setItem(BACKGROUND_STORAGE_KEY, option.id);
      } catch {
        // Reading remains usable when browser storage is unavailable.
      }
    }
    updateBackgroundButtonState();
  }

  function initializeReadingBackground() {
    if (backgroundInitialized) return;
    backgroundInitialized = true;

    let storedId = BACKGROUND_OPTIONS[0].id;
    try {
      storedId = window.localStorage.getItem(BACKGROUND_STORAGE_KEY) || storedId;
    } catch {
      // Use white paper when browser storage is unavailable.
    }
    applyReadingBackground(storedId, false);
  }

  function closeBackgroundPicker() {
    getBackgroundPicker()?.remove();
  }

  function positionBackgroundPicker() {
    const picker = getBackgroundPicker();
    const button = document.querySelector(`[${BACKGROUND_BUTTON_ATTRIBUTE}]`);
    if (!picker || !button) return;

    const buttonRect = button.getBoundingClientRect();
    const pickerRect = picker.getBoundingClientRect();
    const left = Math.max(8, buttonRect.left - pickerRect.width - 12);
    const top = Math.min(
      Math.max(8, buttonRect.top + (buttonRect.height - pickerRect.height) / 2),
      Math.max(8, window.innerHeight - pickerRect.height - 8)
    );

    picker.style.left = `${Math.round(left)}px`;
    picker.style.top = `${Math.round(top)}px`;
  }

  function openBackgroundPicker() {
    closeBackgroundPicker();

    const picker = document.createElement("div");
    picker.className = "wr-reader-background-picker is-open";
    picker.setAttribute(BACKGROUND_PICKER_ATTRIBUTE, "true");
    picker.setAttribute("role", "menu");
    picker.setAttribute("aria-label", "阅读背景");

    BACKGROUND_OPTIONS.forEach((option) => {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "wr-reader-background-swatch";
      swatch.dataset.wrReaderBackgroundOption = option.id;
      swatch.style.setProperty("--wr-reader-swatch-color", option.color);
      swatch.setAttribute("aria-label", option.label);
      swatch.title = option.label;
      swatch.addEventListener("click", () => {
        applyReadingBackground(option.id);
        closeBackgroundPicker();
      });
      picker.append(swatch);
    });

    document.body.append(picker);
    updateBackgroundButtonState();
    window.requestAnimationFrame(positionBackgroundPicker);
  }

  function toggleBackgroundPicker(event) {
    event.preventDefault();
    event.stopPropagation();
    if (getBackgroundPicker()) {
      closeBackgroundPicker();
    } else {
      openBackgroundPicker();
    }
  }

  function isFullscreenActive(book = getBook()) {
    return Boolean(book && (
      getFullscreenElement() === document.documentElement ||
      isRootFullscreen() ||
      book.classList.contains(FALLBACK_CLASS)
    ));
  }

  function clearIdleCursor() {
    window.clearTimeout(cursorIdleTimer);
    cursorIdleTimer = 0;
    document.documentElement.classList.remove(IDLE_CURSOR_CLASS);
  }

  function scheduleIdleCursor() {
    clearIdleCursor();
    if (!isFullscreenActive()) return;

    cursorIdleTimer = window.setTimeout(() => {
      if (isFullscreenActive()) {
        document.documentElement.classList.add(IDLE_CURSOR_CLASS);
      }
    }, CURSOR_IDLE_DELAY_MS);
  }

  function recordReadingActivity() {
    if (!isFullscreenActive()) {
      clearIdleCursor();
      return;
    }
    scheduleIdleCursor();
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      html {
        --wr-reader-reading-background: #fff;
      }

      html[data-wr-reader-background="eye"] {
        --wr-reader-reading-background: #edf5df;
      }

      html[data-wr-reader-background="paper"] {
        --wr-reader-reading-background: #f6f0e2;
      }

      html[data-wr-reader-background="parchment"] {
        --wr-reader-reading-background: #ecdfc5;
      }

      html[data-wr-reader-background="mist"] {
        --wr-reader-reading-background: #edf3f4;
      }

      html[data-wr-reader-background="stone"] {
        --wr-reader-reading-background: #f0efeb;
      }

      .wr-reader-fullscreen-button .wr-reader-fullscreen-icon {
        display: block;
        width: 48px;
        height: 48px;
        color: #858c96;
      }

      .wr-reader-fullscreen-button .wr-reader-fullscreen-icon svg {
        display: block;
        width: 48px;
        height: 48px;
      }

      .wr-reader-fullscreen-button .wr-reader-fullscreen-icon img {
        display: block;
        width: 48px;
        height: 48px;
      }

      .wr-reader-background-button .wr-reader-background-icon,
      .wr-reader-background-button .wr-reader-background-icon svg {
        display: block;
        width: 48px;
        height: 48px;
        color: #858c96;
      }

      .wr-reader-background-picker {
        position: fixed;
        z-index: 2147483646;
        display: none;
        grid-template-columns: repeat(3, 28px);
        gap: 9px;
        padding: 8px;
        box-sizing: border-box;
        background: #fff;
        border: 1px solid rgba(103, 112, 125, 0.13);
        border-radius: 8px;
        box-shadow: 0 10px 28px rgba(39, 46, 56, 0.16);
      }

      .wr-reader-background-picker.is-open {
        display: grid;
      }

      .wr-reader-background-swatch {
        width: 28px;
        height: 28px;
        padding: 0;
        border: 1px solid rgba(76, 84, 96, 0.18);
        border-radius: 50%;
        background: var(--wr-reader-swatch-color);
        cursor: pointer;
      }

      .wr-reader-background-swatch.is-selected {
        outline: 2px solid #7d8590;
        outline-offset: 2px;
      }

      /* Wait for WeRead's reader mode to be identifiable before coloring the frame. */
      html.${READING_MODE_READY_CLASS}[data-wr-reader-background]:not(.${SCROLL_READER_CLASS}) .readerChapterContent {
        background-color: var(--wr-reader-reading-background) !important;
      }

      /* In scroll reading, color the same centered frame as the WeRead top bar. */
      html.${READING_MODE_READY_CLASS}.${SCROLL_READER_CLASS}[data-wr-reader-background] .app_content {
        background-color: var(--wr-reader-reading-background) !important;
      }

      html.${IDLE_CURSOR_CLASS},
      html.${IDLE_CURSOR_CLASS} * {
        cursor: none !important;
      }

      /* Keep force-select extensions out of WeRead's own canvas selection layer. */
      html .readerChapterContent .wr_canvasContainer,
      html .readerChapterContent .wr_canvasContainer * {
        -webkit-user-select: none !important;
        -moz-user-select: none !important;
        user-select: none !important;
      }

      .readerChapterContent:fullscreen,
      .readerChapterContent:-webkit-full-screen {
        box-sizing: border-box !important;
        width: 100vw !important;
        height: 100vh !important;
        min-width: 0 !important;
        min-height: 0 !important;
        max-width: none !important;
        max-height: none !important;
        margin: 0 !important;
        padding: 0 !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        overflow: hidden !important;
        background: var(--wr-reader-reading-background) !important;
      }

      .readerChapterContent:fullscreen .renderTargetContainer,
      .readerChapterContent:fullscreen .wr_canvasContainer,
      .readerChapterContent:-webkit-full-screen .renderTargetContainer,
      .readerChapterContent:-webkit-full-screen .wr_canvasContainer {
        width: 100% !important;
        height: 100% !important;
      }

      .readerChapterContent:fullscreen .reader_float_top_reviews_panel_wrapper,
      .readerChapterContent:fullscreen .reader_float_search_panel_wrapper,
      .readerChapterContent:fullscreen .wr_reader_float_corner_bookmark_wrapper,
      .readerChapterContent:-webkit-full-screen .reader_float_top_reviews_panel_wrapper,
      .readerChapterContent:-webkit-full-screen .reader_float_search_panel_wrapper,
      .readerChapterContent:-webkit-full-screen .wr_reader_float_corner_bookmark_wrapper {
        display: none !important;
      }

      .readerChapterContent:fullscreen .reader_float_review_with_range_panel_wrapper,
      .readerChapterContent:-webkit-full-screen .reader_float_review_with_range_panel_wrapper {
        display: flex !important;
        visibility: visible !important;
        z-index: 99999 !important;
      }

      .${FALLBACK_CLASS}:not(.${SCROLL_READER_CLASS}) {
        position: fixed !important;
        z-index: 2147483000 !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        min-width: 0 !important;
        min-height: 0 !important;
        max-width: none !important;
        max-height: none !important;
        box-sizing: border-box !important;
        margin: 0 !important;
        padding: 0 !important;
        border-radius: 0 !important;
        overflow: hidden !important;
        background: var(--wr-reader-reading-background) !important;
      }

      .${FALLBACK_CLASS}.${SCROLL_READER_CLASS} {
        /* Keep WeRead's original scroll layout. Its selection canvas relies on it. */
        background: transparent !important;
      }

      body:has(.${FALLBACK_CLASS}:not(.${SCROLL_READER_CLASS})) {
        overflow: hidden !important;
        background: var(--wr-reader-reading-background) !important;
      }

      body:has(.${FALLBACK_CLASS}.${SCROLL_READER_CLASS}) {
        overflow-x: hidden !important;
        overflow-y: auto !important;
      }

      html.${SCROLL_READER_CLASS}:has(.${FALLBACK_CLASS}) {
        overflow-x: hidden !important;
        overflow-y: auto !important;
      }

      body:has(.${FALLBACK_CLASS}.${SCROLL_READER_CLASS}),
      body:has(.${FALLBACK_CLASS}.${SCROLL_READER_CLASS}) .app,
      body:has(.${FALLBACK_CLASS}.${SCROLL_READER_CLASS}) .routerView,
      body:has(.${FALLBACK_CLASS}.${SCROLL_READER_CLASS}) .readerContent,
      body:has(.${FALLBACK_CLASS}.${SCROLL_READER_CLASS}) .app_content,
      body:has(.${FALLBACK_CLASS}.${SCROLL_READER_CLASS}) .wr_various_font_provider_wrapper,
      body:has(.${FALLBACK_CLASS}.${SCROLL_READER_CLASS}) .readerChapterContent_container {
        background: var(--wr-reader-reading-background) !important;
      }

      body:has(.${FALLBACK_CLASS}) .readerTopBar,
      body:has(.${FALLBACK_CLASS}) .readerControls {
        display: none !important;
      }

      html.${ROOT_FULLSCREEN_CLASS}:fullscreen,
      html.${ROOT_FULLSCREEN_CLASS}:-webkit-full-screen {
        background: var(--wr-reader-reading-background) !important;
      }

      html.${ROOT_FULLSCREEN_CLASS}:fullscreen body,
      html.${ROOT_FULLSCREEN_CLASS}:-webkit-full-screen body {
        background: var(--wr-reader-reading-background) !important;
      }

      html.${ROOT_FULLSCREEN_CLASS}:fullscreen:not(.${SCROLL_READER_CLASS}) body,
      html.${ROOT_FULLSCREEN_CLASS}:not(.${SCROLL_READER_CLASS}):-webkit-full-screen body {
        overflow: hidden !important;
      }

      html.${ROOT_FULLSCREEN_CLASS}:fullscreen body > .app,
      html.${ROOT_FULLSCREEN_CLASS}:-webkit-full-screen body > .app,
      html.${ROOT_FULLSCREEN_CLASS}:fullscreen .app,
      html.${ROOT_FULLSCREEN_CLASS}:-webkit-full-screen .app,
      html.${ROOT_FULLSCREEN_CLASS}:fullscreen .reader_footerNote_container,
      html.${ROOT_FULLSCREEN_CLASS}:-webkit-full-screen .reader_footerNote_container,
      html.${ROOT_FULLSCREEN_CLASS}:fullscreen .reader_footerNote_container *,
      html.${ROOT_FULLSCREEN_CLASS}:-webkit-full-screen .reader_footerNote_container *,
      html.${ROOT_FULLSCREEN_CLASS}:fullscreen body > .app .readerChapterContent_container,
      html.${ROOT_FULLSCREEN_CLASS}:-webkit-full-screen body > .app .readerChapterContent_container,
      html.${ROOT_FULLSCREEN_CLASS}:fullscreen body > .app .readerChapterContent_container > .readerChapterContent,
      html.${ROOT_FULLSCREEN_CLASS}:-webkit-full-screen body > .app .readerChapterContent_container > .readerChapterContent {
        visibility: visible !important;
      }

      html.${ROOT_FULLSCREEN_CLASS}:fullscreen .review_editor_container,
      html.${ROOT_FULLSCREEN_CLASS}:-webkit-full-screen .review_editor_container {
        visibility: visible !important;
        z-index: 2147483647 !important;
        pointer-events: auto !important;
      }

      html.${ROOT_FULLSCREEN_CLASS}:fullscreen .review_editor_container:not([style*="display: none"]),
      html.${ROOT_FULLSCREEN_CLASS}:-webkit-full-screen .review_editor_container:not([style*="display: none"]) {
        display: flex !important;
      }

      body:has(.${FALLBACK_CLASS}) > .review_editor_container,
      body:has(.${FALLBACK_CLASS}) > .review_editor_container * {
        visibility: visible !important;
      }

      body:has(.${FALLBACK_CLASS}) > .review_editor_container {
        z-index: 2147483647 !important;
        pointer-events: auto !important;
      }

      html.${ROOT_FULLSCREEN_CLASS}:not(.${SCROLL_READER_CLASS}):fullscreen body > .app,
      html.${ROOT_FULLSCREEN_CLASS}:not(.${SCROLL_READER_CLASS}):-webkit-full-screen body > .app {
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        background: var(--wr-reader-reading-background) !important;
      }

      html.${ROOT_FULLSCREEN_CLASS}:not(.${SCROLL_READER_CLASS}):fullscreen .app,
      html.${ROOT_FULLSCREEN_CLASS}:not(.${SCROLL_READER_CLASS}):-webkit-full-screen .app {
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        background: var(--wr-reader-reading-background) !important;
      }

      html.${ROOT_FULLSCREEN_CLASS}:fullscreen .readerTopBar,
      html.${ROOT_FULLSCREEN_CLASS}:fullscreen .readerControls,
      html.${ROOT_FULLSCREEN_CLASS}:-webkit-full-screen .readerTopBar,
      html.${ROOT_FULLSCREEN_CLASS}:-webkit-full-screen .readerControls {
        display: none !important;
      }

      html.${ROOT_FULLSCREEN_CLASS}:not(.${SCROLL_READER_CLASS}):fullscreen .readerChapterContent_container,
      html.${ROOT_FULLSCREEN_CLASS}:not(.${SCROLL_READER_CLASS}):-webkit-full-screen .readerChapterContent_container {
        position: fixed !important;
        inset: 0 !important;
        display: block !important;
        width: 100vw !important;
        height: 100vh !important;
        min-width: 0 !important;
        min-height: 0 !important;
        max-width: none !important;
        max-height: none !important;
        box-sizing: border-box !important;
        background: var(--wr-reader-reading-background) !important;
      }

      html.${ROOT_FULLSCREEN_CLASS}:not(.${SCROLL_READER_CLASS}):fullscreen .readerChapterContent,
      html.${ROOT_FULLSCREEN_CLASS}:not(.${SCROLL_READER_CLASS}):-webkit-full-screen .readerChapterContent {
        position: absolute !important;
        inset: 0 !important;
        width: 100% !important;
        height: 100% !important;
        min-width: 0 !important;
        min-height: 0 !important;
        max-width: none !important;
        max-height: none !important;
        box-sizing: border-box !important;
        margin: 0 !important;
        padding: 0 !important;
        border-radius: 0 !important;
        background: var(--wr-reader-reading-background) !important;
      }

      html.${ROOT_FULLSCREEN_CLASS}:fullscreen .reader_float_review_with_range_panel_wrapper,
      html.${ROOT_FULLSCREEN_CLASS}:-webkit-full-screen .reader_float_review_with_range_panel_wrapper {
        display: flex !important;
        visibility: visible !important;
        z-index: 99999 !important;
      }

      html.${ROOT_FULLSCREEN_CLASS}:fullscreen .reader_footerNote_container,
      html.${ROOT_FULLSCREEN_CLASS}:-webkit-full-screen .reader_footerNote_container {
        visibility: visible !important;
        z-index: 2147483646 !important;
        pointer-events: auto !important;
      }

      html.${ROOT_FULLSCREEN_CLASS}.${SCROLL_READER_CLASS}:fullscreen body,
      html.${ROOT_FULLSCREEN_CLASS}.${SCROLL_READER_CLASS}:-webkit-full-screen body {
        overflow: visible !important;
        background: var(--wr-reader-reading-background) !important;
      }

      html.${ROOT_FULLSCREEN_CLASS}.${SCROLL_READER_CLASS}:fullscreen,
      html.${ROOT_FULLSCREEN_CLASS}.${SCROLL_READER_CLASS}:-webkit-full-screen {
        overflow-x: hidden !important;
        overflow-y: auto !important;
      }

      html.${ROOT_FULLSCREEN_CLASS}.${SCROLL_READER_CLASS}:fullscreen body > .app,
      html.${ROOT_FULLSCREEN_CLASS}.${SCROLL_READER_CLASS}:-webkit-full-screen body > .app,
      html.${ROOT_FULLSCREEN_CLASS}.${SCROLL_READER_CLASS}:fullscreen .app,
      html.${ROOT_FULLSCREEN_CLASS}.${SCROLL_READER_CLASS}:-webkit-full-screen .app,
      html.${ROOT_FULLSCREEN_CLASS}.${SCROLL_READER_CLASS}:fullscreen .routerView,
      html.${ROOT_FULLSCREEN_CLASS}.${SCROLL_READER_CLASS}:-webkit-full-screen .routerView,
      html.${ROOT_FULLSCREEN_CLASS}.${SCROLL_READER_CLASS}:fullscreen .readerContent,
      html.${ROOT_FULLSCREEN_CLASS}.${SCROLL_READER_CLASS}:-webkit-full-screen .readerContent,
      html.${ROOT_FULLSCREEN_CLASS}.${SCROLL_READER_CLASS}:fullscreen .app_content,
      html.${ROOT_FULLSCREEN_CLASS}.${SCROLL_READER_CLASS}:-webkit-full-screen .app_content,
      html.${ROOT_FULLSCREEN_CLASS}.${SCROLL_READER_CLASS}:fullscreen .wr_various_font_provider_wrapper,
      html.${ROOT_FULLSCREEN_CLASS}.${SCROLL_READER_CLASS}:-webkit-full-screen .wr_various_font_provider_wrapper,
      html.${ROOT_FULLSCREEN_CLASS}.${SCROLL_READER_CLASS}:fullscreen .readerChapterContent_container,
      html.${ROOT_FULLSCREEN_CLASS}.${SCROLL_READER_CLASS}:-webkit-full-screen .readerChapterContent_container {
        background: var(--wr-reader-reading-background) !important;
      }


    `;
    document.head.appendChild(style);
  }

  function createButton() {
    const wrapper = document.createElement("div");
    wrapper.className = "wr_tooltip_container";
    wrapper.setAttribute("data-wr-reader-fullscreen-wrapper", "true");
    wrapper.style.setProperty("--offset", "6px");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "readerControls_item wr-reader-fullscreen-button";
    button.setAttribute(BUTTON_ATTRIBUTE, "true");
    button.setAttribute("aria-label", "全屏");
    button.innerHTML = `<span class="wr-reader-fullscreen-icon">${ENTER_ICON}</span>`;
    button.addEventListener("click", toggleFullscreen);

    wrapper.append(button);
    return wrapper;
  }

  function createBackgroundButton() {
    const wrapper = document.createElement("div");
    wrapper.className = "wr_tooltip_container";
    wrapper.setAttribute("data-wr-reader-background-wrapper", "true");
    wrapper.style.setProperty("--offset", "6px");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "readerControls_item wr-reader-background-button";
    button.setAttribute(BACKGROUND_BUTTON_ATTRIBUTE, "true");
    button.setAttribute("aria-label", "阅读背景");
    button.title = "阅读背景";
    button.innerHTML = `<span class="wr-reader-background-icon">${BACKGROUND_ICON}</span>`;
    button.addEventListener("click", toggleBackgroundPicker);

    wrapper.append(button);
    return wrapper;
  }

  function updateButtonState() {
    const button = document.querySelector(`[${BUTTON_ATTRIBUTE}]`);
    if (!button) return;

    const book = getBook();
    const active = Boolean(book && (getFullscreenElement() === book || isRootFullscreen() || book.classList.contains(FALLBACK_CLASS)));
    const label = active ? "退出全屏" : "全屏";
    button.setAttribute("aria-label", label);
    button.dataset.active = String(active);

    const icon = button.querySelector(".wr-reader-fullscreen-icon");
    if (icon) icon.innerHTML = active ? EXIT_ICON : ENTER_ICON;

  }

  function ensureButton() {
    addStyles();
    updateReadingMode();
    initializeReadingBackground();

    const toolbar = document.querySelector(TOOLBAR_SELECTOR);
    if (!toolbar) return;

    if (!toolbar.querySelector(`[${BACKGROUND_BUTTON_ATTRIBUTE}]`)) {
      toolbar.appendChild(createBackgroundButton());
    }

    if (!toolbar.querySelector(`[${BUTTON_ATTRIBUTE}]`)) {
      toolbar.appendChild(createButton());
    }

    updateBackgroundButtonState();
    updateButtonState();
  }

  function notifyLayoutChange() {
    if (!layoutResizeActive) {
      layoutResizeActive = true;
      layoutResizeFrame = window.requestAnimationFrame(() => {
        layoutResizeFrame = 0;
        window.dispatchEvent(new Event("resize"));
      });
    }

    window.clearTimeout(layoutResizeTimer);
    layoutResizeTimer = window.setTimeout(() => {
      layoutResizeTimer = 0;
      if (layoutResizeFrame) {
        window.cancelAnimationFrame(layoutResizeFrame);
        layoutResizeFrame = 0;
      }
      window.dispatchEvent(new Event("resize"));
      layoutResizeActive = false;
    }, 120);
  }

  async function enterFullscreen(book) {
    const root = document.documentElement;
    updateReadingMode();
    if (root.requestFullscreen || root.webkitRequestFullscreen) {
      root.classList.add(ROOT_FULLSCREEN_CLASS);
      try {
        if (root.requestFullscreen) {
          try {
            await root.requestFullscreen({ navigationUI: "hide" });
          } catch {
            await root.requestFullscreen();
          }
        } else {
          root.webkitRequestFullscreen();
        }
        return;
      } catch {
        root.classList.remove(ROOT_FULLSCREEN_CLASS);
      }
    }

    // Keep a usable page-only fallback for browsers without Fullscreen API.
    book.classList.add(FALLBACK_CLASS);
  }

  async function exitFullscreen(book) {
    const root = document.documentElement;
    if (getFullscreenElement()) {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
      root.classList.remove(ROOT_FULLSCREEN_CLASS);
      return;
    }

    root.classList.remove(ROOT_FULLSCREEN_CLASS);
    book.classList.remove(FALLBACK_CLASS);
  }

  async function toggleFullscreen() {
    const book = getBook();
    if (!book) return;

    closeBackgroundPicker();
    if (getFullscreenElement() === document.documentElement || isRootFullscreen() || book.classList.contains(FALLBACK_CLASS)) {
      await exitFullscreen(book);
    } else {
      await enterFullscreen(book);
    }

    updateButtonState();
    notifyLayoutChange();
    scheduleIdleCursor();
  }

  function handleFullscreenChange() {
    const book = getBook();
    updateReadingMode();
    if (book && getFullscreenElement() !== book && !isRootFullscreen()) {
      book.classList.remove(FALLBACK_CLASS);
    }
    if (!getFullscreenElement()) {
      document.documentElement.classList.remove(ROOT_FULLSCREEN_CLASS);
    }
    updateButtonState();
    notifyLayoutChange();
    scheduleIdleCursor();
  }

  document.addEventListener("fullscreenchange", handleFullscreenChange);
  document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(`[data-wr-reader-background-wrapper]`) || target.closest(`[${BACKGROUND_PICKER_ATTRIBUTE}]`)) return;
    closeBackgroundPicker();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeBackgroundPicker();
  });
  document.addEventListener("mousemove", recordReadingActivity, { passive: true });
  document.addEventListener("mousedown", recordReadingActivity, { passive: true });
  document.addEventListener("wheel", recordReadingActivity, { passive: true });
  document.addEventListener("keydown", recordReadingActivity, { passive: true });
  document.addEventListener("touchstart", recordReadingActivity, { passive: true });
  window.addEventListener("resize", positionBackgroundPicker);

  const observer = new MutationObserver(queueReaderRefresh);
  observer.observe(document.body, { childList: true, subtree: true });

  ensureButton();
})();
