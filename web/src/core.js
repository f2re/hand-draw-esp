export const PAGE_PRESETS = Object.freeze({
  A4_PORTRAIT: Object.freeze({ id: 'A4_PORTRAIT', name: 'A4 · книжная', width: 210, height: 297 }),
  A4_LANDSCAPE: Object.freeze({ id: 'A4_LANDSCAPE', name: 'A4 · альбомная', width: 297, height: 210, requiresRotation: true }),
});

export const MACHINE_DEFAULTS = Object.freeze({
  workWidth: 225,
  workHeight: 315,
  paperOffsetX: 7.5,
  paperOffsetY: 9,
  servoMinZ: 0,
  servoMaxZ: 5,
  machineFeedLimit: 4200,
});

function freezeProfile(source) {
  return Object.freeze({
    ...source,
    textDefaults: Object.freeze({ ...(source.textDefaults ?? {}) }),
    rasterDefaults: Object.freeze({ ...(source.rasterDefaults ?? {}) }),
  });
}

export const TOOL_PROFILES = Object.freeze({
  fineliner: freezeProfile({
    id: 'fineliner',
    name: 'Линер',
    shortName: 'Линер',
    symbol: '╱',
    description: 'Ровная тонкая линия для текста, схем и аккуратной графики.',
    drawFeed: 1200,
    travelFeed: 3600,
    jogFeed: 600,
    penUp: 5,
    penDown: 0,
    penDownDwell: 0.10,
    penUpDwell: 0.08,
    strokeRepeats: 1,
    allowReverse: true,
    maxContinuousStroke: 260,
    previewWidth: 0.42,
    textDefaults: { preset: 'neat' },
    rasterDefaults: { mode: 'hatch', threshold: 0.50, hatchSpacing: 1.35, hatchAngle: 0, contourStep: 2 },
    note: 'Начальный универсальный профиль. Нажим задаётся пружиной держателя, а не программой.',
  }),
  gel: freezeProfile({
    id: 'gel',
    name: 'Гелевая ручка',
    shortName: 'Гелевая',
    symbol: '●',
    description: 'Насыщенная линия; движения медленнее, подъём пера с небольшой выдержкой.',
    drawFeed: 850,
    travelFeed: 2800,
    jogFeed: 500,
    penUp: 5,
    penDown: 0,
    penDownDwell: 0.16,
    penUpDwell: 0.12,
    strokeRepeats: 1,
    allowReverse: true,
    maxContinuousStroke: 220,
    previewWidth: 0.58,
    textDefaults: { preset: 'handwriting' },
    rasterDefaults: { mode: 'hatch', threshold: 0.54, hatchSpacing: 1.65, hatchAngle: 0, contourStep: 2 },
    note: 'Используйте гладкую бумагу и не завышайте нажим: гелевая паста размазывается при плотной штриховке.',
  }),
  ballpoint: freezeProfile({
    id: 'ballpoint',
    name: 'Шариковая ручка',
    shortName: 'Шариковая',
    symbol: '•',
    description: 'Повседневная ручка, устойчивый универсальный режим с умеренным нажимом.',
    drawFeed: 1050,
    travelFeed: 3400,
    jogFeed: 600,
    penUp: 5,
    penDown: 0,
    penDownDwell: 0.08,
    penUpDwell: 0.06,
    strokeRepeats: 1,
    allowReverse: true,
    maxContinuousStroke: 280,
    previewWidth: 0.48,
    textDefaults: { preset: 'handwriting' },
    rasterDefaults: { mode: 'crosshatch', threshold: 0.48, hatchSpacing: 1.55, hatchAngle: 35, contourStep: 2 },
    note: 'При пропусках сначала проверьте пружину и положение стержня, а не уменьшайте скорость до предела.',
  }),
  pencil: freezeProfile({
    id: 'pencil',
    name: 'Карандаш',
    shortName: 'Карандаш',
    symbol: '✎',
    description: 'Мягкий ход, перекрёстная штриховка и возможность повторного прохода.',
    drawFeed: 760,
    travelFeed: 2700,
    jogFeed: 450,
    penUp: 5,
    penDown: 0,
    penDownDwell: 0.05,
    penUpDwell: 0.05,
    strokeRepeats: 1,
    allowReverse: true,
    maxContinuousStroke: 300,
    previewWidth: 0.50,
    textDefaults: { preset: 'sketch' },
    rasterDefaults: { mode: 'crosshatch', threshold: 0.42, hatchSpacing: 1.25, hatchAngle: 35, contourStep: 2 },
    note: 'Для более тёмной линии используйте 2 прохода только после проверки повторяемости; чрезмерный нажим ломает грифель.',
  }),
  ink: freezeProfile({
    id: 'ink',
    name: 'Перо с тушью',
    shortName: 'Перо',
    symbol: '✒',
    description: 'Медленное направленное письмо с выдержкой и ограничением длинных штрихов.',
    drawFeed: 520,
    travelFeed: 2100,
    jogFeed: 350,
    penUp: 5,
    penDown: 0,
    penDownDwell: 0.24,
    penUpDwell: 0.18,
    strokeRepeats: 1,
    allowReverse: false,
    maxContinuousStroke: 120,
    previewWidth: 0.62,
    textDefaults: { preset: 'calligraphic' },
    rasterDefaults: { mode: 'contour', threshold: 0.56, hatchSpacing: 2.25, hatchAngle: -18, contourStep: 2 },
    note: 'Автоматического макания нет. Проверьте направление пера, запас туши и длинные непрерывные линии до запуска.',
  }),
  marker: freezeProfile({
    id: 'marker',
    name: 'Маркер / фломастер',
    shortName: 'Маркер',
    symbol: '▰',
    description: 'Широкий пишущий узел: редкая штриховка, невысокая скорость и малый нажим.',
    drawFeed: 650,
    travelFeed: 2300,
    jogFeed: 400,
    penUp: 5,
    penDown: 0,
    penDownDwell: 0.14,
    penUpDwell: 0.12,
    strokeRepeats: 1,
    allowReverse: true,
    maxContinuousStroke: 220,
    previewWidth: 0.90,
    textDefaults: { preset: 'comic' },
    rasterDefaults: { mode: 'comic', threshold: 0.52, hatchSpacing: 2.8, hatchAngle: 38, contourStep: 3 },
    note: 'Плотные заливки заменяются редкими штрихами: повторный проход маркером быстро пропитывает бумагу.',
  }),
});

export const TEXT_PRESETS = Object.freeze({
  handwriting: Object.freeze({
    id: 'handwriting', name: 'Живой почерк', description: 'Естественная строка с малой воспроизводимой вариативностью.',
    fontSize: 6.8, widthScale: 0.94, letterSpacing: 0.20, wordSpacing: 2.8, lineHeight: 1.46,
    lowercaseScale: 0.72, slant: 6, jitter: 0.18, heightJitter: 0.055, align: 'left',
  }),
  neat: Object.freeze({
    id: 'neat', name: 'Аккуратная запись', description: 'Спокойный рукописный текст для записок и подписей.',
    fontSize: 6.3, widthScale: 0.96, letterSpacing: 0.25, wordSpacing: 2.8, lineHeight: 1.42,
    lowercaseScale: 0.72, slant: 3, jitter: 0.08, heightJitter: 0.025, align: 'left',
  }),
  technical: Object.freeze({
    id: 'technical', name: 'Технический текст', description: 'Предсказуемые размеры без случайного смещения.',
    fontSize: 5.6, widthScale: 1, letterSpacing: 0.34, wordSpacing: 2.6, lineHeight: 1.36,
    lowercaseScale: 0.70, slant: 0, jitter: 0, heightJitter: 0, align: 'left',
  }),
  comic: Object.freeze({
    id: 'comic', name: 'Комикс', description: 'Крупнее, плотнее и выразительнее для реплик и заголовков.',
    fontSize: 7.4, widthScale: 1.06, letterSpacing: 0.46, wordSpacing: 3.2, lineHeight: 1.30,
    lowercaseScale: 0.88, slant: -2, jitter: 0.09, heightJitter: 0.035, align: 'left',
  }),
  sketch: Object.freeze({
    id: 'sketch', name: 'Карандашный эскиз', description: 'Небольшая неровность, пригодная для подписей к рисунку.',
    fontSize: 6.6, widthScale: 0.95, letterSpacing: 0.18, wordSpacing: 2.7, lineHeight: 1.44,
    lowercaseScale: 0.72, slant: 5, jitter: 0.22, heightJitter: 0.07, align: 'left',
  }),
  calligraphic: Object.freeze({
    id: 'calligraphic', name: 'Перо', description: 'Направленные штрихи без разворота траекторий.',
    fontSize: 7.1, widthScale: 0.98, letterSpacing: 0.34, wordSpacing: 3.0, lineHeight: 1.52,
    lowercaseScale: 0.74, slant: 8, jitter: 0.04, heightJitter: 0.015, align: 'left',
  }),
});

export const RASTER_PRESETS = Object.freeze({
  hatch: Object.freeze({ id: 'hatch', name: 'Штриховка', description: 'Один слой параллельных линий для лёгких полутонов.' }),
  crosshatch: Object.freeze({ id: 'crosshatch', name: 'Перекрёстная', description: 'Два слоя только в более тёмных областях.' }),
  contour: Object.freeze({ id: 'contour', name: 'Контуры', description: 'Границы объектов без передачи полутонов.' }),
  comic: Object.freeze({ id: 'comic', name: 'Комикс', description: 'Выразительный контур и разреженные теневые штрихи.' }),
});

export function getToolProfile(profileId = 'fineliner') {
  const profile = TOOL_PROFILES[profileId] ?? TOOL_PROFILES.fineliner;
  return {
    ...profile,
    textDefaults: { ...profile.textDefaults },
    rasterDefaults: { ...profile.rasterDefaults },
  };
}

export function getTextPreset(presetId = 'neat') {
  return { ...(TEXT_PRESETS[presetId] ?? TEXT_PRESETS.neat) };
}


const EPSILON = 1e-9;

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function coordinateNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function normalizePoint(point) {
  if (Array.isArray(point)) return { x: coordinateNumber(point[0]), y: coordinateNumber(point[1]) };
  return { x: coordinateNumber(point?.x), y: coordinateNumber(point?.y) };
}

export function validatePathData(paths) {
  const issues = [];
  if (!Array.isArray(paths)) return { valid: false, issues: ['Траектория должна быть массивом штрихов.'] };
  for (let pathIndex = 0; pathIndex < paths.length; pathIndex += 1) {
    const source = paths[pathIndex];
    if (!Array.isArray(source)) {
      issues.push(`Штрих ${pathIndex + 1} не является массивом точек.`);
      continue;
    }
    for (let pointIndex = 0; pointIndex < source.length; pointIndex += 1) {
      const point = normalizePoint(source[pointIndex]);
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        issues.push(`Штрих ${pathIndex + 1}, точка ${pointIndex + 1}: координаты должны быть конечными числами.`);
        break;
      }
    }
  }
  return { valid: issues.length === 0, issues };
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
  const dataValidation = validatePathData(paths);
  const clean = cleanPaths(paths);
  const epsilon = Math.max(0, finiteNumber(options.epsilon, 0.01));
  const issues = [...dataValidation.issues];
  if (!clean.length) issues.push('Нет траекторий для вывода.');
  for (let pathIndex = 0; pathIndex < clean.length; pathIndex += 1) {
    for (const point of clean[pathIndex]) {
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
  const clampedX = Math.max(0, Math.min(imageData.width - 1, Math.round(x)));
  const clampedY = Math.max(0, Math.min(imageData.height - 1, Math.round(y)));
  const index = (clampedY * imageData.width + clampedX) * 4;
  const data = imageData.data;
  const alpha = (data[index + 3] ?? 255) / 255;
  const luminance = (0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]) / 255;
  return (1 - luminance) * alpha;
}

function clipLineToRectangle(origin, direction, width, height) {
  let minimum = -Infinity;
  let maximum = Infinity;
  const axes = [
    [origin.x, direction.x, 0, width],
    [origin.y, direction.y, 0, height],
  ];
  for (const [position, delta, low, high] of axes) {
    if (Math.abs(delta) < EPSILON) {
      if (position < low || position > high) return null;
      continue;
    }
    let first = (low - position) / delta;
    let second = (high - position) / delta;
    if (first > second) [first, second] = [second, first];
    minimum = Math.max(minimum, first);
    maximum = Math.min(maximum, second);
    if (minimum > maximum) return null;
  }
  return [
    { x: origin.x + direction.x * minimum, y: origin.y + direction.y * minimum },
    { x: origin.x + direction.x * maximum, y: origin.y + direction.y * maximum },
  ];
}

function hatchPass(imageData, options = {}) {
  const widthMm = Math.max(0.1, finiteNumber(options.widthMm, 100));
  const heightMm = Math.max(0.1, finiteNumber(options.heightMm, widthMm * imageData.height / imageData.width));
  const threshold = Math.max(0, Math.min(1, finiteNumber(options.threshold, 0.5)));
  const spacing = Math.max(0.1, finiteNumber(options.rowSpacingMm, 1));
  const invert = Boolean(options.invert);
  const angle = finiteNumber(options.angleDeg, 0) * Math.PI / 180;
  const direction = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -direction.y, y: direction.x };
  const corners = [
    { x: 0, y: 0 }, { x: widthMm, y: 0 }, { x: widthMm, y: heightMm }, { x: 0, y: heightMm },
  ];
  const projections = corners.map((point) => point.x * normal.x + point.y * normal.y);
  const minProjection = Math.min(...projections);
  const maxProjection = Math.max(...projections);
  const pixelMm = Math.max(0.025, Math.min(
    widthMm / Math.max(1, imageData.width - 1),
    heightMm / Math.max(1, imageData.height - 1),
  ));
  const sampleStepMm = Math.max(pixelMm * 0.75, finiteNumber(options.sampleStepMm, pixelMm * 0.75));
  const paths = [];
  let lineIndex = 0;

  for (let projection = minProjection; projection <= maxProjection + EPSILON; projection += spacing) {
    const origin = { x: normal.x * projection, y: normal.y * projection };
    const clipped = clipLineToRectangle(origin, direction, widthMm, heightMm);
    if (!clipped) continue;
    let [start, end] = clipped;
    if (lineIndex % 2 === 1) [start, end] = [end, start];
    lineIndex += 1;
    const length = distance(start, end);
    const sampleCount = Math.max(1, Math.ceil(length / sampleStepMm));
    let segmentStart = null;
    let lastActive = null;
    for (let index = 0; index <= sampleCount; index += 1) {
      const ratio = index / sampleCount;
      const point = {
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
      };
      const pixelX = point.x / widthMm * Math.max(1, imageData.width - 1);
      const pixelY = point.y / heightMm * Math.max(1, imageData.height - 1);
      const rawDarkness = pixelDarkness(imageData, pixelX, pixelY);
      const darkness = invert ? 1 - rawDarkness : rawDarkness;
      if (darkness >= threshold) {
        if (!segmentStart) segmentStart = point;
        lastActive = point;
      } else if (segmentStart && lastActive) {
        if (distance(segmentStart, lastActive) >= pixelMm) paths.push([segmentStart, lastActive]);
        segmentStart = null;
        lastActive = null;
      }
    }
    if (segmentStart && lastActive && distance(segmentStart, lastActive) >= pixelMm) paths.push([segmentStart, lastActive]);
  }
  return paths;
}

export function rasterToHatchPaths(imageData, options = {}) {
  if (!imageData?.data || !imageData.width || !imageData.height) return [];
  const primary = hatchPass(imageData, options);
  if (!options.crossHatch) return cleanPaths(primary);
  const threshold = Math.max(0, Math.min(1, finiteNumber(options.threshold, 0.5)));
  const crossThreshold = Math.max(threshold, Math.min(1, finiteNumber(options.crossThreshold, threshold + 0.17)));
  const angle = finiteNumber(options.angleDeg, 35);
  const secondary = hatchPass(imageData, {
    ...options,
    threshold: crossThreshold,
    angleDeg: finiteNumber(options.crossAngleDeg, -angle),
    rowSpacingMm: Math.max(0.1, finiteNumber(options.crossSpacingMm, finiteNumber(options.rowSpacingMm, 1) * 1.12)),
  });
  return cleanPaths([...primary, ...secondary]);
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

export function rasterToComicPaths(imageData, options = {}) {
  if (!imageData?.data || !imageData.width || !imageData.height) return [];
  const threshold = Math.max(0.05, Math.min(0.95, finiteNumber(options.threshold, 0.5)));
  const spacing = Math.max(0.2, finiteNumber(options.rowSpacingMm, 2.2));
  const angle = finiteNumber(options.angleDeg, 38);
  const outlines = rasterToContourPaths(imageData, {
    ...options,
    threshold: Math.max(0.12, threshold - 0.08),
    sampleStepPx: Math.max(1, finiteNumber(options.sampleStepPx, 2)),
  });
  const shade = rasterToHatchPaths(imageData, {
    ...options,
    threshold,
    rowSpacingMm: spacing,
    angleDeg: angle,
  });
  const deepShade = rasterToHatchPaths(imageData, {
    ...options,
    threshold: Math.min(0.92, threshold + 0.22),
    rowSpacingMm: spacing * 1.25,
    angleDeg: -angle,
  });
  return cleanPaths([...outlines, ...shade, ...deepShade]);
}

function pathLength(path) {
  let total = 0;
  for (let index = 1; index < path.length; index += 1) total += distance(path[index - 1], path[index]);
  return total;
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
  const travelFeed = Math.max(1, finiteNumber(options.travelFeed, 3600));
  const fallbackDwell = Math.max(0, finiteNumber(options.penDwell, 0.10));
  const penDownDwell = Math.max(0, finiteNumber(options.penDownDwell, fallbackDwell));
  const penUpDwell = Math.max(0, finiteNumber(options.penUpDwell, fallbackDwell));
  const strokeRepeats = Math.max(1, Math.min(3, Math.round(finiteNumber(options.strokeRepeats, 1))));
  const allowReverse = options.allowReverse !== false;
  const clean = cleanPaths(paths);
  const baseDrawLength = calculateDrawLength(clean);
  const drawLength = baseDrawLength * strokeRepeats;
  let travelLength = calculateTravelLength(clean, { x: 0, y: 0 });
  if (!allowReverse && strokeRepeats > 1) {
    travelLength += clean.reduce((sum, path) => sum + distance(path.at(-1), path[0]) * (strokeRepeats - 1), 0);
  }
  const pathCount = clean.length;
  const penLifts = pathCount * (allowReverse ? 1 : strokeRepeats);
  const seconds = drawLength / drawFeed * 60 + travelLength / travelFeed * 60 + penLifts * (penDownDwell + penUpDwell);
  return {
    drawLength,
    baseDrawLength,
    travelLength,
    seconds,
    pathCount,
    penLifts,
    pointCount: clean.reduce((sum, path) => sum + path.length, 0),
    strokeRepeats,
    allowReverse,
    drawFeed,
    travelFeed,
  };
}

export function analyzeJob(paths, options = {}) {
  const dataValidation = validatePathData(paths);
  const clean = cleanPaths(paths);
  const estimate = estimateJob(clean, options);
  const lengths = clean.map(pathLength);
  const longestStroke = lengths.length ? Math.max(...lengths) : 0;
  const shortStrokeCount = lengths.filter((value) => value < 0.45).length;
  const maxContinuousStroke = Math.max(1, finiteNumber(options.maxContinuousStroke, 260));
  const penUp = finiteNumber(options.penUp, 5);
  const penDown = finiteNumber(options.penDown, 0);
  const servoMinZ = finiteNumber(options.servoMinZ, MACHINE_DEFAULTS.servoMinZ);
  const servoMaxZ = finiteNumber(options.servoMaxZ, MACHINE_DEFAULTS.servoMaxZ);
  const warnings = [];
  const errors = dataValidation.issues.map((message) => ({ code: 'invalid-coordinate', message }));

  const machineFeedLimit = Math.max(100, finiteNumber(options.machineFeedLimit, MACHINE_DEFAULTS.machineFeedLimit));
  if (!clean.length) errors.push({ code: 'empty', message: 'Нет траекторий для выполнения.' });
  if (servoMaxZ <= servoMinZ) errors.push({ code: 'servo-range-config', message: 'Некорректно задан рабочий диапазон сервопривода.' });
  if (penUp <= penDown) errors.push({ code: 'pen-range', message: 'Положение «перо вверх» должно быть выше положения «перо вниз».' });
  if (penDown < servoMinZ || penDown > servoMaxZ || penUp < servoMinZ || penUp > servoMaxZ) errors.push({
    code: 'pen-range-limit',
    message: `Положения пера должны находиться в диапазоне Z ${servoMinZ.toFixed(1)}…${servoMaxZ.toFixed(1)} мм.`,
  });
  if (estimate.drawFeed > machineFeedLimit || estimate.travelFeed > machineFeedLimit) errors.push({ code: 'feed-limit', message: `Подача превышает консервативный предел станка ${machineFeedLimit} мм/мин.` });
  if (longestStroke > maxContinuousStroke) warnings.push({
    code: 'continuous-stroke',
    message: `Самый длинный непрерывный штрих ${longestStroke.toFixed(0)} мм; для выбранного инструмента рекомендуется не более ${maxContinuousStroke.toFixed(0)} мм.`,
  });
  if (estimate.pathCount > 3500) warnings.push({ code: 'many-lifts', message: `Задание содержит ${estimate.pathCount} подъёмов пера; выполнение и износ сервопривода заметно возрастут.` });
  if (estimate.pointCount > 60000) warnings.push({ code: 'many-points', message: `Траектория содержит ${estimate.pointCount} точек. Увеличьте упрощение или шаг анализа.` });
  if (estimate.seconds > 7200) warnings.push({ code: 'long-job', message: `Расчётное время превышает 2 часа. Разделите рисунок или разрядите штриховку.` });
  if (shortStrokeCount > Math.max(250, estimate.pathCount * 0.45)) warnings.push({ code: 'short-strokes', message: 'Много очень коротких штрихов: серво будет работать чаще, чем оси рисования.' });
  if (String(options.toolId) === 'ink' && estimate.pathCount > 1200) warnings.push({ code: 'ink-density', message: 'Для пера с тушью макет слишком дробный: предпочтительны контуры и длинные осмысленные штрихи.' });
  if (String(options.toolId) === 'marker' && estimate.strokeRepeats > 1) warnings.push({ code: 'marker-repeat', message: 'Повторный проход маркером может пропитать и деформировать бумагу.' });
  if (!estimate.allowReverse && estimate.strokeRepeats > 1) warnings.push({ code: 'directional-repeat', message: 'Для направленного пера каждый повтор выполняется вперёд: между проходами перо поднимается и возвращается к началу штриха.' });

  return { ...estimate, longestStroke, shortStrokeCount, warnings, errors, valid: errors.length === 0 };
}

function machineOptions(options = {}) {
  return {
    paperOffsetX: finiteNumber(options.paperOffsetX, MACHINE_DEFAULTS.paperOffsetX),
    paperOffsetY: finiteNumber(options.paperOffsetY, MACHINE_DEFAULTS.paperOffsetY),
    workWidth: Math.max(1, finiteNumber(options.workWidth, MACHINE_DEFAULTS.workWidth)),
    workHeight: Math.max(1, finiteNumber(options.workHeight, MACHINE_DEFAULTS.workHeight)),
    invertY: options.invertY !== false,
  };
}

function machinePointForPage(point, page, options = {}) {
  const machine = machineOptions(options);
  return {
    x: machine.paperOffsetX + point.x,
    y: machine.paperOffsetY + (machine.invertY ? page.height - point.y : point.y),
  };
}

function validateMachinePlacement(paths, page, options = {}) {
  const machine = machineOptions(options);
  const machinePaths = cleanPaths(paths).map((path) => path.map((point) => machinePointForPage(point, page, machine)));
  const bounds = boundsOfPaths(machinePaths);
  const issues = [];
  if (machine.paperOffsetX < 0 || machine.paperOffsetY < 0) issues.push('Смещение листа относительно машинного нуля не может быть отрицательным.');
  if (machine.paperOffsetX + page.width > machine.workWidth + 0.01 || machine.paperOffsetY + page.height > machine.workHeight + 0.01) {
    issues.push(`Лист ${page.width.toFixed(1)} × ${page.height.toFixed(1)} мм не помещается в рабочее поле при заданном смещении.`);
  }
  if (machinePaths.length && (bounds.minX < -0.01 || bounds.minY < -0.01 || bounds.maxX > machine.workWidth + 0.01 || bounds.maxY > machine.workHeight + 0.01)) {
    issues.push(`Макет выходит за рабочее поле ${machine.workWidth.toFixed(1)} × ${machine.workHeight.toFixed(1)} мм после учёта положения листа.`);
  }
  return { valid: issues.length === 0, issues, bounds, machinePaths, machine };
}

export function generateGcode(paths, page = PAGE_PRESETS.A4_PORTRAIT, options = {}) {
  const clean = cleanPaths(paths);
  const pageValidation = validatePathsWithinPage(paths, page);
  const placement = validateMachinePlacement(clean, page, options);
  const validation = {
    valid: pageValidation.valid && placement.valid,
    issues: [...pageValidation.issues, ...placement.issues],
    bounds: pageValidation.bounds,
    machineBounds: placement.bounds,
    pathCount: pageValidation.pathCount,
  };
  const drawFeed = Math.max(1, finiteNumber(options.drawFeed, 1200));
  const travelFeed = Math.max(1, finiteNumber(options.travelFeed, 3600));
  const penUp = finiteNumber(options.penUp, 5);
  const penDown = finiteNumber(options.penDown, 0);
  const fallbackDwell = Math.max(0, finiteNumber(options.penDwell, 0.10));
  const penDownDwell = Math.max(0, finiteNumber(options.penDownDwell, fallbackDwell));
  const penUpDwell = Math.max(0, finiteNumber(options.penUpDwell, fallbackDwell));
  const strokeRepeats = Math.max(1, Math.min(3, Math.round(finiteNumber(options.strokeRepeats, 1))));
  const allowReverse = options.allowReverse !== false;
  const returnHome = options.returnHome !== false;
  const toolName = String(options.toolName || options.toolId || 'универсальный инструмент').replace(/[\r\n]+/g, ' ');
  const lines = [
    '; HandDraw ESP',
    `; Tool: ${toolName}`,
    `; Paths: ${clean.length}`,
    `; Paper offset: X${formatNumber(placement.machine.paperOffsetX)} Y${formatNumber(placement.machine.paperOffsetY)}`,
    'G21',
    'G90',
    'G94',
    `G0 Z${formatNumber(penUp)}`,
  ];
  if (penUpDwell > 0) lines.push(`G4 P${formatNumber(penUpDwell)}`);
  const ranges = [];

  for (const path of placement.machinePaths) {
    const startByte = utf8Length(`${lines.join('\n')}\n`);
    const first = path[0];
    lines.push(`G0 Z${formatNumber(penUp)}`);
    lines.push(`G1 X${formatNumber(first.x)} Y${formatNumber(first.y)} F${formatNumber(travelFeed, 0)}`);
    lines.push(`G0 Z${formatNumber(penDown)}`);
    if (penDownDwell > 0) lines.push(`G4 P${formatNumber(penDownDwell)}`);
    for (let repeat = 0; repeat < strokeRepeats; repeat += 1) {
      if (repeat > 0 && !allowReverse) {
        lines.push(`G0 Z${formatNumber(penUp)}`);
        if (penUpDwell > 0) lines.push(`G4 P${formatNumber(penUpDwell)}`);
        lines.push(`G1 X${formatNumber(first.x)} Y${formatNumber(first.y)} F${formatNumber(travelFeed, 0)}`);
        lines.push(`G0 Z${formatNumber(penDown)}`);
        if (penDownDwell > 0) lines.push(`G4 P${formatNumber(penDownDwell)}`);
      }
      const points = allowReverse && repeat % 2 === 1 ? [...path].reverse().slice(1) : path.slice(1);
      for (const point of points) lines.push(`G1 X${formatNumber(point.x)} Y${formatNumber(point.y)} F${formatNumber(drawFeed, 0)}`);
    }
    lines.push(`G0 Z${formatNumber(penUp)}`);
    if (penUpDwell > 0) lines.push(`G4 P${formatNumber(penUpDwell)}`);
    const endByte = utf8Length(`${lines.join('\n')}\n`);
    ranges.push({ startByte, endByte });
  }
  if (returnHome) lines.push(`G1 X0 Y0 F${formatNumber(travelFeed, 0)}`);
  lines.push('M2');
  const gcode = `${lines.join('\n')}\n`;
  const totalBytes = Math.max(1, utf8Length(gcode));
  const pathByteRanges = ranges.map((range) => ({
    ...range,
    startFraction: range.startByte / totalBytes,
    endFraction: range.endByte / totalBytes,
  }));
  const analysis = analyzeJob(placement.machinePaths, {
    ...options,
    drawFeed,
    travelFeed,
    penUp,
    penDown,
    penDownDwell,
    penUpDwell,
    strokeRepeats,
  });
  const sourceDataValidation = validatePathData(paths);
  if (!sourceDataValidation.valid) {
    analysis.errors.unshift(...sourceDataValidation.issues.map((message) => ({ code: 'invalid-coordinate', message })));
    analysis.valid = false;
  }
  return { gcode, pathByteRanges, validation, estimate: analysis, analysis, placement };
}

export function generateBoundaryGcode(bounds, page = PAGE_PRESETS.A4_PORTRAIT, options = {}) {
  const padding = Math.max(0, finiteNumber(options.padding, 2));
  const source = bounds && Number.isFinite(bounds.width) ? bounds : { minX: 10, minY: 10, maxX: page.width - 10, maxY: page.height - 10 };
  const minX = Math.max(0, finiteNumber(source.minX, 10) - padding);
  const minY = Math.max(0, finiteNumber(source.minY, 10) - padding);
  const maxX = Math.min(page.width, finiteNumber(source.maxX, page.width - 10) + padding);
  const maxY = Math.min(page.height, finiteNumber(source.maxY, page.height - 10) + padding);
  const penUp = finiteNumber(options.penUp, 5);
  const travelFeed = Math.max(1, finiteNumber(options.travelFeed, 2400));
  const rectangle = [
    { x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }, { x: minX, y: minY },
  ].map((point) => machinePointForPage(point, page, options));
  const placement = validateMachinePlacement([
    [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }, { x: minX, y: minY }],
  ], page, options);
  if (!placement.valid) throw new RangeError(placement.issues.join(' '));
  const lines = [
    '; HandDraw ESP boundary check — pen remains raised',
    'G21', 'G90', 'G94', `G0 Z${formatNumber(penUp)}`,
    `G1 X${formatNumber(rectangle[0].x)} Y${formatNumber(rectangle[0].y)} F${formatNumber(travelFeed, 0)}`,
    ...rectangle.slice(1).map((point) => `G1 X${formatNumber(point.x)} Y${formatNumber(point.y)} F${formatNumber(travelFeed, 0)}`),
    `G1 X0 Y0 F${formatNumber(travelFeed, 0)}`,
    'M2',
  ];
  return {
    gcode: `${lines.join('\n')}\n`,
    bounds: { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY },
    machineBounds: placement.bounds,
  };
}
