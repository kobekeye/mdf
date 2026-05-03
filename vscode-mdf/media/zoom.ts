// Discrete-step zoom controller, shared shape used by the Typst preview.
// Mirrors the pdf.js / tinymist factor table — steps widen at extremes.

export const ZOOM_FACTORS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1,
  1.1, 1.25, 1.5, 1.75, 2, 2.5, 3,
];

const DELTA_THRESHOLD = 20;
const PIXEL_PER_LINE = 20;
const ACCUM_RESET_MS = 180;

export function nearestFactorIdx(level: number): number {
  let best = 0;
  for (let i = 1; i < ZOOM_FACTORS.length; i++) {
    if (Math.abs(ZOOM_FACTORS[i] - level) < Math.abs(ZOOM_FACTORS[best] - level)) best = i;
  }
  return best;
}

export interface ZoomOptions {
  initialLevel: number;
  onZoomChange(level: number, source: 'wheel' | 'key' | 'reset'): void;
}

export interface ZoomController {
  getLevel(): number;
  step(direction: 1 | -1, source: 'wheel' | 'key'): boolean;
  reset(): void;
}

/** Wires Ctrl/⌘+wheel and Ctrl/⌘+`+`/`-`/`0` to step the zoom level. */
export function installZoom(opts: ZoomOptions): ZoomController {
  let level = opts.initialLevel;
  let deltaAccum = 0;
  let lastWheelAt = 0;
  let lastWheelDirection = 0;

  function step(direction: 1 | -1, source: 'wheel' | 'key'): boolean {
    const idx = nearestFactorIdx(level);
    const next = idx + direction;
    if (next < 0 || next >= ZOOM_FACTORS.length) return false;
    level = ZOOM_FACTORS[next];
    opts.onZoomChange(level, source);
    return true;
  }

  function reset(): void {
    level = 1;
    opts.onZoomChange(level, 'reset');
  }

  window.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();

    const pixels = e.deltaMode === 0 ? e.deltaY : e.deltaY * PIXEL_PER_LINE;
    const direction = Math.sign(pixels);
    const now = Date.now();
    if (
      direction !== 0 &&
      (direction !== lastWheelDirection || now - lastWheelAt > ACCUM_RESET_MS)
    ) {
      deltaAccum = 0;
    }
    lastWheelDirection = direction;
    lastWheelAt = now;
    deltaAccum += pixels;

    while (Math.abs(deltaAccum) >= DELTA_THRESHOLD) {
      const consumed = DELTA_THRESHOLD * Math.sign(deltaAccum);
      if (!step(consumed < 0 ? 1 : -1, 'wheel')) {
        deltaAccum = 0;
        break;
      }
      deltaAccum -= consumed;
    }
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === '=' || e.key === '+') {
      e.preventDefault();
      step(1, 'key');
    } else if (e.key === '-') {
      e.preventDefault();
      step(-1, 'key');
    } else if (e.key === '0') {
      e.preventDefault();
      reset();
    }
  });

  return {
    getLevel: () => level,
    step,
    reset,
  };
}

/** Floating zoom indicator that fades after `holdMs`. */
export function createZoomIndicator(id: string, holdMs = 1200): (level: number) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (level: number) => {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      document.body.appendChild(el);
    }
    el.textContent = `${Math.round(level * 100)}%`;
    el.classList.add('visible');
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => el!.classList.remove('visible'), holdMs);
  };
}
