import { cleanPaths, simplifyPaths } from './core.js';

function matrixPoint(matrix, point) {
  if (!matrix) return { x: point.x, y: point.y };
  return { x: matrix.a * point.x + matrix.c * point.y + matrix.e, y: matrix.b * point.x + matrix.d * point.y + matrix.f };
}

function elementIsVisible(element) {
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
}

export async function svgTextToPaths(svgText, options = {}) {
  if (typeof DOMParser === 'undefined' || typeof document === 'undefined') throw new Error('Импорт SVG доступен только в браузере.');
  const parser = new DOMParser();
  const source = parser.parseFromString(String(svgText), 'image/svg+xml');
  const parseError = source.querySelector('parsererror');
  if (parseError) throw new Error(`SVG не разобран: ${parseError.textContent.trim()}`);
  const root = source.documentElement;
  if (root.localName !== 'svg') throw new Error('Файл не содержит корневой элемент SVG.');

  const viewBox = root.viewBox?.baseVal;
  const width = viewBox?.width || Number.parseFloat(root.getAttribute('width')) || 1000;
  const height = viewBox?.height || Number.parseFloat(root.getAttribute('height')) || 1000;
  const minX = viewBox?.x || 0;
  const minY = viewBox?.y || 0;
  root.setAttribute('width', String(width)); root.setAttribute('height', String(height)); root.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);
  root.style.position = 'fixed'; root.style.left = '-100000px'; root.style.top = '-100000px'; root.style.width = `${width}px`; root.style.height = `${height}px`; root.style.pointerEvents = 'none'; root.style.opacity = '0';
  document.body.appendChild(document.adoptNode(root));
  await new Promise((resolve) => requestAnimationFrame(resolve));

  try {
    const diagonal = Math.hypot(width, height);
    const sampling = Math.max(0.05, Number(options.sampleStep ?? diagonal / 1400));
    const maximumPoints = Math.max(500, Number(options.maximumPoints ?? 40000));
    const jumpThreshold = Math.max(sampling * 8, diagonal * 0.02);
    const paths = []; let consumedPoints = 0;
    const geometries = root.querySelectorAll('path,line,polyline,polygon,rect,circle,ellipse,use');
    for (const element of geometries) {
      if (!elementIsVisible(element) || typeof element.getTotalLength !== 'function' || typeof element.getPointAtLength !== 'function') continue;
      let length; try { length = element.getTotalLength(); } catch { continue; }
      if (!Number.isFinite(length) || length <= 0) continue;
      const segments = Math.max(1, Math.ceil(length / sampling)); const matrix = element.getCTM(); let path = [];
      for (let i = 0; i <= segments; i += 1) {
        if (consumedPoints >= maximumPoints) throw new Error(`SVG слишком сложный: более ${maximumPoints} точек.`);
        const point = matrixPoint(matrix, element.getPointAtLength((length * i) / segments)); const previous = path[path.length - 1];
        if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) > jumpThreshold) { if (path.length >= 2) paths.push(path); path = []; }
        path.push(point); consumedPoints += 1;
      }
      if (path.length >= 2) paths.push(path);
    }
    const tolerance = Math.max(0, Number(options.simplifyTolerance ?? sampling * 0.25));
    return { paths: tolerance ? simplifyPaths(paths, tolerance) : cleanPaths(paths), source: { width, height, minX, minY }, pointCount: consumedPoints };
  } finally { root.remove(); }
}
