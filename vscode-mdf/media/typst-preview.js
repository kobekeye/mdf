(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const pages = document.getElementById('typst-pages');

  // Restore scroll position from persisted state
  const state = vscode.getState();
  if (state && state.scrollTop) {
    window.scrollTo(0, state.scrollTop);
  }

  // Persist scroll position continuously
  window.addEventListener('scroll', () => {
    vscode.setState({ scrollTop: window.scrollY });
  });

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * Split a single multi-page Typst SVG into one <svg> per page,
   * so each page renders with its own shadow / margin (like tinymist).
   */
  function splitPages() {
    const svg = pages.querySelector('svg');
    if (!svg) return;

    const pageGroups = svg.querySelectorAll(':scope > g.typst-page');
    if (pageGroups.length <= 1) return; // single page — already fine

    // Shared <style> and <defs> (glyph definitions, etc.)
    const style = svg.querySelector('style');
    const defs = svg.querySelector('defs');
    const svgNS = 'http://www.w3.org/2000/svg';

    const fragment = document.createDocumentFragment();

    pageGroups.forEach((pg) => {
      const pw = pg.getAttribute('data-page-width');
      const ph = pg.getAttribute('data-page-height');

      const newSvg = document.createElementNS(svgNS, 'svg');
      newSvg.setAttribute('class', 'typst-doc');
      newSvg.setAttribute('viewBox', '0 0 ' + pw + ' ' + ph);
      newSvg.setAttribute('width', pw);
      newSvg.setAttribute('height', ph);
      newSvg.style.overflow = 'visible';

      if (style) newSvg.appendChild(style.cloneNode(true));
      if (defs) newSvg.appendChild(defs.cloneNode(true));

      const pgClone = pg.cloneNode(true);
      pgClone.setAttribute('transform', 'translate(0, 0)');
      newSvg.appendChild(pgClone);

      fragment.appendChild(newSvg);
    });

    pages.innerHTML = '';
    pages.appendChild(fragment);
  }

  // Split pages on initial load
  splitPages();

  // Receive updates from the extension
  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'update') {
      const scrollTop = window.scrollY;
      if (msg.svg) {
        pages.innerHTML = msg.svg;
        splitPages();
      } else if (msg.error) {
        pages.innerHTML = `<div class="typst-error">${escapeHtml(msg.error)}</div>`;
      }
      window.scrollTo(0, scrollTop);
      vscode.setState({ scrollTop });
    }
  });
})();
