import {
  PAGE_PRESETS,
  boundsOfPaths,
  cleanPaths,
  estimateJob,
  fitPathsToPage,
  generateGcode,
  layoutText,
  optimizePathOrder,
  rasterToContourPaths,
  rasterToHatchPaths,
  validateFont,
  validatePathsWithinPage,
} from './core.js';
import { svgTextToPaths } from './svg-import.js';
import { FluidNCClient } from './fluidnc.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STORAGE_KEY = 'handdraw-fonts-v1';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const numberValue = (selector, fallback = 0) => {
  const parsed = Number($(selector)?.value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const state = {
  source: 'text',
  rawPaths: [],
  paths: [],
  pathByteRanges: [],
  gcode: '',
  svgText: '',
  imageData: null,
  fonts: new Map(),
  currentFontName: '',
  baseFont: null,
  fontDraft: new Map(),
  glyphStrokes: [],
  activeGlyphStroke: null,
  simulationFrame: 0,
  simulationStartedAt: 0,
  simulationDuration: 0,
  client: null,
  uploadedJob: null,
};

function setMessage(selector, message) {
  const element = $(selector);
  if (element) element.textContent = message;
}

function logMachine(message) {
  const log = $('#machineLog');
  if (!log) return;
  const stamp = new Date().toLocaleTimeString('ru-RU', { hour12: false });
  log.textContent = `${log.textContent}${log.textContent ? '\n' : ''}[${stamp}] ${message}`;
  log.scrollTop = log.scrollHeight;
}

function safeStorageRead() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeStorageWrite() {
  try {
    const custom = [...state.fonts.values()].filter((font) => font.meta.name !== state.baseFont.meta.name);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
  } catch {
    // Private browsing or an embedded browser may prohibit storage.
  }
}

function addFont(fontSource, select = false) {
  const font = validateFont(fontSource);
  let name = font.meta.name || 'Без названия';
  let suffix = 2;
  while (state.fonts.has(name) && state.fonts.get(name) !== fontSource && name !== font.meta.name) {
    name = `${font.meta.name} ${suffix++}`;
  }
  font.meta.name = name;
  state.fonts.set(name, font);
  refreshFontSelect(select ? name : state.currentFontName || name);
  return font;
}

function refreshFontSelect(selectedName) {
  const select = $('#fontSelect');
  if (!select) return;
  select.textContent = '';
  for (const [name] of state.fonts) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.append(option);
  }
  if (state.fonts.has(selectedName)) select.value = selectedName;
  state.currentFontName = select.value;
}

function currentFont() {
  return state.fonts.get($('#fontSelect')?.value) || state.baseFont;
}

function selectedMargins() {
  return {
    marginLeft: Math.max(0, numberValue('#marginLeft', 10)),
    marginRight: Math.max(0, numberValue('#marginRight', 10)),
    marginTop: Math.max(0, numberValue('#marginTop', 10)),
    marginBottom: Math.max(0, numberValue('#marginBottom', 10)),
  };
}

function landscapeRequested() {
  return $('#pagePreset')?.value === 'A4_LANDSCAPE';
}

function physicalPage() {
  return PAGE_PRESETS.A4_PORTRAIT;
}

function rotateLandscapeToPortrait(paths, logicalHeight = PAGE_PRESETS.A4_LANDSCAPE.height) {
  return cleanPaths(paths).map((path) => path.map((point) => ({ x: logicalHeight - point.y, y: point.x })));
}

function fitSourcePaths(paths) {
  const margins = selectedMargins();
  if (landscapeRequested()) {
    const fitted = fitPathsToPage(paths, PAGE_PRESETS.A4_LANDSCAPE, margins);
    return rotateLandscapeToPortrait(fitted);
  }
  return fitPathsToPage(paths, PAGE_PRESETS.A4_PORTRAIT, margins);
}

function updatePageGeometry() {
  const page = physicalPage();
  const svg = $('#pagePreview');
  svg.setAttribute('viewBox', `0 0 ${page.width} ${page.height}`);
  $('#paperRect').setAttribute('width', page.width);
  $('#paperRect').setAttribute('height', page.height);
  const margins = selectedMargins();
  // Landscape values are rotated into the physical portrait page.
  const left = landscapeRequested() ? margins.marginTop : margins.marginLeft;
  const right = landscapeRequested() ? margins.marginBottom : margins.marginRight;
  const top = landscapeRequested() ? margins.marginLeft : margins.marginTop;
  const bottom = landscapeRequested() ? margins.marginRight : margins.marginBottom;
  const marginRect = $('#marginRect');
  marginRect.setAttribute('x', left);
  marginRect.setAttribute('y', top);
  marginRect.setAttribute('width', Math.max(0, page.width - left - right));
  marginRect.setAttribute('height', Math.max(0, page.height - top - bottom));
}

function pathData(path) {
  return path.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(3)} ${point.y.toFixed(3)}`).join(' ');
}

function renderPaths() {
  updatePageGeometry();
  const drawingLayer = $('#drawingLayer');
  const travelLayer = $('#travelLayer');
  drawingLayer.textContent = '';
  travelLayer.textContent = '';
  state.paths.forEach((path, index) => {
    const element = document.createElementNS(SVG_NS, 'path');
    element.setAttribute('d', pathData(path));
    element.dataset.pathIndex = String(index);
    drawingLayer.append(element);
  });
  if ($('#showTravel').checked) {
    let previous = { x: 0, y: 0 };
    for (const path of state.paths) {
      const element = document.createElementNS(SVG_NS, 'path');
      element.setAttribute('d', pathData([previous, path[0]]));
      travelLayer.append(element);
      previous = path[path.length - 1];
    }
  }
  updateStatistics();
}

function updateStatistics() {
  const estimate = estimateJob(state.paths, {
    drawFeed: numberValue('#drawFeed', 1200),
    travelFeed: numberValue('#travelFeed', 4000),
    penDwell: numberValue('#penDwell', 0.12),
  });
  const bounds = boundsOfPaths(state.paths);
  setMessage('#statPaths', String(estimate.pathCount));
  setMessage('#statPoints', String(estimate.pointCount));
  setMessage('#statDraw', `${estimate.drawLength.toFixed(0)} мм`);
  setMessage('#statTravel', `${estimate.travelLength.toFixed(0)} мм`);
  const minutes = Math.floor(estimate.seconds / 60);
  const seconds = Math.round(estimate.seconds % 60).toString().padStart(2, '0');
  setMessage('#statTime', `${minutes}:${seconds}`);
  setMessage('#statBounds', `${bounds.width.toFixed(1)} × ${bounds.height.toFixed(1)} мм`);
}

function updateValidation(validation) {
  const element = $('#validationMessage');
  element.classList.remove('neutral', 'valid', 'invalid');
  if (validation.valid) {
    element.classList.add('valid');
    element.textContent = landscapeRequested()
      ? 'Макет повёрнут и находится в пределах портретно установленного листа.'
      : 'Макет находится в пределах листа.';
  } else {
    element.classList.add('invalid');
    element.textContent = validation.issues[0] || 'Макет содержит ошибку.';
  }
}

async function textPaths() {
  const logicalPage = landscapeRequested() ? PAGE_PRESETS.A4_LANDSCAPE : PAGE_PRESETS.A4_PORTRAIT;
  const margins = selectedMargins();
  const result = layoutText($('#textInput').value, currentFont(), {
    fontSize: numberValue('#fontSize', 8),
    widthScale: numberValue('#widthScale', 1),
    letterSpacing: numberValue('#letterSpacing', 0.5),
    wordSpacing: numberValue('#wordSpacing', 3),
    lineHeight: numberValue('#lineHeight', 1.35),
    lowercaseScale: numberValue('#lowercaseScale', 70) / 100,
    slant: numberValue('#slant', 0),
    seed: numberValue('#seed', 17),
    originX: margins.marginLeft,
    originY: margins.marginTop,
    maxWidth: logicalPage.width - margins.marginLeft - margins.marginRight,
  });
  if (result.unsupported.length) setMessage('#validationMessage', `Не поддержаны знаки: ${result.unsupported.join(' ')}`);
  return landscapeRequested() ? rotateLandscapeToPortrait(result.paths) : result.paths;
}

async function svgPaths() {
  if (!state.svgText) throw new Error('Сначала выберите SVG-файл.');
  const result = await svgTextToPaths(state.svgText, {
    sampleStep: numberValue('#svgSampleStep', 0.4),
    simplifyTolerance: numberValue('#svgTolerance', 0.08),
    maximumPoints: 50000,
  });
  setMessage('#svgInfo', `Получено ${result.paths.length} штрихов и ${result.pointCount} точек.`);
  return fitSourcePaths(result.paths);
}

function imagePaths() {
  if (!state.imageData) throw new Error('Сначала выберите изображение.');
  const mode = $('input[name="rasterMode"]:checked')?.value || 'hatch';
  const logicalPage = landscapeRequested() ? PAGE_PRESETS.A4_LANDSCAPE : PAGE_PRESETS.A4_PORTRAIT;
  const margins = selectedMargins();
  const widthMm = Math.max(10, logicalPage.width - margins.marginLeft - margins.marginRight);
  const heightMm = widthMm * state.imageData.height / state.imageData.width;
  const common = {
    widthMm,
    heightMm,
    threshold: numberValue('#imageThreshold', 0.5),
    invert: $('#imageInvert').checked,
  };
  const paths = mode === 'contour'
    ? rasterToContourPaths(state.imageData, { ...common, sampleStepPx: numberValue('#contourStep', 2) })
    : rasterToHatchPaths(state.imageData, { ...common, rowSpacingMm: numberValue('#hatchSpacing', 1.4) });
  return fitSourcePaths(paths);
}

async function generate() {
  stopSimulation();
  try {
    let paths;
    if (state.source === 'svg') paths = await svgPaths();
    else if (state.source === 'image') paths = imagePaths();
    else paths = await textPaths();
    paths = cleanPaths(paths);
    if ($('#optimizePaths').checked) paths = optimizePathOrder(paths, { x: 0, y: 0 }, true).paths;
    state.paths = paths;
    const result = generateGcode(paths, physicalPage(), {
      drawFeed: numberValue('#drawFeed', 1200),
      travelFeed: numberValue('#travelFeed', 4000),
      penUp: numberValue('#penUp', 5),
      penDown: numberValue('#penDown', 0),
      penDwell: numberValue('#penDwell', 0.12),
      invertY: true,
    });
    state.gcode = result.gcode;
    state.pathByteRanges = result.pathByteRanges;
    renderPaths();
    updateValidation(result.validation);
    state.uploadedJob = null;
  } catch (error) {
    state.paths = [];
    state.gcode = '';
    renderPaths();
    updateValidation({ valid: false, issues: [error instanceof Error ? error.message : String(error)] });
  }
}

function downloadBlob(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function simulationSegments() {
  const segments = [];
  for (let pathIndex = 0; pathIndex < state.paths.length; pathIndex += 1) {
    const path = state.paths[pathIndex];
    for (let index = 1; index < path.length; index += 1) {
      const start = path[index - 1];
      const end = path[index];
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      if (length > 0) segments.push({ start, end, length, pathIndex });
    }
  }
  return segments;
}

function startSimulation() {
  stopSimulation();
  const segments = simulationSegments();
  if (!segments.length) return;
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  state.simulationDuration = Math.max(1800, Math.min(12000, total * 12));
  state.simulationStartedAt = performance.now();
  const cursor = $('#previewCursor');
  cursor.removeAttribute('hidden');
  const drawElements = $$('#drawingLayer path');
  const animate = (now) => {
    const progress = Math.min(1, (now - state.simulationStartedAt) / state.simulationDuration);
    let target = progress * total;
    let active = segments[segments.length - 1];
    let local = 1;
    for (const segment of segments) {
      if (target <= segment.length) {
        active = segment;
        local = target / segment.length;
        break;
      }
      target -= segment.length;
    }
    const x = active.start.x + (active.end.x - active.start.x) * local;
    const y = active.start.y + (active.end.y - active.start.y) * local;
    cursor.setAttribute('cx', x.toFixed(3));
    cursor.setAttribute('cy', y.toFixed(3));
    drawElements.forEach((element, index) => {
      element.classList.toggle('completed', index < active.pathIndex);
      element.classList.toggle('current', index === active.pathIndex);
    });
    $('#jobProgressBar').style.width = `${(progress * 100).toFixed(1)}%`;
    if (progress < 1) state.simulationFrame = requestAnimationFrame(animate);
  };
  state.simulationFrame = requestAnimationFrame(animate);
}

function stopSimulation() {
  cancelAnimationFrame(state.simulationFrame);
  state.simulationFrame = 0;
  const cursor = $('#previewCursor');
  if (cursor) {
    cursor.setAttribute('hidden', '');
    cursor.setAttribute('cx', '0');
    cursor.setAttribute('cy', '0');
  }
  $$('#drawingLayer path').forEach((element) => element.classList.remove('completed', 'current'));
  if ($('#jobProgressBar')) $('#jobProgressBar').style.width = '0%';
}

function activatePanel(name) {
  $$('.panel-tab').forEach((button) => button.classList.toggle('active', button.dataset.panel === name));
  $$('[data-panel-content]').forEach((panel) => panel.classList.toggle('active', panel.dataset.panelContent === name));
  if (name === 'font') requestAnimationFrame(drawGlyphBoard);
}

function activateSource(name) {
  state.source = name;
  $$('.source-tab').forEach((button) => button.classList.toggle('active', button.dataset.source === name));
  $$('[data-source-content]').forEach((section) => section.classList.toggle('active', section.dataset.sourceContent === name));
}

async function loadSvgFile(file) {
  if (!file) return;
  state.svgText = await file.text();
  setMessage('#svgInfo', `${file.name}: ${(file.size / 1024).toFixed(1)} КБ.`);
}

async function loadImageFile(file) {
  if (!file) return;
  const bitmap = await createImageBitmap(file);
  const maxSide = 900;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = $('#imageCanvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.clearRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  state.imageData = context.getImageData(0, 0, width, height);
  bitmap.close();
  setMessage('#imageInfo', `${file.name}: ${bitmap.width || width} × ${bitmap.height || height}; обработка ${width} × ${height}.`);
}

function glyphCanvasPoint(event) {
  const canvas = $('#glyphBoard');
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
  };
}

function drawGlyphBoard() {
  const canvas = $('#glyphBoard');
  if (!canvas) return;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#d3dcde';
  context.lineWidth = 1;
  for (let index = 1; index < 10; index += 1) {
    context.beginPath();
    context.moveTo(index * canvas.width / 10, 0);
    context.lineTo(index * canvas.width / 10, canvas.height);
    context.stroke();
    context.beginPath();
    context.moveTo(0, index * canvas.height / 10);
    context.lineTo(canvas.width, index * canvas.height / 10);
    context.stroke();
  }
  context.strokeStyle = '#176b73';
  context.lineWidth = 5;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const stroke of [...state.glyphStrokes, ...(state.activeGlyphStroke ? [state.activeGlyphStroke] : [])]) {
    if (stroke.length < 2) continue;
    context.beginPath();
    stroke.forEach((point, index) => {
      const x = point.x * canvas.width;
      const y = point.y * canvas.height;
      if (index) context.lineTo(x, y);
      else context.moveTo(x, y);
    });
    context.stroke();
  }
}

function startGlyphStroke(event) {
  event.preventDefault();
  $('#glyphBoard').setPointerCapture?.(event.pointerId);
  state.activeGlyphStroke = [glyphCanvasPoint(event)];
  drawGlyphBoard();
}

function extendGlyphStroke(event) {
  if (!state.activeGlyphStroke) return;
  const point = glyphCanvasPoint(event);
  const previous = state.activeGlyphStroke[state.activeGlyphStroke.length - 1];
  if (Math.hypot(point.x - previous.x, point.y - previous.y) > 0.003) state.activeGlyphStroke.push(point);
  drawGlyphBoard();
}

function endGlyphStroke(event) {
  if (!state.activeGlyphStroke) return;
  extendGlyphStroke(event);
  if (state.activeGlyphStroke.length >= 2) state.glyphStrokes.push(state.activeGlyphStroke);
  state.activeGlyphStroke = null;
  drawGlyphBoard();
}

function saveDraftGlyph() {
  const symbol = [...($('#glyphCharacter').value || '')][0];
  if (!symbol) return setMessage('#fontMessage', 'Укажите знак.');
  if (!state.glyphStrokes.length) return setMessage('#fontMessage', 'Нарисуйте хотя бы один штрих.');
  const strokes = state.glyphStrokes.map((stroke) => stroke.map((point) => ({ x: point.x, y: point.y })));
  state.fontDraft.set(symbol, [{ advance: Math.max(0.2, numberValue('#glyphAdvance', 0.82)), strokes }]);
  state.glyphStrokes = [];
  drawGlyphBoard();
  setMessage('#fontMessage', `Знак «${symbol}» сохранён в черновике.`);
}

function useDraftFont() {
  const name = $('#fontName').value.trim() || 'Мой почерк';
  const source = JSON.parse(JSON.stringify(state.baseFont));
  source.meta = {
    ...source.meta,
    name,
    author: $('#fontAuthor').value.trim() || 'Не указан',
    license: $('#fontLicense').value.trim() || 'Не указана',
    version: '1.0',
    description: 'Пользовательский шрифт HandDraw ESP.',
  };
  for (const [symbol, variants] of state.fontDraft) source.glyphs[symbol] = variants;
  const font = addFont(source, true);
  safeStorageWrite();
  setMessage('#fontMessage', `Шрифт «${font.meta.name}» установлен.`);
  activatePanel('layout');
  generate();
}

function exportCurrentFont() {
  const font = currentFont();
  downloadBlob(`${font.meta.name.replace(/[^0-9A-Za-zА-Яа-яЁё._-]+/g, '-')}.handdraw-font.json`, `${JSON.stringify(font, null, 2)}\n`, 'application/json;charset=utf-8');
}

async function importFont(file) {
  if (!file) return;
  try {
    const font = addFont(JSON.parse(await file.text()), true);
    safeStorageWrite();
    setMessage('#fontMessage', `Импортирован шрифт «${font.meta.name}».`);
  } catch (error) {
    setMessage('#fontMessage', error instanceof Error ? error.message : String(error));
  }
}

function updateMachineStatus(status) {
  setMessage('#machineState', status.state);
  const position = status.mpos || status.wpos || { x: 0, y: 0, z: 0 };
  setMessage('#machineX', position.x.toFixed(3).replace('.', ','));
  setMessage('#machineY', position.y.toFixed(3).replace('.', ','));
  setMessage('#machineZ', position.z.toFixed(3).replace('.', ','));
  setMessage('#machineFeed', String(status.feed ?? 0));
  const percent = status.job?.percent ?? 0;
  setMessage('#machineProgress', `${Number(percent).toFixed(1)}%`);
  $('#jobProgressBar').style.width = `${Math.max(0, Math.min(100, Number(percent)))}%`;
}

function ensureClient() {
  const address = $('#controllerAddress').value.trim();
  if (!state.client || (address && !state.client.baseUrl.includes(address))) {
    state.client?.disconnect();
    state.client = new FluidNCClient(address);
    state.client.addEventListener('connection', (event) => {
      const connected = Boolean(event.detail?.connected);
      $('#connectionDot').classList.toggle('connected', connected);
      setMessage('#connectionLabel', connected ? 'FluidNC подключён' : 'Нет соединения');
      logMachine(connected ? 'Соединение установлено.' : 'Соединение закрыто.');
    });
    state.client.addEventListener('status', (event) => updateMachineStatus(event.detail));
    state.client.addEventListener('message', (event) => logMachine(event.detail));
    state.client.addEventListener('error', (event) => logMachine(`Ошибка: ${event.detail?.message || 'соединение'}`));
  }
  return state.client;
}

async function uploadJob() {
  if (!state.gcode) await generate();
  if (!state.gcode) throw new Error('G-code не сформирован.');
  const result = await ensureClient().uploadJob(state.gcode, $('#jobName').value, 'sd');
  state.uploadedJob = result;
  logMachine(`Задание записано: ${result.path}`);
}

function bindEvents() {
  $$('.panel-tab').forEach((button) => button.addEventListener('click', () => activatePanel(button.dataset.panel)));
  $$('.source-tab').forEach((button) => button.addEventListener('click', () => activateSource(button.dataset.source)));
  $('#generateButton').addEventListener('click', generate);
  $('#downloadGcodeButton').addEventListener('click', async () => {
    if (!state.gcode) await generate();
    if (state.gcode) downloadBlob($('#jobName').value || 'handdraw-job.gcode', state.gcode, 'text/plain;charset=utf-8');
  });
  $('#simulateButton').addEventListener('click', startSimulation);
  $('#resetSimulationButton').addEventListener('click', stopSimulation);
  $('#showTravel').addEventListener('change', renderPaths);
  $('#pagePreset').addEventListener('change', generate);
  $('#svgFile').addEventListener('change', (event) => loadSvgFile(event.target.files?.[0]));
  $('#imageFile').addEventListener('change', (event) => loadImageFile(event.target.files?.[0]).catch((error) => setMessage('#imageInfo', error.message)));
  $('#fontSelect').addEventListener('change', (event) => { state.currentFontName = event.target.value; generate(); });

  const canvas = $('#glyphBoard');
  canvas.addEventListener('pointerdown', startGlyphStroke);
  canvas.addEventListener('pointermove', extendGlyphStroke);
  canvas.addEventListener('pointerup', endGlyphStroke);
  canvas.addEventListener('pointercancel', endGlyphStroke);
  $('#glyphUndo').addEventListener('click', () => { state.glyphStrokes.pop(); drawGlyphBoard(); });
  $('#glyphClear').addEventListener('click', () => { state.glyphStrokes = []; state.activeGlyphStroke = null; drawGlyphBoard(); });
  $('#glyphSave').addEventListener('click', saveDraftGlyph);
  $('#fontUse').addEventListener('click', useDraftFont);
  $('#fontExport').addEventListener('click', exportCurrentFont);
  $('#fontImport').addEventListener('change', (event) => importFont(event.target.files?.[0]));

  $('#connectButton').addEventListener('click', () => {
    const client = ensureClient();
    client.autoReconnect = true;
    client.connect();
  });
  $('#disconnectButton').addEventListener('click', () => state.client?.disconnect());
  $('#homeButton').addEventListener('click', () => ensureClient().home());
  $('#penUpButton').addEventListener('click', () => ensureClient().setPen(true));
  $('#penDownButton').addEventListener('click', () => ensureClient().setPen(false));
  $('#uploadButton').addEventListener('click', () => uploadJob().catch((error) => logMachine(error.message)));
  $('#startButton').addEventListener('click', async () => {
    try {
      if (!state.uploadedJob) await uploadJob();
      ensureClient().startJob(state.uploadedJob.path, state.uploadedJob.storage);
    } catch (error) { logMachine(error.message); }
  });
  $('#pauseButton').addEventListener('click', () => ensureClient().pause());
  $('#resumeButton').addEventListener('click', () => ensureClient().resume());
  $('#stopButton').addEventListener('click', () => ensureClient().stop());
  $$('[data-jog-axis]').forEach((button) => button.addEventListener('click', () => ensureClient().jog(button.dataset.jogAxis, Number(button.dataset.jogDistance), 600)));

  window.addEventListener('beforeunload', (event) => {
    if (state.client?.status?.state === 'Run') {
      event.preventDefault();
      event.returnValue = '';
    }
  });
}

async function init() {
  try {
    const embedded = window.HANDDRAW_EMBEDDED_FONT;
    const font = embedded ? validateFont(embedded) : validateFont(await (await fetch('./fonts/technical-cyrillic.json')).json());
    state.baseFont = font;
    addFont(font, true);
    for (const saved of safeStorageRead()) {
      try { addFont(saved); } catch { /* ignore an invalid old user font */ }
    }
    bindEvents();
    drawGlyphBoard();
    await generate();
  } catch (error) {
    updateValidation({ valid: false, issues: [error instanceof Error ? error.message : String(error)] });
  }
}

init();
