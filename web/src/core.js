export const PAGE_PRESETS = Object.freeze({
  A4_PORTRAIT: Object.freeze({ id: 'A4_PORTRAIT', name: 'A4 · книжная', width: 210, height: 297 }),
  A4_LANDSCAPE: Object.freeze({ id: 'A4_LANDSCAPE', name: 'A4 · альбомная', width: 297, height: 210, requiresRotation: true }),
});

const EPSILON = 1e-9;

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePoint(point) {
  if (Array.isArray(point)) return { x: finiteNumber(point[0]), y: finiteNumber(point[1]) };
  return { x: finiteNumber(point?.x), y: finiteNumber(point?.y) };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hashText(text) {
  let hash = 2166136261;
  for (const symbol of String(text)) {
    hash ^= symbol.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function cleanPaths(paths, minimumDistance = 1e-7) {
  if (!Array.isArray(paths)) return [];
  const result = [];
  for (const source of paths) {
    if (!Array.isArray(source)) continue;
    const path = [];
    for (const raw of source) {
      const point = normalizePoint(raw);
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      const previous = path[path.length - 1];
      if (!previous || distance(previous, point) > minimumDistance) path.push(point);
    }
    if (path.length >= 2) result.push(path);
  }
  return result;
}

export function boundsOfPaths(paths) {
  const clean = cleanPaths(paths);
  if (!clean.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const path of clean) {
    for (const point of path) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function pointLineDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) return distance(point, start);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return distance(point, { x: start.x + t * dx, y: start.y + t * dy });
}

export function simplifyPath(path, tolerance = 0.05) {
  const points = cleanPaths([path])[0] ?? [];
  if (points.length <= 2 || tolerance <= 0) return points;
  const first = points[0];
  const last = points[points.length - 1];
  let maxDistance = 0;
  let index = -1;
  for (let i = 1; i < points.length - 1; i += 1) {
    const candidate = pointLineDistance(points[i], first, last);
    if (candidate > maxDistance) {
      maxDistance = candidate;
      index = i;
    }
  }
  if (maxDistance <= tolerance || index < 0) return [first, last];
  const left = simplifyPath(points.slice(0, index + 1), tolerance);
  const right = simplifyPath(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

export function simplifyPaths(paths, tolerance = 0.05) {
  return cleanPaths(paths.map((path) => simplifyPath(path, tolerance)));
}

export function validateFont(source) {
  if (!source || typeof source !== 'object') throw new TypeError('Шрифт должен быть объектом JSON.');
  if (source.format !== 'hand-draw-font-v1') throw new TypeError('Неизвестный формат шрифта.');
  const unitsPerEm = Math.max(0.001, finiteNumber(source.unitsPerEm, 1));
  const glyphs = {};
  for (const [symbol, rawVariants] of Object.entries(source.glyphs ?? {})) {
    const variants = Array.isArray(rawVariants) ? rawVariants : [rawVariants];
    const normalized = [];
    for (const rawVariant of variants) {
      if (!rawVariant || typeof rawVariant !== 'object') continue;
      const strokes = cleanPaths(rawVariant.strokes ?? []);
      if (!strokes.length) continue;
      normalized.push({
        advance: Math.max(0.05, finiteNumber(rawVariant.advance ?? rawVariant.width, 0.72)),
        strokes,
      });
    }
    if (normalized.length) glyphs[symbol] = normalized;
  }
  if (!Object.keys(glyphs).length) throw new TypeError('Шрифт не содержит штрихов.');
  return {
    format: 'hand-draw-font-v1',
    unitsPerEm,
    meta: {
      name: String(source.meta?.name ?? 'Без названия'),
      author: String(source.meta?.author ?? 'Не указан'),
      license: String(source.meta?.license ?? 'Не указана'),
      version: String(source.meta?.version ?? '1.0'),
      description: String(source.meta?.description ?? ''),
    },
    glyphs,
  };
}

function resolveGlyph(font, symbol, lowercaseScale) {
  if (font.glyphs[symbol]) return { variants: font.glyphs[symbol], scale: 1, sourceSymbol: symbol };
  const upper = symbol.toLocaleUpperCase('ru-RU');
  if (upper !== symbol && font.glyphs[upper]) {
    return { variants: font.glyphs[upper], scale: lowercaseScale, sourceSymbol: upper };
  }
  if (font.glyphs['?']) return { variants: font.glyphs['?'], scale: 1, sourceSymbol: '?' };
  return null;
}

function transformStroke(stroke, options) {
  const { originX, originY, size, scale, widthScale, slant, jitterX, jitterY, heightScale } = options;
  return stroke.map((point) => {
    const localY = point.y * size * scale * heightScale;
    const localX = point.x * size * scale * widthScale + Math.tan((slant * Math.PI) / 180) * localY;
    return { x: originX + localX + jitterX, y: originY + localY + jitterY };
  });
}

export function layoutText(text, fontSource, options = {}) {
  const font = fontSource?.format === 'hand-draw-font-v1' && fontSource?.glyphs ? validateFont(fontSource) : validateFont(fontSource);
  const fontSize = Math.max(0.2, finiteNumber(options.fontSize, 8));
  const letterSpacing = finiteNumber(options.letterSpacing, 0.5);
  const wordSpacing = Math.max(0, finiteNumber(options.wordSpacing, fontSize * 0.45));
  const lineHeight = Math.max(0.5, finiteNumber(options.lineHeight, 1.35));
  const originX = finiteNumber(options.originX, 10);
  const originY = finiteNumber(options.originY, 10);
  const maxWidth = Math.max(fontSize, finiteNumber(options.maxWidth, Infinity));
  const lowercaseScale = Math.max(0.35, Math.min(1, finiteNumber(options.lowercaseScale, 0.7)));
  const widthScale = Math.max(0.25, finiteNumber(options.widthScale, 1));
  const slant = Math.max(-35, Math.min(35, finiteNumber(options.slant, 0)));
  const jitter = Math.max(0, finiteNumber(options.jitter, 0));
  const heightJitter = Math.max(0, finiteNumber(options.heightJitter, 0));
  const random = mulberry32((finiteNumber(options.seed, 1) ^ hashText(text)) >>> 0);
  const paths = [];
  const unsupported = new Set();
  const lines = [];
  let line = [];
  let lineWidth = 0;

  const pushLine = () => {
    lines.push({ items: line, width: Math.max(0, lineWidth - letterSpacing) });
    line = [];
    lineWidth = 0;
  };

  for (const symbol of String(text).replace(/\r\n?/g, '\n')) {
    if (symbol === '\n') {
      pushLine();
      continue;
    }
    if (symbol === ' ' || symbol === '\t') {
      const advance = symbol === '\t' ? wordSpacing * 2 : wordSpacing;
      if (line.length && lineWidth + advance > maxWidth) pushLine();
      line.push({ kind: 'space', advance });
      lineWidth += advance;
      continue;
    }
    const resolved = resolveGlyph(font, symbol, lowercaseScale);
    if (!resolved) {
      unsupported.add(symbol);
      continue;
    }
    const variantIndex = Math.floor(random() * resolved.variants.length) % resolved.variants.length;
    const variant = resolved.variants[variantIndex];
    const advance = variant.advance * fontSize * resolved.scale * widthScale + letterSpacing;
    if (line.length && lineWidth + advance > maxWidth) pushLine();
    line.push({ kind: 'glyph', symbol, resolved, variant, advance });
    lineWidth += advance;
  }
  pushLine();

  const align = String(options.align ?? 'left');
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const row = lines[lineIndex];
    const offset = align === 'center' ? Math.max(0, (maxWidth - row.width) / 2) : align === 'right' ? Math.max(0, maxWidth - row.width) : 0;
    let cursorX = originX + offset;
    const baselineY = originY + lineIndex * fontSize * lineHeight;
    for (const item of row.items) {
      if (item.kind === 'space') {
        cursorX += item.advance;
        continue;
      }
      const jitterX = (random() - 0.5) * jitter;
      const jitterY = (random() - 0.5) * jitter;
      const heightScale = 1 + (random() - 0.5) * heightJitter;
      for (const stroke of item.variant.strokes) {
        paths.push(transformStroke(stroke, {
          originX: cursorX,
          originY: baselineY,
          size: fontSize / font.unitsPerEm,
          scale: item.resolved.scale,
          widthScale,
          slant,
          jitterX,
          jitterY,
          heightScale,
        }));
      }
      cursorX += item.advance;
    }
  }

  return { paths: cleanPaths(paths), unsupported: [...unsupported], lines: lines.length, font };
}

export function transformPaths(paths, transform = {}) {
  const scaleX = finiteNumber(transform.scaleX ?? transform.scale, 1);
  const scaleY = finiteNumber(transform.scaleY ?? transform.scale, 1);
  const translateX = finiteNumber(transform.translateX, 0);
  const translateY = finiteNumber(transform.translateY, 0);
  return cleanPaths(paths).map((path) => path.map((point) => ({
    x: point.x * scaleX + translateX,
    y: point.y * scaleY + translateY,
  })));
}

export function fitPathsToPage(paths, page = PAGE_PRESETS.A4_PORTRAIT, options = {}) {
  const clean = cleanPaths(paths);
  if (!clean.length) return [];
  const marginLeft = Math.max(0, finiteNumber(options.marginLeft, options.margin ?? 10));
  const marginRight = Math.max(0, finiteNumber(options.marginRight, options.margin ?? 10));
  const marginTop = Math.max(0, finiteNumber(options.marginTop, options.margin ?? 10));
  const marginBottom = Math.max(0, finiteNumber(options.marginBottom, options.margin ?? 10));
  const availableWidth = Math.max(EPSILON, page.width - marginLeft - marginRight);
  const availableHeight = Math.max(EPSILON, page.height - marginTop - marginBottom);
  const bounds = boundsOfPaths(clean);
  const sourceWidth = Math.max(EPSILON, bounds.width);
  const sourceHeight = Math.max(EPSILON, bounds.height);
  const preserveScale = options.allowUpscale === false ? Math.min(1, availableWidth / sourceWidth, availableHeight / sourceHeight) : Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight);
  const scaleX = options.preserveAspect === false ? availableWidth / sourceWidth : preserveScale;
  const scaleY = options.preserveAspect === false ? availableHeight / sourceHeight : preserveScale;
  const fittedWidth = bounds.width * scaleX;
  const fittedHeight = bounds.height * scaleY;
  const center = options.center !== false;
  const targetX = marginLeft + (center ? (availableWidth - fittedWidth) / 2 : 0);
  const targetY = marginTop + (center ? (availableHeight - fittedHeight) / 2 : 0);
  return clean.map((path) => path.map((point) => ({
    x: targetX + (point.x - bounds.minX) * scaleX,
    y: targetY + (point.y - bounds.minY) * scaleY,
  })));
}

export function validatePathsWithinPage(paths, page = PAGE_PRESETS.A4_PORTRAIT, options = {}) {
  const clean = cleanPaths(paths);
  const epsilon = Math.max(0, finiteNumber(options.epsilon, 0.01));
  const issues = [];
  if (!clean.length) issues.push('Нет траекторий для вывода.');
  for (let pathIndex = 0; pathIndex < clean.length; pathIndex += 1) {
    for (const point of clean[pathIndex]) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        issues.push(`Штрих ${pathIndex + 1} содержит некорректную координату.`);
        break;
      }
      if (point.x < -epsilon || point.y < -epsilon || point.x > page.width + epsilon || point.y > page.height + epsilon) {
        issues.push(`Штрих ${pathIndex + 1} выходит за лист: X=${point.x.toFixed(2)}, Y=${point.y.toFixed(2)}.`);
        break;
      }
    }
  }
  return { valid: issues.length === 0, issues, bounds: boundsOfPaths(clean), pathCount: clean.length };
}

export function calculateTravelLength(paths, start = { x: 0, y: 0 }) {
  const clean = cleanPaths(paths);
  let current = normalizePoint(start);
  let total = 0;
  for (const path of clean) {
    total += distance(current, path[0]);
    current = path[path.length - 1];
  }
  return total;
}

export function calculateDrawLength(paths) {
  let total = 0;
  for (const path of cleanPaths(paths)) {
    for (let index = 1; index < path.length; index += 1) total += distance(path[index - 1], path[index]);
  }
  return total;
}

export function optimizePathOrder(paths, start = { x: 0, y: 0 }, allowReverse = true) {
  const remaining = cleanPaths(paths).map((path) => path.map((point) => ({ ...point })));
  const before = calculateTravelLength(remaining, start);
  const optimized = [];
  let current = normalizePoint(start);
  while (remaining.length) {
    let bestIndex = 0;
    let bestReverse = false;
    let bestDistance = Infinity;
    for (let index = 0; index < remaining.length; index += 1) {
      const path = remaining[index];
      const forwardDistance = distance(current, path[0]);
      if (forwardDistance < bestDistance) {
        bestDistance = forwardDistance;
        bestIndex = index;
        bestReverse = false;
      }
      if (allowReverse) {
        const reverseDistance = distance(current, path[path.length - 1]);
        if (reverseDistance < bestDistance) {
          bestDistance = reverseDistance;
          bestIndex = index;
          bestReverse = true;
        }
      }
    }
    let [selected] = remaining.splice(bestIndex, 1);
    if (bestReverse) selected = selected.reverse();
    optimized.push(selected);
    current = selected[selected.length - 1];
  }
  return { paths: optimized, travelBefore: before, travelAfter: calculateTravelLength(optimized, start) };
}

function pixelDarkness(imageData, x, y) {
  const index = (y * imageData.width + x) * 4;
  const data = imageData.data;
  const alpha = (data[index + 3] ?? 255) / 255;
  const luminance = (0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]) / 255;
  return (1 - luminance) * alpha;
}

export function rasterToHatchPaths(imageData, options = {}) {
  if (!imageData?.data || !imageData.width || !imageData.height) return [];
  const widthMm = Math.max(0.1, finiteNumber(options.widthMm, 100));
  const heightMm = Math.max(0.1, finiteNumber(options.heightMm, widthMm * imageData.height / imageData.width));
  const threshold = Math.max(0, Math.min(1, finiteNumber(options.threshold, 0.5)));
  const rowSpacingMm = Math.max(0.1, finiteNumber(options.rowSpacingMm, 1));
  const invert = Boolean(options.invert);
  const rowStep = Math.max(1, Math.round((rowSpacingMm / heightMm) * imageData.height));
  const paths = [];
  for (let y = 0; y < imageData.height; y += rowStep) {
    let segment = [];
    const direction = Math.floor(y / rowStep) % 2 === 0 ? 1 : -1;
    for (let offset = 0; offset < imageData.width; offset += 1) {
      const x = direction > 0 ? offset : imageData.width - 1 - offset;
      const darkness = invert ? 1 - pixelDarkness(imageData, x, y) : pixelDarkness(imageData, x, y);
      const active = darkness >= threshold;
      if (active) {
        segment.push({ x: (x / Math.max(1, imageData.width - 1)) * widthMm, y: (y / Math.max(1, imageData.height - 1)) * heightMm });
      } else if (segment.length) {
        if (segment.length >= 2) paths.push([segment[0], segment[segment.length - 1]]);
        segment = [];
      }
    }
    if (segment.length >= 2) paths.push([segment[0], segment[segment.length - 1]]);
  }
  return cleanPaths(paths);
}

function segmentKey(point, precision = 4) {
  return `${point.x.toFixed(precision)},${point.y.toFixed(precision)}`;
}

function joinSegments(segments) {
  const unused = segments.map((segment) => segment.map((point) => ({ ...point })));
  const result = [];
  while (unused.length) {
    const path = unused.pop();
    let changed = true;
    while (changed) {
      changed = false;
      const startKey = segmentKey(path[0]);
      const endKey = segmentKey(path[path.length - 1]);
      for (let index = 0; index < unused.length; index += 1) {
        const candidate = unused[index];
        const a = segmentKey(candidate[0]);
        const b = segmentKey(candidate[candidate.length - 1]);
        if (a === endKey) path.push(...candidate.slice(1));
        else if (b === endKey) path.push(...candidate.slice(0, -1).reverse());
        else if (b === startKey) path.unshift(...candidate.slice(0, -1));
        else if (a === startKey) path.unshift(...candidate.slice(1).reverse());
        else continue;
        unused.splice(index, 1);
        changed = true;
        break;
      }
    }
    if (path.length >= 2) result.push(path);
  }
  return result;
}

export function rasterToContourPaths(imageData, options = {}) {
  if (!imageData?.data || !imageData.width || !imageData.height) return [];
  const widthMm = Math.max(0.1, finiteNumber(options.widthMm, 100));
  const heightMm = Math.max(0.1, finiteNumber(options.heightMm, widthMm * imageData.height / imageData.width));
  const threshold = Math.max(0, Math.min(1, finiteNumber(options.threshold, 0.5)));
  const sampleStepPx = Math.max(1, Math.round(finiteNumber(options.sampleStepPx, 1)));
  const invert = Boolean(options.invert);
  const active = (x, y) => {
    if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) return false;
    const darkness = pixelDarkness(imageData, x, y);
    return (invert ? 1 - darkness : darkness) >= threshold;
  };
  const point = (x, y) => ({
    x: (x / imageData.width) * widthMm,
    y: (y / imageData.height) * heightMm,
  });
  const segments = [];
  for (let y = 0; y < imageData.height; y += sampleStepPx) {
    for (let x = 0; x < imageData.width; x += sampleStepPx) {
      if (!active(x, y)) continue;
      const x2 = Math.min(imageData.width, x + sampleStepPx);
      const y2 = Math.min(imageData.height, y + sampleStepPx);
      if (!active(x, y - sampleStepPx)) segments.push([point(x, y), point(x2, y)]);
      if (!active(x + sampleStepPx, y)) segments.push([point(x2, y), point(x2, y2)]);
      if (!active(x, y + sampleStepPx)) segments.push([point(x2, y2), point(x, y2)]);
      if (!active(x - sampleStepPx, y)) segments.push([point(x, y2), point(x, y)]);
    }
  }
  const joined = joinSegments(segments);
  const tolerance = Math.max(0, finiteNumber(options.simplifyTolerance, Math.min(widthMm / imageData.width, heightMm / imageData.height) * 0.35));
  return simplifyPaths(joined, tolerance);
}

function formatNumber(value, digits = 3) {
  const normalized = Math.abs(value) < 0.0005 ? 0 : value;
  const text = normalized.toFixed(digits);
  return digits > 0 ? text.replace(/\.?0+$/, '') : text;
}

function utf8Length(text) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
  if (typeof Buffer !== 'undefined') return Buffer.byteLength(text, 'utf8');
  return unescape(encodeURIComponent(text)).length;
}

export function estimateJob(paths, options = {}) {
  const drawFeed = Math.max(1, finiteNumber(options.drawFeed, 1200));
  const travelFeed = Math.max(1, finiteNumber(options.travelFeed, 4000));
  const penDwell = Math.max(0, finiteNumber(options.penDwell, 0.12));
  const drawLength = calculateDrawLength(paths);
  const travelLength = calculateTravelLength(paths, { x: 0, y: 0 });
  const pathCount = cleanPaths(paths).length;
  const seconds = drawLength / drawFeed * 60 + travelLength / travelFeed * 60 + pathCount * penDwell * 2;
  return { drawLength, travelLength, seconds, pathCount, pointCount: cleanPaths(paths).reduce((sum, path) => sum + path.length, 0) };
}

export function generateGcode(paths, page = PAGE_PRESETS.A4_PORTRAIT, options = {}) {
  const clean = cleanPaths(paths);
  const validation = validatePathsWithinPage(clean, page);
  const drawFeed = Math.max(1, finiteNumber(options.drawFeed, 1200));
  const travelFeed = Math.max(1, finiteNumber(options.travelFeed, 4000));
  const penUp = finiteNumber(options.penUp, 5);
  const penDown = finiteNumber(options.penDown, 0);
  const penDwell = Math.max(0, finiteNumber(options.penDwell, 0.12));
  const invertY = options.invertY !== false;
  const returnHome = options.returnHome !== false;
  const lines = ['; HandDraw ESP', 'G21', 'G90', `G0 Z${formatNumber(penUp)}`];
  const ranges = [];
  const machinePoint = (point) => ({ x: point.x, y: invertY ? page.height - point.y : point.y });

  for (const path of clean) {
    const startByte = utf8Length(`${lines.join('\n')}\n`);
    const first = machinePoint(path[0]);
    lines.push(`G0 Z${formatNumber(penUp)}`);
    lines.push(`G0 X${formatNumber(first.x)} Y${formatNumber(first.y)} F${formatNumber(travelFeed, 0)}`);
    lines.push(`G0 Z${formatNumber(penDown)}`);
    if (penDwell > 0) lines.push(`G4 P${formatNumber(penDwell)}`);
    for (let index = 1; index < path.length; index += 1) {
      const point = machinePoint(path[index]);
      lines.push(`G1 X${formatNumber(point.x)} Y${formatNumber(point.y)} F${formatNumber(drawFeed, 0)}`);
    }
    lines.push(`G0 Z${formatNumber(penUp)}`);
    if (penDwell > 0) lines.push(`G4 P${formatNumber(penDwell)}`);
    const endByte = utf8Length(`${lines.join('\n')}\n`);
    ranges.push({ startByte, endByte });
  }
  if (returnHome) lines.push(`G0 X0 Y0 F${formatNumber(travelFeed, 0)}`);
  lines.push('M2');
  const gcode = `${lines.join('\n')}\n`;
  const totalBytes = Math.max(1, utf8Length(gcode));
  const pathByteRanges = ranges.map((range) => ({
    ...range,
    startFraction: range.startByte / totalBytes,
    endFraction: range.endByte / totalBytes,
  }));
  return { gcode, pathByteRanges, validation, estimate: estimateJob(clean, { drawFeed, travelFeed, penDwell }) };
}
