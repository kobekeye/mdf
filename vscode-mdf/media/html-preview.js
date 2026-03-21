(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const content = document.getElementById('mdf-content');

  // Restore scroll position from persisted state
  const state = vscode.getState();
  if (state && state.scrollTop) {
    window.scrollTo(0, state.scrollTop);
  }

  // Persist scroll position continuously
  window.addEventListener('scroll', () => {
    vscode.setState({ scrollTop: window.scrollY });
  });

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
