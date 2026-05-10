import { patchRoot } from '@myriaddreamin/typst.ts/render/svg/patch';

function svgHeaderKey(el: Element): string | null {
  if (el.tagName === 'style') return 'style';
  if (el.tagName === 'defs') return `defs:${el.getAttribute('class') || ''}`;
  return null;
}

function svgHeaderRank(key: string): number {
  if (key === 'style') return 0;
  if (key === 'defs:glyph') return 1;
  if (key === 'defs:clip-path') return 2;
  return 3;
}

function createSvgHeaderPlaceholder(prevHeader: Element): Element | null {
  const key = svgHeaderKey(prevHeader);
  if (!key) return null;

  if (key === 'style') {
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.setAttribute('data-reuse', '1');
    return style;
  }

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const className = prevHeader.getAttribute('class');
  if (className) defs.setAttribute('class', className);
  return defs;
}

function normalizeSvgResourceHeaders(svg: SVGElement): void {
  const headers = new Map<string, Element>();
  const duplicates: Element[] = [];

  for (const child of Array.from(svg.children)) {
    const key = svgHeaderKey(child);
    if (!key) continue;

    if (headers.has(key)) {
      duplicates.push(child);
    } else {
      headers.set(key, child);
    }
  }

  for (const duplicate of duplicates) duplicate.remove();

  const orderedHeaders = Array.from(headers.entries())
    .sort(([a], [b]) => svgHeaderRank(a) - svgHeaderRank(b))
    .map(([, el]) => el);

  if (orderedHeaders.length === 0) return;

  const fragment = document.createDocumentFragment();
  for (const header of orderedHeaders) fragment.appendChild(header);
  svg.insertBefore(fragment, svg.firstChild);
}

function alignSvgPatchHeader(prevSvg: SVGElement, nextSvg: SVGElement): void {
  normalizeSvgResourceHeaders(prevSvg);
  normalizeSvgResourceHeaders(nextSvg);

  const nextHeaders = new Map<string, Element>();
  for (const child of Array.from(nextSvg.children)) {
    const key = svgHeaderKey(child);
    if (key && !nextHeaders.has(key)) nextHeaders.set(key, child);
  }

  const orderedHeaders: Element[] = [];
  for (const prevChild of Array.from(prevSvg.children)) {
    if (prevChild.tagName === 'g') break;

    const key = svgHeaderKey(prevChild);
    if (!key) continue;

    const nextHeader = nextHeaders.get(key) || createSvgHeaderPlaceholder(prevChild);
    if (nextHeader) orderedHeaders.push(nextHeader);
  }

  if (orderedHeaders.length === 0) return;

  const fragment = document.createDocumentFragment();
  for (const header of orderedHeaders) fragment.appendChild(header);
  nextSvg.insertBefore(fragment, nextSvg.firstChild);
}

export function replaceOrPatchSvg(container: Element, svgText: string): void {
  if (container.firstElementChild instanceof SVGElement) {
    const scratch = document.createElement('div');
    scratch.innerHTML = svgText;
    const nextSvg = scratch.firstElementChild;
    if (nextSvg instanceof SVGElement) {
      const prevSvg = container.firstElementChild;
      alignSvgPatchHeader(prevSvg, nextSvg);
      patchRoot(prevSvg, nextSvg);
      normalizeSvgResourceHeaders(prevSvg);
      return;
    }
  }

  container.innerHTML = svgText;
}
