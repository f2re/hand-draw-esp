import { cleanPaths, simplifyPaths } from './core.js';

const MAX_SVG_BYTES = 2_000_000;
const MAX_SVG_ELEMENTS = 10_000;
const MAX_SVG_DIMENSION = 100_000;

const ALLOWED_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'symbol', 'title', 'desc',
  'path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse', 'use',
]);

const ALLOWED_ATTRIBUTES = new Set([
  'id', 'viewbox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'transform',
  'href', 'xlink:href', 'preserveaspectratio',
  'display', 'visibility', 'opacity', 'fill', 'stroke', 'stroke-width',
  'fill-rule', 'clip-rule', 'vector-effect',
]);

function matrixPoint(matrix, point) {
  if (!matrix) return { x: point.x, y: point.y };
  return { x: matrix.a * point.x + matrix.c * point.y + matrix.e, y: matrix.b * point.x + matrix.d * point.y + matrix.f };
}

function elementIsVisible(element) {
  if (element.closest('defs,symbol')) return false;
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
}

function unsafeAttributeValue(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized.includes('javascript:')
    || normalized.includes('data:text/html')
    || normalized.includes('url(')
    || normalized.includes('@import');
}

function sanitizeSvgRoot(root) {
  const elements = [root, ...root.querySelectorAll('*')];
  if (elements.length > MAX_SVG_ELEMENTS) throw new Error(`SVG слишком сложный: более ${MAX_SVG_ELEMENTS} элементов.`);

  for (const element of [...elements].reverse()) {
    const name = element.localName?.toLowerCase();
    if (!ALLOWED_ELEMENTS.has(name)) {
      element.remove();
      continue;
    }
    for (const attribute of [...element.attributes]) {
      const attributeName = attribute.name.toLowerCase();
      const localName = attribute.localName.toLowerCase();
      if (attributeName.startsWith('on') || localName.startsWith('on') || !ALLOWED_ATTRIBUTES.has(attributeName)) {
        element.removeAttributeNode(attribute);
        continue;
      }
      if (unsafeAttributeValue(attribute.value)) {
        element.removeAttributeNode(attribute);
        continue;
      }
      if ((attributeName === 'href' || attributeName === 'xlink:href') && !attribute.value.trim().startsWith('#')) {
        element.removeAttributeNode(attribute);
      }
    }
  }

  return root;
}

function finiteDimension(value, fallback) {
  const parsed = Number.parseFloat(value);
  const dimension = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  if (!Number.isFinite(dimension) || dimension <= 0 || dimension > MAX_SVG_DIMENSION) {
    throw new Error(`Некорректный размер SVG: ${value}.`);
  }
  return dimension;
}

export async function svgTextToPaths(svgText, options = {}) {
  if (typeof DOMParser === 'undefined' || typeof document === 'undefined') throw new Error('Импорт SVG доступен только в браузере.');
  const text = String(svgText);
  if (new TextEncoder().encode(text).byteLength > MAX_SVG_BYTES) throw new Error(`SVG превышает допустимый размер ${Math.round(MAX_SVG_BYTES / 1_000_000)} МБ.`);

  const parser = new DOMParser();
  const source = parser.parseFromString(text, 'image/svg+xml');
  const parseError = source.querySelector('parsererror');
  if (parseError) throw new Error(`SVG не разобран: ${parseError.textContent.trim()}`);
  const sourceRoot = source.documentElement;
  if (sourceRoot.localName !== 'svg') throw new Error('Файл не содержит корневой элемент SVG.');

  sanitizeSvgRoot(sourceRoot);
  const root = document.importNode(sourceRoot, true);
  const viewBoxText = root.getAttribute('viewBox') || root.getAttribute('viewbox') || '';
  const viewBoxValues = viewBoxText.trim().split(/[\s,]+/).map(Number);
  const validViewBox = viewBoxValues.length === 4 && viewBoxValues.every(Number.isFinite) && viewBoxValues[2] > 0 && viewBoxValues[3] > 0;
  const minX = validViewBox ? viewBoxValues[0] : 0;
  const minY = validViewBox ? viewBoxValues[1] : 0;
  const width = finiteDimension(validViewBox ? viewBoxValues[2] : root.getAttribute('width'), 1000);
  const height = finiteDimension(validViewBox ? viewBoxValues[3] : root.getAttribute('height'), 1000);

  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  root.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);
  root.style.position = 'fixed';
  root.style.left = '-100000px';
  root.style.top = '-100000px';
  root.style.width = `${width}px`;
  root.style.height = `${height}px`;
  root.style.pointerEvents = 'none';
  root.style.opacity = '0';
  document.body.appendChild(root);
  await new Promise((resolve) => requestAnimationFrame(resolve));

  try {
    const diagonal = Math.hypot(width, height);
    const sampling = Math.max(0.05, Number(options.sampleStep ?? diagonal / 1400));
    const maximumPoints = Math.max(500, Number(options.maximumPoints ?? 40000));
    const jumpThreshold = Math.max(sampling * 8, diagonal * 0.02);
    const paths = [];
    let consumedPoints = 0;
    const geometries = root.querySelectorAll('path,line,polyline,polygon,rect,circle,ellipse,use');
    for (const element of geometries) {
      if (!elementIsVisible(element) || typeof element.getTotalLength !== 'function' || typeof element.getPointAtLength !== 'function') continue;
      let length;
      try { length = element.getTotalLength(); } catch { continue; }
      if (!Number.isFinite(length) || length <= 0) continue;
      const segments = Math.max(1, Math.ceil(length / sampling));
      const matrix = element.getCTM();
      let path = [];
      for (let index = 0; index <= segments; index += 1) {
        if (consumedPoints >= maximumPoints) throw new Error(`SVG слишком сложный: более ${maximumPoints} точек.`);
        const point = matrixPoint(matrix, element.getPointAtLength((length * index) / segments));
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('SVG сформировал некорректную координату.');
        const previous = path[path.length - 1];
        if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) > jumpThreshold) {
          if (path.length >= 2) paths.push(path);
          path = [];
        }
        path.push(point);
        consumedPoints += 1;
      }
      if (path.length >= 2) paths.push(path);
    }
    const tolerance = Math.max(0, Number(options.simplifyTolerance ?? sampling * 0.25));
    return {
      paths: tolerance ? simplifyPaths(paths, tolerance) : cleanPaths(paths),
      source: { width, height, minX, minY },
      pointCount: consumedPoints,
    };
  } finally {
    root.remove();
  }
}
