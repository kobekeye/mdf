export const AVAILABLE_THEMES = ['default', 'asterisk'] as const;
export const AVAILABLE_MODES = ['html', 'typst'] as const;

export function buildThemeOptions(selectedTheme: string): string {
  return AVAILABLE_THEMES
    .map((theme) => `<option value="${theme}"${theme === selectedTheme ? ' selected' : ''}>${theme}</option>`)
    .join('');
}

export function buildModeOptions(selectedMode: string): string {
  return AVAILABLE_MODES
    .map((mode) => {
      const label = mode === 'html' ? 'HTML' : 'Typst';
      return `<option value="${mode}"${mode === selectedMode ? ' selected' : ''}>${label}</option>`;
    })
    .join('');
}

export function buildPreviewControls(selectedTheme: string, selectedMode: string): string {
  return `<div id="mdf-controls">
    <div id="mdf-menu-panel" role="dialog" aria-label="Preview settings">
      <label class="mdf-menu-field" for="mdf-theme-select">
        <span>Theme</span>
        <select id="mdf-theme-select">${buildThemeOptions(selectedTheme)}</select>
      </label>
      <label class="mdf-menu-field" for="mdf-mode-select">
        <span>Mode</span>
        <select id="mdf-mode-select">${buildModeOptions(selectedMode)}</select>
      </label>
    </div>
    <button id="mdf-menu-toggle" type="button" aria-label="Preview settings" aria-haspopup="dialog" aria-expanded="false">☰</button>
  </div>`;
}
