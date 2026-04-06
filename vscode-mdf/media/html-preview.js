(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const content = document.getElementById('mdf-content');
  const themeSelect = document.getElementById('mdf-theme-select');

  // ── Zoom ──────────────────────────────────────────────────
  // Discrete factor table (à la pdf.js / tinymist) — steps widen at extremes
  const ZOOM_FACTORS = [
    0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1,
    1.1, 1.25, 1.5, 1.75, 2, 2.5, 3,
  ];
  const DELTA_THRESHOLD = 20;   // accumulated pixels before stepping
  const PIXEL_PER_LINE  = 20;   // deltaMode=1 (line) → pixel conversion

  const state = vscode.getState() || {};
  let zoomLevel = state.zoom || 1;
  let deltaAccum = 0;

  /** Snap to the nearest factor in the table */
  function nearestFactorIdx() {
    let best = 0;
    for (let i = 1; i < ZOOM_FACTORS.length; i++) {
      if (Math.abs(ZOOM_FACTORS[i] - zoomLevel) < Math.abs(ZOOM_FACTORS[best] - zoomLevel)) best = i;
    }
    return best;
  }

  function zoomIn()  { const i = nearestFactorIdx(); if (i < ZOOM_FACTORS.length - 1) { zoomLevel = ZOOM_FACTORS[i + 1]; applyZoom(); } }
  function zoomOut() { const i = nearestFactorIdx(); if (i > 0) { zoomLevel = ZOOM_FACTORS[i - 1]; applyZoom(); } }

  function applyZoom() {
    content.style.zoom = zoomLevel;
    vscode.setState({ ...vscode.getState(), zoom: zoomLevel });
    showZoomIndicator();
  }

  // Floating indicator (auto-hides)
  let indicatorTimer = null;
  function showZoomIndicator() {
    let el = document.getElementById('mdf-zoom-indicator');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mdf-zoom-indicator';
      document.body.appendChild(el);
    }
    el.textContent = Math.round(zoomLevel * 100) + '%';
    el.style.opacity = '1';
    clearTimeout(indicatorTimer);
    indicatorTimer = setTimeout(() => { el.style.opacity = '0'; }, 1200);
  }

  // Apply persisted zoom
  if (zoomLevel !== 1) applyZoom();

  // Ctrl+Scroll / trackpad pinch — accumulate delta before stepping (tinymist approach)
  window.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const pixels = e.deltaMode === 0 ? e.deltaY : e.deltaY * PIXEL_PER_LINE;
    deltaAccum += pixels;
    if (Math.abs(deltaAccum) < DELTA_THRESHOLD) return;
    if (deltaAccum > 0) zoomOut(); else zoomIn();
    deltaAccum = 0;
  }, { passive: false });

  // Ctrl+Plus / Ctrl+Minus / Ctrl+0
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomIn(); }
    else if (e.key === '-')            { e.preventDefault(); zoomOut(); }
    else if (e.key === '0')            { e.preventDefault(); zoomLevel = 1; applyZoom(); }
  });

  // ── Scroll restore ────────────────────────────────────────
  if (state.scrollTop) {
    window.scrollTo(0, state.scrollTop);
  }

  // Persist scroll position continuously
  window.addEventListener('scroll', () => {
    vscode.setState({ ...vscode.getState(), scrollTop: window.scrollY });
  });

  // Theme selector — notify extension on change
  if (themeSelect) {
    themeSelect.addEventListener('change', () => {
      vscode.postMessage({ type: 'switchTheme', theme: themeSelect.value });
    });
  }

  // Receive updates from the extension
  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'update') {
      const scrollTop = window.scrollY;
      content.innerHTML = msg.html;
      window.scrollTo(0, scrollTop);
      vscode.setState({ scrollTop });
    }
  });
})();
