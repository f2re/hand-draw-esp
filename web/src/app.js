import {
  MACHINE_DEFAULTS,
  PAGE_PRESETS,
  calculateCalibratedStepsPerMm,
  createDefaultMachineProfile,
  TEXT_PRESETS,
  TOOL_PROFILES,
  analyzeJob,
  boundsOfPaths,
  cleanPaths,
  fitPathsToPage,
  generateBoundaryGcode,
  generateGcode,
  getTextPreset,
  getToolProfile,
  layoutText,
  optimizePathOrder,
  rasterToComicPaths,
  rasterToContourPaths,
  rasterToHatchPaths,
  validateFont,
  validateMachineProfile,
} from './core.js';
import { svgTextToPaths } from './svg-import.js';
import { FluidNCClient, machineStateKind } from './fluidnc.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FONT_STORAGE_KEY = 'handdraw-fonts-v1';
const SETTINGS_STORAGE_KEY = 'handdraw-settings-v3';
const MACHINE_PROFILE_STORAGE_KEY = 'handdraw-machine-profiles-v1';
const DEFAULT_MACHINE_PROFILE_NAME = 'A4 · центрированный';
const SETTINGS_IDS = [
  'fontSelect', 'fontSize', 'widthScale', 'letterSpacing', 'wordSpacing', 'lineHeight', 'lowercaseScale', 'slant', 'textJitter', 'heightJitter', 'seed', 'textAlign',
  'svgSampleStep', 'svgTolerance', 'imageThreshold', 'hatchSpacing', 'hatchAngle', 'contourStep', 'imageInvert',
  'pagePreset', 'marginLeft', 'marginRight', 'marginTop', 'marginBottom', 'optimizePaths', 'showTravel',
  'drawFeed', 'travelFeed', 'penUp', 'penDown', 'penDownDwell', 'penUpDwell', 'strokeRepeats', 'returnHome', 'jobName',
  'paperOffsetX', 'paperOffsetY', 'stepsPerMmX', 'stepsPerMmY', 'controllerAddress', 'jogDistance', 'jogFeed',
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const numberValue = (selector, fallback = 0) => {
  const parsed = Number($(selector)?.value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

const state = {
  source: 'text',
  toolProfileId: 'fineliner',
  textPresetId: 'neat',
  paths: [],
  pathByteRanges: [],
  gcode: '',
  gcodeSignature: '',
  validation: { valid: false, issues: ['Макет не сформирован.'] },
  analysis: null,
  sourceWarnings: [],
  svgText: '',
  imageData: null,
  fonts: new Map(),
  currentFontName: '',
  baseFont: null,
  handwritingFont: null,
  builtInFontNames: new Set(),
  fontDraft: new Map(),
  glyphStrokes: [],
  activeGlyphStroke: null,
  simulationFrame: 0,
  simulationStartedAt: 0,
  simulationDuration: 0,
  generateTimer: 0,
  generating: false,
  client: null,
  uploadedJob: null,
  uploadedSignature: '',
  boundarySent: false,
  machineProfiles: new Map(),
  builtInMachineProfileNames: new Set(),
  activeMachineProfileName: DEFAULT_MACHINE_PROFILE_NAME,
  controllerDiagnostics: {
    fluidncVersion: '',
    buildSummary: '',
    configFile: '',
    sdStatus: '',
  },
  machine: {
    homed: false,
    homingPending: false,
    penTestSent: false,
    penTestPending: false,
    boundaryPending: false,
    previousState: 'Unknown',
    reportedComplete: false,
  },
};

function setMessage(selector, message) {
  const element = $(selector);
  if (element) element.textContent = message;
}

function setValue(selector, value) {
  const element = $(selector);
  if (!element) return;
  if (element.type === 'checkbox') element.checked = Boolean(value);
  else element.value = String(value);
}

function readJsonStorage(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null');
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* embedded/private browsing */ }
}

function hashString(value) {
  let hash = 2166136261;
  for (const symbol of String(value)) {
    hash ^= symbol.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function formatDecimal(value, digits = 1) {
  return Number(value).toFixed(digits).replace('.', ',');
}

function formatDuration(seconds) {
  const rounded = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function logMachine(message) {
  const log = $('#machineLog');
  if (!log) return;
  const stamp = new Date().toLocaleTimeString('ru-RU', { hour12: false });
  log.textContent = `${log.textContent}${log.textContent ? '\n' : ''}[${stamp}] ${message}`;
  log.scrollTop = log.scrollHeight;
}

function saveFonts() {
  if (!state.baseFont) return;
  const custom = [...state.fonts.values()].filter((font) => !state.builtInFontNames.has(font.meta.name));
  writeJsonStorage(FONT_STORAGE_KEY, custom);
}

function saveMachineProfiles() {
  const custom = [...state.machineProfiles.entries()]
    .filter(([name]) => !state.builtInMachineProfileNames.has(name))
    .map(([, profile]) => profile);
  writeJsonStorage(MACHINE_PROFILE_STORAGE_KEY, custom);
}

function refreshMachineProfileSelect(selectedName = state.activeMachineProfileName) {
  const select = $('#machineProfileSelect');
  if (!select) return;
  select.textContent = '';
  for (const [name] of state.machineProfiles) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = state.builtInMachineProfileNames.has(name) ? `${name} · номинальный` : name;
    select.append(option);
  }
  if (state.machineProfiles.has(selectedName)) select.value = selectedName;
  state.activeMachineProfileName = select.value || DEFAULT_MACHINE_PROFILE_NAME;
}

function loadMachineProfiles() {
  state.machineProfiles.clear();
  state.builtInMachineProfileNames.clear();
  const nominal = createDefaultMachineProfile(DEFAULT_MACHINE_PROFILE_NAME);
  state.machineProfiles.set(nominal.name, nominal);
  state.builtInMachineProfileNames.add(nominal.name);
  const saved = readJsonStorage(MACHINE_PROFILE_STORAGE_KEY, []);
  if (Array.isArray(saved)) {
    for (const source of saved) {
      try {
        const profile = validateMachineProfile(source);
        if (!state.builtInMachineProfileNames.has(profile.name)) state.machineProfiles.set(profile.name, profile);
      } catch { /* ignore damaged old profile */ }
    }
  }
  refreshMachineProfileSelect();
}

function activeMachineProfile() {
  return state.machineProfiles.get(state.activeMachineProfileName)
    || state.machineProfiles.get(DEFAULT_MACHINE_PROFILE_NAME)
    || createDefaultMachineProfile();
}

function diagnosticsLine(lines, fallback) {
  const values = (Array.isArray(lines) ? lines : [lines]).map((line) => String(line ?? '').trim()).filter(Boolean);
  return (values.find((line) => !/^ok$/i.test(line)) || fallback).slice(0, 240);
}

function commissioningSnapshot() {
  return {
    directionX: Boolean($('#commissionDirectionX')?.checked),
    directionY: Boolean($('#commissionDirectionY')?.checked),
    limitX: Boolean($('#commissionLimitX')?.checked),
    limitY: Boolean($('#commissionLimitY')?.checked),
    homingRepeated: Boolean($('#commissionHomingRepeated')?.checked),
  };
}

function currentMachineProfile(name = $('#machineProfileName')?.value.trim() || 'Мой станок') {
  const existing = activeMachineProfile();
  return validateMachineProfile({
    format: 'handdraw-machine-profile-v1',
    name,
    controller: {
      board: existing.controller.board || 'MKS DLC32 V2.1',
      fluidncVersion: state.controllerDiagnostics.fluidncVersion,
      configFile: state.controllerDiagnostics.configFile,
      sdStatus: state.controllerDiagnostics.sdStatus,
    },
    geometry: {
      workWidth: MACHINE_DEFAULTS.workWidth,
      workHeight: MACHINE_DEFAULTS.workHeight,
      paperOffsetX: numberValue('#paperOffsetX', MACHINE_DEFAULTS.paperOffsetX),
      paperOffsetY: numberValue('#paperOffsetY', MACHINE_DEFAULTS.paperOffsetY),
      stepsPerMmX: numberValue('#stepsPerMmX', MACHINE_DEFAULTS.stepsPerMmX),
      stepsPerMmY: numberValue('#stepsPerMmY', MACHINE_DEFAULTS.stepsPerMmY),
    },
    pen: {
      servoMinZ: MACHINE_DEFAULTS.servoMinZ,
      servoMaxZ: MACHINE_DEFAULTS.servoMaxZ,
      penUp: numberValue('#penUp', MACHINE_DEFAULTS.servoMaxZ),
      penDown: numberValue('#penDown', MACHINE_DEFAULTS.servoMinZ),
    },
    commissioning: commissioningSnapshot(),
    notes: $('#machineProfileNotes')?.value || '',
    updatedAt: new Date().toISOString(),
  });
}

function updateCommissioningStatus() {
  const checks = commissioningSnapshot();
  const completed = Object.values(checks).filter(Boolean).length;
  const version = state.controllerDiagnostics.fluidncVersion;
  const versionCompatible = Boolean(version && version.startsWith(MACHINE_DEFAULTS.supportedFluidNCVersion));
  const ready = completed === 5 && versionCompatible;
  const badge = $('#machineProfileBadge');
  if (badge) {
    badge.classList.toggle('ready', ready);
    badge.classList.toggle('warning', Boolean(version && !versionCompatible));
    badge.textContent = ready ? 'Готов к рабочему профилю'
      : version && !versionCompatible ? `FluidNC ${version} · проверить`
        : `Наладка ${completed}/5`;
  }
  setMessage('#diagnosticFirmware', version || 'не опрошен');
  setMessage('#diagnosticConfig', state.controllerDiagnostics.configFile || 'не определён');
  setMessage('#diagnosticSd', state.controllerDiagnostics.sdStatus || 'не опрошена');
  setMessage('#commissioningSummary', ready
    ? 'Направления, концевики и повторный homing подтверждены. Можно использовать config-production.yaml.'
    : `Подтверждено ${completed} из 5 аппаратных проверок. Рабочую конфигурацию пока не включайте.`);
  if ($('#deleteMachineProfileButton')) $('#deleteMachineProfileButton').disabled = state.builtInMachineProfileNames.has(state.activeMachineProfileName);
}

function applyMachineProfile(name, options = {}) {
  const profile = state.machineProfiles.get(name) || activeMachineProfile();
  state.activeMachineProfileName = profile.name;
  refreshMachineProfileSelect(profile.name);
  setValue('#machineProfileName', profile.name);
  setValue('#paperOffsetX', profile.geometry.paperOffsetX);
  setValue('#paperOffsetY', profile.geometry.paperOffsetY);
  setValue('#stepsPerMmX', profile.geometry.stepsPerMmX);
  setValue('#stepsPerMmY', profile.geometry.stepsPerMmY);
  setValue('#penUp', profile.pen.penUp);
  setValue('#penDown', profile.pen.penDown);
  setValue('#machineProfileNotes', profile.notes || '');
  for (const [key, id] of Object.entries({
    directionX: 'commissionDirectionX', directionY: 'commissionDirectionY',
    limitX: 'commissionLimitX', limitY: 'commissionLimitY', homingRepeated: 'commissionHomingRepeated',
  })) setValue(`#${id}`, profile.commissioning[key]);
  state.controllerDiagnostics = {
    fluidncVersion: profile.controller.fluidncVersion || '',
    buildSummary: profile.controller.fluidncVersion ? `FluidNC ${profile.controller.fluidncVersion}` : '',
    configFile: profile.controller.configFile || '',
    sdStatus: profile.controller.sdStatus || '',
  };
  updateCommissioningStatus();
  invalidateToolChecks();
  if (options.persist !== false) saveSettings();
  if (options.generate !== false) scheduleGenerate(30);
}

function saveCurrentMachineProfile() {
  let requestedName = $('#machineProfileName').value.trim() || 'Мой станок';
  if (state.builtInMachineProfileNames.has(requestedName)) requestedName = `${requestedName} · мой`;
  const profile = currentMachineProfile(requestedName);
  state.machineProfiles.set(profile.name, profile);
  state.activeMachineProfileName = profile.name;
  saveMachineProfiles();
  refreshMachineProfileSelect(profile.name);
  setValue('#machineProfileName', profile.name);
  updateCommissioningStatus();
  saveSettings();
  logMachine(`Профиль станка «${profile.name}» сохранён.`);
}

function removeCurrentMachineProfile() {
  const name = state.activeMachineProfileName;
  if (state.builtInMachineProfileNames.has(name)) return logMachine('Номинальный профиль удалить нельзя.');
  state.machineProfiles.delete(name);
  saveMachineProfiles();
  applyMachineProfile(DEFAULT_MACHINE_PROFILE_NAME);
  logMachine(`Профиль «${name}» удалён.`);
}

function exportCurrentMachineProfile() {
  const profile = currentMachineProfile(state.activeMachineProfileName);
  const safeName = profile.name.replace(/[^0-9A-Za-zА-Яа-яЁё._-]+/g, '-');
  downloadBlob(`${safeName}.handdraw-machine.json`, `${JSON.stringify(profile, null, 2)}\n`, 'application/json;charset=utf-8');
}

async function importMachineProfile(file) {
  if (!file) return;
  const profile = validateMachineProfile(JSON.parse(await file.text()));
  const importedName = state.builtInMachineProfileNames.has(profile.name) ? `${profile.name} · импорт` : profile.name;
  profile.name = importedName;
  state.machineProfiles.set(profile.name, profile);
  saveMachineProfiles();
  applyMachineProfile(profile.name);
  logMachine(`Импортирован профиль станка «${profile.name}».`);
}

function calculateMachineCalibration() {
  const commanded = numberValue('#calibrationCommanded', 100);
  const measuredX = numberValue('#calibrationMeasuredX', NaN);
  const measuredY = numberValue('#calibrationMeasuredY', NaN);
  const currentX = numberValue('#stepsPerMmX', MACHINE_DEFAULTS.stepsPerMmX);
  const currentY = numberValue('#stepsPerMmY', MACHINE_DEFAULTS.stepsPerMmY);
  const results = [];
  if (Number.isFinite(measuredX) && measuredX > 0) {
    const next = calculateCalibratedStepsPerMm(currentX, commanded, measuredX);
    setValue('#stepsPerMmX', next.toFixed(4));
    results.push(`X ${next.toFixed(4)}`);
  }
  if (Number.isFinite(measuredY) && measuredY > 0) {
    const next = calculateCalibratedStepsPerMm(currentY, commanded, measuredY);
    setValue('#stepsPerMmY', next.toFixed(4));
    results.push(`Y ${next.toFixed(4)}`);
  }
  if (!results.length) throw new Error('Введите измеренную длину хотя бы для одной оси.');
  setMessage('#calibrationResult', `Новые значения steps/mm: ${results.join(' · ')}.`);
  logMachine(`Калибровка рассчитана: ${results.join(', ')}.`);
}

function exportCalibrationFragment() {
  const profile = currentMachineProfile(state.activeMachineProfileName);
  const yaml = [
    '# HandDraw ESP — перенесите значения в обе конфигурации после контрольного измерения',
    'axes:',
    '  x:',
    `    steps_per_mm: ${profile.geometry.stepsPerMmX.toFixed(4)}`,
    '  y:',
    `    steps_per_mm: ${profile.geometry.stepsPerMmY.toFixed(4)}`,
    '',
  ].join('\n');
  downloadBlob('handdraw-steps-calibration.yaml', yaml, 'text/yaml;charset=utf-8');
}

async function runControllerDiagnostics() {
  const button = $('#controllerDiagnosticsButton');
  button.disabled = true;
  button.textContent = 'Опрос…';
  try {
    const result = await ensureClient().queryDiagnostics();
    state.controllerDiagnostics = {
      fluidncVersion: result.build.version,
      buildSummary: result.build.summary,
      configFile: diagnosticsLine(result.configLines, 'не определён'),
      sdStatus: diagnosticsLine(result.sdLines, 'нет ответа'),
    };
    logMachine(result.build.summary || 'Контроллер ответил на $I.');
    logMachine(`Конфигурация: ${state.controllerDiagnostics.configFile}.`);
    logMachine(`SD: ${state.controllerDiagnostics.sdStatus}.`);
    updateCommissioningStatus();
  } finally {
    button.disabled = false;
    button.textContent = 'Опросить контроллер';
  }
}

async function runLimitMonitor() {
  const button = $('#limitMonitorButton');
  button.disabled = true;
  button.textContent = 'Нажимайте концевики…';
  logMachine('Диагностика $Limits запущена на 8 секунд. Поочерёдно нажмите X и Y.');
  try {
    const lines = await ensureClient().monitorLimits(8000);
    if (lines.length) logMachine(`$Limits: ${lines.join(' | ')}`);
    else logMachine('$Limits завершён. Сверьте изменения входов по журналу FluidNC.');
  } finally {
    button.disabled = false;
    button.textContent = 'Проверить концевики 8 с';
  }
}

function saveSettings() {
  const controls = {};
  for (const id of SETTINGS_IDS) {
    const element = $(`#${id}`);
    if (!element) continue;
    controls[id] = element.type === 'checkbox' ? element.checked : element.value;
  }
  writeJsonStorage(SETTINGS_STORAGE_KEY, {
    version: 3,
    source: state.source,
    toolProfileId: state.toolProfileId,
    textPresetId: state.textPresetId,
    machineProfileName: state.activeMachineProfileName,
    rasterMode: $('input[name="rasterMode"]:checked')?.value || 'hatch',
    controls,
  });
}

function deterministicNoise(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function createHandwritingFont(baseFont) {
  const source = JSON.parse(JSON.stringify(baseFont));
  source.meta = {
    ...source.meta,
    name: 'Рукописный однолинейный',
    author: 'HandDraw ESP',
    version: '1.0',
    description: 'Смягчённые варианты технического штрихового шрифта для естественной записи.',
  };
  const glyphs = {};
  for (const [symbol, variants] of Object.entries(source.glyphs)) {
    const symbolSeed = [...symbol].reduce((sum, item) => sum + (item.codePointAt(0) || 0), 0);
    glyphs[symbol] = [];
    for (let variantIndex = 0; variantIndex < 3; variantIndex += 1) {
      const random = deterministicNoise(symbolSeed * 131 + variantIndex * 7919);
      const baseVariant = variants[variantIndex % variants.length];
      const strokes = baseVariant.strokes.map((stroke) => {
        const normalized = stroke.map((point) => Array.isArray(point) ? { x: point[0], y: point[1] } : point);
        const softened = [];
        for (let index = 0; index < normalized.length; index += 1) {
          const point = normalized[index];
          const perturbed = {
            x: point.x + (random() - 0.5) * 0.018 + (point.y - 0.5) * (variantIndex - 1) * 0.006,
            y: point.y + (random() - 0.5) * 0.014,
          };
          if (index > 0) {
            const previous = normalized[index - 1];
            const dx = point.x - previous.x;
            const dy = point.y - previous.y;
            const length = Math.hypot(dx, dy) || 1;
            const bow = (random() - 0.5) * 0.018;
            softened.push({
              x: (previous.x + point.x) / 2 - dy / length * bow,
              y: (previous.y + point.y) / 2 + dx / length * bow,
            });
          }
          softened.push(perturbed);
        }
        return softened;
      });
      glyphs[symbol].push({
        advance: Math.max(0.05, Number(baseVariant.advance || 0.72) * (0.985 + random() * 0.03)),
        strokes,
      });
    }
  }
  source.glyphs = glyphs;
  return validateFont(source);
}

function addFont(fontSource, select = false) {
  const font = validateFont(fontSource);
  let name = font.meta.name || 'Без названия';
  let suffix = 2;
  while (state.fonts.has(name)) name = `${font.meta.name || 'Шрифт'} ${suffix++}`;
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

function populateTextPresets() {
  const root = $('#textPresetList');
  root.textContent = '';
  for (const preset of Object.values(TEXT_PRESETS)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset-button';
    button.dataset.textPreset = preset.id;
    button.textContent = preset.name;
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', 'false');
    root.append(button);
  }
}

function populateToolProfiles() {
  const root = $('#toolProfileList');
  root.textContent = '';
  for (const profile of Object.values(TOOL_PROFILES)) {
    const label = document.createElement('label');
    label.className = 'tool-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'toolProfile';
    input.value = profile.id;
    const surface = document.createElement('span');
    const symbol = document.createElement('b');
    symbol.textContent = profile.symbol;
    const name = document.createElement('strong');
    name.textContent = profile.shortName;
    const description = document.createElement('small');
    description.textContent = profile.description;
    surface.append(symbol, name, description);
    label.append(input, surface);
    root.append(label);
  }
}

function applyTextPreset(presetId, options = {}) {
  const preset = getTextPreset(presetId);
  state.textPresetId = preset.id;
  setValue('#fontSize', preset.fontSize);
  setValue('#widthScale', preset.widthScale);
  setValue('#letterSpacing', preset.letterSpacing);
  setValue('#wordSpacing', preset.wordSpacing);
  setValue('#lineHeight', preset.lineHeight);
  setValue('#lowercaseScale', Math.round(preset.lowercaseScale * 100));
  setValue('#slant', preset.slant);
  setValue('#textJitter', preset.jitter);
  setValue('#heightJitter', preset.heightJitter);
  setValue('#textAlign', preset.align);
  $$('#textPresetList [data-text-preset]').forEach((button) => {
    const active = button.dataset.textPreset === preset.id;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(active));
  });
  setMessage('#textPresetSummary', preset.description);
  if (options.persist !== false) saveSettings();
  if (options.generate !== false) scheduleGenerate();
}

function selectRasterMode(mode) {
  const input = $(`input[name="rasterMode"][value="${mode}"]`);
  if (input) input.checked = true;
}

function applyToolProfile(profileId, options = {}) {
  const profile = getToolProfile(profileId);
  const machineProfile = activeMachineProfile();
  state.toolProfileId = profile.id;
  const radio = $(`input[name="toolProfile"][value="${profile.id}"]`);
  if (radio) radio.checked = true;
  if (options.values !== false) {
    setValue('#drawFeed', profile.drawFeed);
    setValue('#travelFeed', profile.travelFeed);
    setValue('#jogFeed', profile.jogFeed);
    setValue('#penUp', machineProfile.pen.penUp);
    setValue('#penDown', machineProfile.pen.penDown);
    setValue('#penDownDwell', profile.penDownDwell);
    setValue('#penUpDwell', profile.penUpDwell);
    setValue('#strokeRepeats', profile.strokeRepeats);
    setValue('#imageThreshold', profile.rasterDefaults.threshold);
    setValue('#hatchSpacing', profile.rasterDefaults.hatchSpacing);
    setValue('#hatchAngle', profile.rasterDefaults.hatchAngle);
    setValue('#contourStep', profile.rasterDefaults.contourStep);
    selectRasterMode(profile.rasterDefaults.mode);
  }
  setMessage('#toolProfileSymbol', profile.symbol);
  setMessage('#toolProfileName', profile.name);
  setMessage('#toolProfileDescription', profile.description);
  setMessage('#profileDrawFeed', `${profile.drawFeed} мм/мин`);
  setMessage('#profileTravelFeed', `${profile.travelFeed} мм/мин`);
  setMessage('#profileDwell', `${formatDecimal(profile.penDownDwell, 2)} / ${formatDecimal(profile.penUpDwell, 2)} с`);
  setMessage('#toolProfileNote', profile.note);
  setMessage('#previewToolBadge', `${profile.symbol} ${profile.shortName}`);
  $('#pagePreview')?.style.setProperty('--preview-stroke', String(profile.previewWidth));
  if (options.textPreset === true && profile.textDefaults?.preset) applyTextPreset(profile.textDefaults.preset, { generate: false, persist: false });
  invalidateToolChecks();
  if (options.persist !== false) saveSettings();
  if (options.generate !== false) scheduleGenerate();
}

function restoreSettings() {
  const saved = readJsonStorage(SETTINGS_STORAGE_KEY, null);
  const profileId = saved?.toolProfileId && TOOL_PROFILES[saved.toolProfileId] ? saved.toolProfileId : 'fineliner';
  applyToolProfile(profileId, { generate: false, persist: false, textPreset: false });
  const defaultTextPreset = saved?.textPresetId && TEXT_PRESETS[saved.textPresetId] ? saved.textPresetId : TOOL_PROFILES[profileId].textDefaults.preset;
  applyTextPreset(defaultTextPreset, { generate: false, persist: false });
  const machineProfileName = state.machineProfiles.has(saved?.machineProfileName) ? saved.machineProfileName : DEFAULT_MACHINE_PROFILE_NAME;
  applyMachineProfile(machineProfileName, { generate: false, persist: false });
  if (saved?.controls && typeof saved.controls === 'object') {
    for (const [id, value] of Object.entries(saved.controls)) setValue(`#${id}`, value);
  }
  if (saved?.rasterMode) selectRasterMode(saved.rasterMode);
  state.source = ['text', 'svg', 'image'].includes(saved?.source) ? saved.source : 'text';
  activateSource(state.source, { generate: false, persist: false });
  updateThresholdOutput();
  updateProfileSummaryFromControls();
  updateCommissioningStatus();
}

function machinePlacementOptions() {
  const machineProfile = activeMachineProfile();
  return {
    paperOffsetX: numberValue('#paperOffsetX', machineProfile.geometry.paperOffsetX),
    paperOffsetY: numberValue('#paperOffsetY', machineProfile.geometry.paperOffsetY),
    workWidth: machineProfile.geometry.workWidth,
    workHeight: machineProfile.geometry.workHeight,
    servoMinZ: machineProfile.pen.servoMinZ,
    servoMaxZ: machineProfile.pen.servoMaxZ,
    machineFeedLimit: MACHINE_DEFAULTS.machineFeedLimit,
  };
}

function activeToolOptions() {
  const profile = getToolProfile(state.toolProfileId);
  return {
    ...profile,
    ...machinePlacementOptions(),
    drawFeed: numberValue('#drawFeed', profile.drawFeed),
    travelFeed: numberValue('#travelFeed', profile.travelFeed),
    jogFeed: numberValue('#jogFeed', profile.jogFeed),
    penUp: numberValue('#penUp', profile.penUp),
    penDown: numberValue('#penDown', profile.penDown),
    penDownDwell: numberValue('#penDownDwell', profile.penDownDwell),
    penUpDwell: numberValue('#penUpDwell', profile.penUpDwell),
    strokeRepeats: Math.round(numberValue('#strokeRepeats', profile.strokeRepeats)),
    returnHome: $('#returnHome').checked,
    toolId: profile.id,
    toolName: profile.name,
  };
}

function updateProfileSummaryFromControls() {
  const profile = activeToolOptions();
  setMessage('#profileDrawFeed', `${profile.drawFeed} мм/мин`);
  setMessage('#profileTravelFeed', `${profile.travelFeed} мм/мин`);
  setMessage('#profileDwell', `${formatDecimal(profile.penDownDwell, 2)} / ${formatDecimal(profile.penUpDwell, 2)} с`);
  setMessage('#previewToolBadge', `${profile.symbol} ${profile.shortName}`);
  $('#pagePreview')?.style.setProperty('--preview-stroke', String(profile.previewWidth));
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
  if (!svg) return;
  svg.setAttribute('viewBox', `0 0 ${page.width} ${page.height}`);
  $('#paperRect').setAttribute('width', page.width);
  $('#paperRect').setAttribute('height', page.height);
  const margins = selectedMargins();
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
  const analysis = state.analysis || analyzeJob(state.paths, activeToolOptions());
  const bounds = boundsOfPaths(state.paths);
  setMessage('#statPaths', String(analysis.pathCount));
  setMessage('#statPoints', String(analysis.pointCount));
  setMessage('#statDraw', `${analysis.drawLength.toFixed(0)} мм`);
  setMessage('#statTravel', `${analysis.travelLength.toFixed(0)} мм`);
  setMessage('#statLifts', String(analysis.penLifts));
  setMessage('#statLongest', `${analysis.longestStroke.toFixed(0)} мм`);
  setMessage('#statTime', formatDuration(analysis.seconds));
  setMessage('#statBounds', `${bounds.width.toFixed(1)} × ${bounds.height.toFixed(1)} мм`);
}

function updateValidation() {
  const element = $('#validationMessage');
  element.classList.remove('neutral', 'valid', 'invalid');
  const errors = [...(state.validation?.issues || []), ...(state.analysis?.errors || []).map((item) => item.message)];
  const valid = Boolean(state.validation?.valid && state.analysis?.valid);
  if (valid) {
    element.classList.add('valid');
    element.textContent = landscapeRequested()
      ? 'Макет повёрнут и находится в пределах портретно установленного листа.'
      : 'Макет находится в пределах листа и готов к проверке станка.';
  } else {
    element.classList.add('invalid');
    element.textContent = errors[0] || 'Макет содержит ошибку.';
  }
}

function updateAdvice() {
  const root = $('#jobAdvice');
  root.textContent = '';
  const items = [];
  for (const message of state.sourceWarnings) items.push({ level: 'warning', message });
  for (const error of state.analysis?.errors || []) items.push({ level: 'error', message: error.message });
  for (const warning of state.analysis?.warnings || []) items.push({ level: 'warning', message: warning.message });
  if (!items.length && state.paths.length) {
    const profile = getToolProfile(state.toolProfileId);
    items.push({ level: 'info', message: profile.note });
  }
  for (const item of items.slice(0, 4)) {
    const paragraph = document.createElement('p');
    paragraph.className = `advice-item ${item.level}`;
    paragraph.textContent = item.message;
    root.append(paragraph);
  }
  root.classList.toggle('visible', root.childElementCount > 0);
}

async function textPaths() {
  const logicalPage = landscapeRequested() ? PAGE_PRESETS.A4_LANDSCAPE : PAGE_PRESETS.A4_PORTRAIT;
  const margins = selectedMargins();
  const result = layoutText($('#textInput').value, currentFont(), {
    fontSize: numberValue('#fontSize', 6.3),
    widthScale: numberValue('#widthScale', 0.96),
    letterSpacing: numberValue('#letterSpacing', 0.25),
    wordSpacing: numberValue('#wordSpacing', 2.8),
    lineHeight: numberValue('#lineHeight', 1.42),
    lowercaseScale: numberValue('#lowercaseScale', 72) / 100,
    slant: numberValue('#slant', 3),
    jitter: numberValue('#textJitter', 0.08),
    heightJitter: numberValue('#heightJitter', 0.025),
    align: $('#textAlign').value,
    seed: numberValue('#seed', 17),
    originX: margins.marginLeft,
    originY: margins.marginTop,
    maxWidth: logicalPage.width - margins.marginLeft - margins.marginRight,
  });
  state.sourceWarnings = result.unsupported.length ? [`Не поддержаны знаки: ${result.unsupported.join(' ')}`] : [];
  return landscapeRequested() ? rotateLandscapeToPortrait(result.paths) : result.paths;
}

async function svgPaths() {
  if (!state.svgText) throw new Error('Сначала выберите SVG-файл.');
  const result = await svgTextToPaths(state.svgText, {
    sampleStep: numberValue('#svgSampleStep', 0.4),
    simplifyTolerance: numberValue('#svgTolerance', 0.08),
    maximumPoints: 60000,
  });
  state.sourceWarnings = [];
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
    rowSpacingMm: numberValue('#hatchSpacing', 1.35),
    angleDeg: numberValue('#hatchAngle', 0),
    sampleStepPx: numberValue('#contourStep', 2),
  };
  let paths;
  if (mode === 'contour') paths = rasterToContourPaths(state.imageData, common);
  else if (mode === 'comic') paths = rasterToComicPaths(state.imageData, common);
  else paths = rasterToHatchPaths(state.imageData, { ...common, crossHatch: mode === 'crosshatch' });
  state.sourceWarnings = [];
  return fitSourcePaths(paths);
}

function scheduleGenerate(delay = 170) {
  clearTimeout(state.generateTimer);
  state.generateTimer = setTimeout(() => generate(), delay);
}

function setGenerating(active) {
  state.generating = active;
  const button = $('#generateButton');
  button.disabled = active;
  button.textContent = active ? 'Пересчёт…' : 'Обновить макет';
}

function invalidateGeneratedChecks(resetPen = false) {
  state.uploadedJob = null;
  state.uploadedSignature = '';
  state.boundarySent = false;
  state.machine.boundaryPending = false;
  $('#confirmBoundary').checked = false;
  $('#confirmBoundary').disabled = true;
  if (resetPen) {
    state.machine.penTestSent = false;
    state.machine.penTestPending = false;
    $('#confirmPenTest').checked = false;
    $('#confirmPenTest').disabled = true;
  }
}

function invalidateToolChecks() {
  invalidateGeneratedChecks(true);
  updateReadiness();
}

async function generate() {
  if (state.generating) return;
  clearTimeout(state.generateTimer);
  stopSimulation();
  setGenerating(true);
  try {
    let paths;
    if (state.source === 'svg') paths = await svgPaths();
    else if (state.source === 'image') paths = imagePaths();
    else paths = await textPaths();
    paths = cleanPaths(paths);
    const profile = activeToolOptions();
    if ($('#optimizePaths').checked) paths = optimizePathOrder(paths, { x: 0, y: 0 }, profile.allowReverse).paths;
    const result = generateGcode(paths, physicalPage(), {
      ...profile,
      invertY: true,
      returnHome: profile.returnHome,
    });
    const nextSignature = `${result.gcode.length}-${hashString(result.gcode)}`;
    if (state.gcodeSignature && nextSignature !== state.gcodeSignature) invalidateGeneratedChecks(false);
    state.paths = paths;
    state.gcode = result.gcode;
    state.gcodeSignature = nextSignature;
    state.pathByteRanges = result.pathByteRanges;
    state.validation = result.validation;
    state.analysis = result.analysis;
    renderPaths();
    updateValidation();
    updateAdvice();
    saveSettings();
  } catch (error) {
    state.paths = [];
    state.gcode = '';
    state.gcodeSignature = '';
    state.validation = { valid: false, issues: [error instanceof Error ? error.message : String(error)] };
    state.analysis = analyzeJob([], activeToolOptions());
    renderPaths();
    updateValidation();
    updateAdvice();
    invalidateGeneratedChecks(false);
  } finally {
    setGenerating(false);
    updateReadiness();
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
  state.simulationDuration = Math.max(1800, Math.min(13000, total * 11));
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
  if ($('#jobProgressBar') && machineStateKind(state.client?.status) !== 'motion') $('#jobProgressBar').style.width = '0%';
}

function selectTab(buttons, panels, key, name) {
  for (const button of buttons) {
    const active = button.dataset[key] === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  }
  for (const panel of panels) {
    const active = panel.dataset[`${key}Content`] === name;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  }
}

function activatePanel(name, options = {}) {
  const buttons = $$('.panel-tab');
  selectTab(buttons, $$('[data-panel-content]'), 'panel', name);
  if (options.focus) buttons.find((button) => button.dataset.panel === name)?.focus();
  if (name === 'font') requestAnimationFrame(drawGlyphBoard);
  if (name === 'machine') updateReadiness();
}

function activateSource(name, options = {}) {
  state.source = name;
  const buttons = $$('.source-tab');
  selectTab(buttons, $$('[data-source-content]'), 'source', name);
  if (options.focus) buttons.find((button) => button.dataset.source === name)?.focus();
  if (options.persist !== false) saveSettings();
  if (options.generate !== false) scheduleGenerate(50);
}

function bindRovingTabs(selector, dataKey, activate) {
  const tabs = $$(selector);
  for (const tab of tabs) {
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const current = tabs.indexOf(tab);
      const next = event.key === 'Home' ? 0
        : event.key === 'End' ? tabs.length - 1
          : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      activate(tabs[next].dataset[dataKey], { focus: true });
    });
  }
}

async function loadSvgFile(file) {
  if (!file) return;
  state.svgText = await file.text();
  setMessage('#svgInfo', `${file.name}: ${(file.size / 1024).toFixed(1)} КБ.`);
  activateSource('svg', { generate: false });
  await generate();
}

async function loadImageFile(file) {
  if (!file) return;
  const bitmap = await createImageBitmap(file);
  const originalWidth = bitmap.width;
  const originalHeight = bitmap.height;
  const maxSide = 900;
  const scale = Math.min(1, maxSide / Math.max(originalWidth, originalHeight));
  const width = Math.max(1, Math.round(originalWidth * scale));
  const height = Math.max(1, Math.round(originalHeight * scale));
  const canvas = $('#imageCanvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.clearRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  state.imageData = context.getImageData(0, 0, width, height);
  bitmap.close();
  setMessage('#imageInfo', `${file.name}: ${originalWidth} × ${originalHeight}; обработка ${width} × ${height}.`);
  activateSource('image', { generate: false });
  await generate();
}

function glyphCanvasPoint(event) {
  const canvas = $('#glyphBoard');
  const rect = canvas.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
  };
}

function drawGlyphBoard() {
  const canvas = $('#glyphBoard');
  if (!canvas) return;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#d3d7d4';
  context.lineWidth = 1;
  for (let index = 1; index < 10; index += 1) {
    context.beginPath(); context.moveTo(index * canvas.width / 10, 0); context.lineTo(index * canvas.width / 10, canvas.height); context.stroke();
    context.beginPath(); context.moveTo(0, index * canvas.height / 10); context.lineTo(canvas.width, index * canvas.height / 10); context.stroke();
  }
  context.strokeStyle = '#126e72';
  context.lineWidth = 5;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const stroke of [...state.glyphStrokes, ...(state.activeGlyphStroke ? [state.activeGlyphStroke] : [])]) {
    if (stroke.length < 2) continue;
    context.beginPath();
    stroke.forEach((point, index) => {
      const x = point.x * canvas.width;
      const y = point.y * canvas.height;
      if (index) context.lineTo(x, y); else context.moveTo(x, y);
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
  saveFonts();
  setMessage('#fontMessage', `Шрифт «${font.meta.name}» установлен.`);
  activatePanel('layout');
  scheduleGenerate(30);
}

function exportCurrentFont() {
  const font = currentFont();
  const name = font.meta.name.replace(/[^0-9A-Za-zА-Яа-яЁё._-]+/g, '-');
  downloadBlob(`${name}.handdraw-font.json`, `${JSON.stringify(font, null, 2)}\n`, 'application/json;charset=utf-8');
}

async function importFont(file) {
  if (!file) return;
  try {
    const font = addFont(JSON.parse(await file.text()), true);
    saveFonts();
    setMessage('#fontMessage', `Импортирован шрифт «${font.meta.name}».`);
    scheduleGenerate(30);
  } catch (error) {
    setMessage('#fontMessage', error instanceof Error ? error.message : String(error));
  }
}

function isLikelyControllerOrigin() {
  if (typeof window === 'undefined') return false;
  if (!['http:', 'https:'].includes(window.location.protocol)) return false;
  return !['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname);
}

function setConnectionState(connected) {
  const kind = connected ? machineStateKind(state.client?.status) : 'unknown';
  $('#connectionDot').classList.toggle('connected', connected && kind !== 'motion');
  $('#connectionDot').classList.toggle('busy', connected && kind === 'motion');
  $('#connectionDot').classList.toggle('alarm', connected && kind === 'alarm');
  setMessage('#connectionLabel', connected ? (kind === 'motion' ? 'Станок выполняет задание' : 'FluidNC подключён') : 'Локальная подготовка');
  setMessage('#machineConnectionTitle', connected ? 'FluidNC подключён' : 'FluidNC не подключён');
  setMessage('#machineConnectionHint', connected ? state.client.baseUrl : 'При открытии страницы с ESP32 подключение выполняется автоматически.');
}

function updateMachineStatus(status) {
  const previous = state.machine.previousState;
  const previousBase = String(previous).split(':')[0].toLowerCase();
  const currentBase = String(status.state).split(':')[0].toLowerCase();
  if (state.machine.homingPending && ['idle'].includes(currentBase) && ['home', 'homing'].includes(previousBase)) {
    state.machine.homed = true;
    state.machine.homingPending = false;
    logMachine('Homing завершён; координаты станка установлены.');
  }
  if (state.machine.boundaryPending && status.job?.complete && /handdraw-boundary\.gcode$/i.test(status.job.file || '')) {
    state.machine.boundaryPending = false;
    state.boundarySent = true;
    $('#confirmBoundary').disabled = false;
    logMachine('Обводка рамки завершена. Подтвердите отсутствие столкновений.');
  }
  if (machineStateKind(status) === 'alarm') {
    state.machine.homed = false;
    state.machine.homingPending = false;
    state.machine.penTestPending = false;
    state.machine.boundaryPending = false;
    $('#confirmPenTest').disabled = true;
    $('#confirmBoundary').disabled = true;
  }
  state.machine.previousState = status.state;
  setMessage('#machineState', status.state);
  const position = status.mpos || status.wpos || { x: 0, y: 0, z: 0 };
  setMessage('#machineX', position.x.toFixed(3).replace('.', ','));
  setMessage('#machineY', position.y.toFixed(3).replace('.', ','));
  setMessage('#machineZ', position.z.toFixed(3).replace('.', ','));
  setMessage('#machineCoordinates', `${formatDecimal(position.x, 1)} · ${formatDecimal(position.y, 1)} · ${formatDecimal(position.z, 1)}`);
  setMessage('#machineFeed', String(status.feed ?? 0));
  const percent = status.job?.percent ?? 0;
  setMessage('#machineProgress', `${Number(percent).toFixed(1)}%`);
  $('#jobProgressBar').style.width = `${clamp(Number(percent), 0, 100)}%`;
  if (status.job?.complete && !state.machine.reportedComplete) {
    state.machine.reportedComplete = true;
    logMachine('Задание завершено.');
  }
  if (machineStateKind(status) === 'motion') state.machine.reportedComplete = false;
  setConnectionState(Boolean(state.client?.connected));
  updateReadiness();
}

function ensureClient() {
  const address = $('#controllerAddress').value.trim();
  const target = address || (typeof window !== 'undefined' ? window.location.origin : '');
  if (!state.client || (target && state.client.baseUrl !== target && !state.client.baseUrl.endsWith(address))) {
    state.client?.disconnect();
    state.client = new FluidNCClient(address, { autoReconnect: true });
    state.client.addEventListener('connection', (event) => {
      const connected = Boolean(event.detail?.connected);
      if (!connected) {
        state.machine.homed = false;
        state.machine.homingPending = false;
        state.machine.penTestPending = false;
        state.machine.boundaryPending = false;
      }
      setConnectionState(connected);
      logMachine(connected ? `Соединение установлено: ${state.client.baseUrl}` : 'Соединение закрыто.');
      updateReadiness();
    });
    state.client.addEventListener('status', (event) => updateMachineStatus(event.detail));
    state.client.addEventListener('message', (event) => {
      const message = String(event.detail || '');
      logMachine(message);
      if (/\bHomed:/i.test(message)) {
        state.machine.homed = true;
        state.machine.homingPending = false;
        updateReadiness();
      }
      if (/ALARM|ERR|error/i.test(message)) updateReadiness();
    });
    state.client.addEventListener('error', (event) => logMachine(`Ошибка: ${event.detail?.message || 'соединение'}`));
  }
  return state.client;
}

function readinessState() {
  const connected = Boolean(state.client?.connected);
  const idle = connected && machineStateKind(state.client.status) === 'idle';
  const layout = Boolean(state.validation?.valid && state.analysis?.valid && state.gcode);
  const pen = Boolean($('#confirmPenTest').checked);
  const paper = Boolean($('#confirmPaper').checked);
  const boundary = Boolean($('#confirmBoundary').checked);
  const uploaded = Boolean(state.uploadedJob && state.uploadedSignature === state.gcodeSignature);
  return { layout, connected, idle, homed: state.machine.homed, pen, paper, boundary, uploaded };
}

function markReady(id, done, blocked = false) {
  const element = $(`#${id}`);
  if (!element) return;
  element.classList.toggle('done', Boolean(done));
  element.classList.toggle('blocked', Boolean(blocked && !done));
}

function updateReadiness() {
  const ready = readinessState();
  markReady('readyLayout', ready.layout, true);
  markReady('readyConnected', ready.connected, true);
  markReady('readyHomed', ready.homed, ready.connected);
  markReady('readyPen', ready.pen, ready.homed);
  markReady('readyPaper', ready.paper, ready.connected);
  markReady('readyBoundary', ready.boundary, ready.homed && ready.paper);
  markReady('readyUploaded', ready.uploaded, ready.boundary && ready.pen);

  const statusKind = machineStateKind(state.client?.status);
  $('#downloadGcodeButton').disabled = !ready.layout;
  $('#homeButton').disabled = !ready.connected || statusKind === 'motion';
  $('#controllerDiagnosticsButton').disabled = !ready.idle;
  $('#limitMonitorButton').disabled = !ready.idle;
  $('#penTestButton').disabled = !ready.idle || !ready.homed;
  $('#dryRunButton').disabled = !ready.idle || !ready.homed || !ready.paper || !ready.layout;
  $('#uploadButton').disabled = !ready.idle || !ready.homed || !ready.pen || !ready.paper || !ready.boundary || !ready.layout;
  $('#startButton').disabled = !(ready.layout && ready.connected && ready.idle && ready.homed && ready.pen && ready.paper && ready.boundary && ready.uploaded);
  $('#pauseButton').disabled = statusKind !== 'motion';
  $('#resumeButton').disabled = statusKind !== 'paused';
  $('#stopButton').disabled = !['motion', 'paused'].includes(statusKind);

  const pending = [];
  if (!ready.layout) pending.push('исправьте макет');
  if (!ready.connected) pending.push('подключите FluidNC');
  else if (!ready.idle) pending.push('дождитесь состояния Idle');
  if (!ready.homed) pending.push('выполните homing');
  if (!ready.pen) pending.push('подтвердите тест пера');
  if (!ready.paper) pending.push('проверьте лист');
  if (!ready.boundary) pending.push('проверьте рамку');
  if (!ready.uploaded) pending.push('передайте задание');
  setMessage('#startHint', pending.length ? `Осталось: ${pending.slice(0, 3).join(', ')}${pending.length > 3 ? '…' : '.'}` : 'Все проверки выполнены. Можно открыть подтверждение запуска.');
}

async function connectMachine() {
  const client = ensureClient();
  client.autoReconnect = true;
  client.connect();
}

async function uploadJob() {
  if (!state.gcode) await generate();
  const ready = readinessState();
  if (!ready.layout) throw new Error('Макет не готов.');
  const client = ensureClient();
  const result = await client.uploadJob(state.gcode, $('#jobName').value, 'sd');
  state.uploadedJob = result;
  state.uploadedSignature = state.gcodeSignature;
  logMachine(`Задание записано и побайтово проверено: ${result.path} (${result.bytes} байт).`);
  updateReadiness();
}

async function runBoundaryCheck() {
  const ready = readinessState();
  if (!ready.layout || !ready.homed || !ready.paper) throw new Error('Сначала подготовьте макет, выполните homing и закрепите лист.');
  const profile = activeToolOptions();
  const boundary = generateBoundaryGcode(boundsOfPaths(state.paths), physicalPage(), {
    penUp: profile.penUp,
    travelFeed: Math.min(profile.travelFeed, 2400),
    padding: 2,
    invertY: true,
  });
  const client = ensureClient();
  const result = await client.uploadJob(boundary.gcode, 'handdraw-boundary.gcode', 'sd');
  await client.startJob(result.path, result.storage);
  state.machine.boundaryPending = true;
  state.boundarySent = false;
  $('#confirmBoundary').disabled = true;
  $('#confirmBoundary').checked = false;
  logMachine(`Запущена проверка рамки ${boundary.bounds.width.toFixed(1)} × ${boundary.bounds.height.toFixed(1)} мм с поднятым пером.`);
  updateReadiness();
}

async function runPenTest() {
  const profile = activeToolOptions();
  state.machine.penTestPending = true;
  state.machine.penTestSent = false;
  state.machine.previousState = state.client?.status?.state || 'Idle';
  $('#confirmPenTest').disabled = true;
  $('#confirmPenTest').checked = false;
  logMachine(`Выполняется тест пера для профиля «${profile.name}».`);
  updateReadiness();
  try {
    await ensureClient().testPen({
      penUp: profile.penUp,
      penDown: profile.penDown,
      penDownDwell: Math.max(profile.penDownDwell, 0.35),
      penUpDwell: Math.max(profile.penUpDwell, 0.35),
      feed: 180,
    });
    state.machine.penTestPending = false;
    state.machine.penTestSent = true;
    $('#confirmPenTest').disabled = false;
    logMachine('Тест пера подтверждён контроллером. Проверьте механику и отметьте результат.');
  } catch (error) {
    state.machine.penTestPending = false;
    state.machine.penTestSent = false;
    $('#confirmPenTest').disabled = true;
    throw error;
  } finally {
    updateReadiness();
  }
}

function showStartDialog() {
  const ready = readinessState();
  if (!Object.values(ready).every(Boolean)) return updateReadiness();
  const profile = activeToolOptions();
  const summary = $('#startDialogSummary');
  summary.textContent = '';
  const lines = [
    `Инструмент: ${profile.name}.`,
    `Время: около ${formatDuration(state.analysis.seconds)}; штрихов: ${state.analysis.pathCount}.`,
    `Файл: ${state.uploadedJob.path}.`,
    `Лист: X${formatDecimal(machinePlacementOptions().paperOffsetX, 1)} / Y${formatDecimal(machinePlacementOptions().paperOffsetY, 1)} мм от машинного нуля.`,
  ];
  for (const message of lines) {
    const paragraph = document.createElement('p');
    paragraph.textContent = message;
    summary.append(paragraph);
  }
  $('#confirmSupervision').checked = false;
  $('#confirmStartButton').disabled = true;
  const dialog = $('#startDialog');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeStartDialog() {
  const dialog = $('#startDialog');
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

async function confirmStart() {
  const ready = readinessState();
  if (!Object.values(ready).every(Boolean) || !$('#confirmSupervision').checked) return;
  $('#confirmStartButton').disabled = true;
  try {
    await ensureClient().startJob(state.uploadedJob.path, state.uploadedJob.storage);
    logMachine(`Запущено: ${state.uploadedJob.path}.`);
    closeStartDialog();
  } catch (error) {
    logMachine(error.message);
    $('#confirmStartButton').disabled = !$('#confirmSupervision').checked;
  }
}

function updateThresholdOutput() {
  setMessage('#thresholdValue', `${Math.round(numberValue('#imageThreshold', 0.5) * 100)}%`);
}

function bindEvents() {
  $$('.panel-tab').forEach((button) => button.addEventListener('click', () => activatePanel(button.dataset.panel)));
  bindRovingTabs('.panel-tab', 'panel', activatePanel);
  $$('[data-go-panel]').forEach((button) => button.addEventListener('click', () => activatePanel(button.dataset.goPanel)));
  $$('.source-tab').forEach((button) => button.addEventListener('click', () => activateSource(button.dataset.source)));
  bindRovingTabs('.source-tab', 'source', activateSource);
  $('#textPresetList').addEventListener('click', (event) => {
    const button = event.target.closest('[data-text-preset]');
    if (button) applyTextPreset(button.dataset.textPreset);
  });
  $('#toolProfileList').addEventListener('change', (event) => {
    if (event.target.name === 'toolProfile') applyToolProfile(event.target.value, { textPreset: true });
  });

  $('#generateButton').addEventListener('click', generate);
  $('#downloadGcodeButton').addEventListener('click', async () => {
    if (!state.gcode) await generate();
    if (!state.validation?.valid || !state.analysis?.valid) return updateValidation();
    downloadBlob($('#jobName').value || 'handdraw-job.gcode', state.gcode, 'text/plain;charset=utf-8');
  });
  $('#simulateButton').addEventListener('click', startSimulation);
  $('#resetSimulationButton').addEventListener('click', stopSimulation);
  $('#showTravel').addEventListener('change', () => { renderPaths(); saveSettings(); });
  $('#svgFile').addEventListener('change', (event) => loadSvgFile(event.target.files?.[0]).catch((error) => setMessage('#svgInfo', error.message)));
  $('#imageFile').addEventListener('change', (event) => loadImageFile(event.target.files?.[0]).catch((error) => setMessage('#imageInfo', error.message)));
  $('#fontSelect').addEventListener('change', (event) => { state.currentFontName = event.target.value; scheduleGenerate(40); });
  $('#imageThreshold').addEventListener('input', updateThresholdOutput);
  $$('input[name="rasterMode"]').forEach((input) => input.addEventListener('change', () => { saveSettings(); scheduleGenerate(); }));
  $$('[data-regenerate]').forEach((element) => {
    const eventName = element.matches('select,input[type="checkbox"]') ? 'change' : 'input';
    element.addEventListener(eventName, () => {
      if (['drawFeed', 'travelFeed', 'penDownDwell', 'penUpDwell'].includes(element.id)) updateProfileSummaryFromControls();
      saveSettings();
      scheduleGenerate();
    });
  });
  $('#jobName').addEventListener('change', saveSettings);
  $('#controllerAddress').addEventListener('change', () => {
    saveSettings();
    if (state.client) {
      state.client.disconnect();
      state.client = null;
      updateReadiness();
    }
  });
  $('#jogDistance').addEventListener('change', saveSettings);
  $('#jogFeed').addEventListener('change', saveSettings);

  $('#machineProfileSelect').addEventListener('change', (event) => applyMachineProfile(event.target.value));
  $('#saveMachineProfileButton').addEventListener('click', () => {
    try { saveCurrentMachineProfile(); } catch (error) { logMachine(error.message); }
  });
  $('#deleteMachineProfileButton').addEventListener('click', removeCurrentMachineProfile);
  $('#exportMachineProfileButton').addEventListener('click', () => {
    try { exportCurrentMachineProfile(); } catch (error) { logMachine(error.message); }
  });
  $('#importMachineProfileInput').addEventListener('change', (event) => {
    importMachineProfile(event.target.files?.[0]).catch((error) => logMachine(`Импорт профиля: ${error.message}`));
    event.target.value = '';
  });
  for (const id of ['commissionDirectionX', 'commissionDirectionY', 'commissionLimitX', 'commissionLimitY', 'commissionHomingRepeated']) {
    $(`#${id}`).addEventListener('change', updateCommissioningStatus);
  }
  $('#controllerDiagnosticsButton').addEventListener('click', () => runControllerDiagnostics().catch((error) => logMachine(`Диагностика: ${error.message}`)));
  $('#limitMonitorButton').addEventListener('click', () => runLimitMonitor().catch((error) => logMachine(`Концевики: ${error.message}`)));
  $('#calculateCalibrationButton').addEventListener('click', () => {
    try { calculateMachineCalibration(); } catch (error) { logMachine(`Калибровка: ${error.message}`); }
  });
  $('#exportCalibrationButton').addEventListener('click', () => {
    try { exportCalibrationFragment(); } catch (error) { logMachine(`Калибровка: ${error.message}`); }
  });

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

  $('#connectButton').addEventListener('click', () => connectMachine().catch((error) => logMachine(error.message)));
  $('#disconnectButton').addEventListener('click', () => state.client?.disconnect());
  $('#homeButton').addEventListener('click', async () => {
    try {
      state.machine.homed = false;
      state.machine.homingPending = true;
      state.machine.previousState = state.client?.status?.state || 'Unknown';
      logMachine('Homing запущен.');
      updateReadiness();
      await ensureClient().home();
      state.machine.homed = true;
      state.machine.homingPending = false;
      logMachine('Homing подтверждён контроллером.');
      updateReadiness();
    } catch (error) {
      state.machine.homed = false;
      state.machine.homingPending = false;
      logMachine(error.message);
      updateReadiness();
    }
  });
  $('#penTestButton').addEventListener('click', () => runPenTest().catch((error) => logMachine(error.message)));
  $('#dryRunButton').addEventListener('click', () => runBoundaryCheck().catch((error) => logMachine(error.message)));
  $('#uploadButton').addEventListener('click', () => uploadJob().catch((error) => logMachine(error.message)));
  $('#startButton').addEventListener('click', showStartDialog);
  $('#pauseButton').addEventListener('click', () => state.client?.pause());
  $('#resumeButton').addEventListener('click', () => state.client?.resume());
  $('#stopButton').addEventListener('click', () => {
    state.machine.penTestPending = false;
    state.machine.boundaryPending = false;
    $('#confirmPenTest').disabled = true;
    $('#confirmBoundary').disabled = true;
    state.client?.stop();
  });
  $('#unlockButton').addEventListener('click', async () => {
    try { await ensureClient().unlock(); } catch (error) { logMachine(error.message); }
  });
  $('#penUpButton').addEventListener('click', async () => {
    try {
      const profile = activeToolOptions();
      await ensureClient().setPen(true, { ...profile, feed: 180, dwell: profile.penUpDwell });
    } catch (error) { logMachine(error.message); }
  });
  $('#penDownButton').addEventListener('click', async () => {
    try {
      const profile = activeToolOptions();
      await ensureClient().setPen(false, { ...profile, feed: 180, dwell: profile.penDownDwell });
    } catch (error) { logMachine(error.message); }
  });
  $$('[data-jog-axis]').forEach((button) => button.addEventListener('click', async () => {
    try {
      const distance = numberValue('#jogDistance', 5) * Number(button.dataset.jogSign || 1);
      await ensureClient().jog(button.dataset.jogAxis, distance, numberValue('#jogFeed', activeToolOptions().jogFeed));
    } catch (error) { logMachine(error.message); }
  }));

  for (const id of ['confirmPenTest', 'confirmPaper', 'confirmBoundary']) {
    $(`#${id}`).addEventListener('change', updateReadiness);
  }
  $('#confirmSupervision').addEventListener('change', () => { $('#confirmStartButton').disabled = !$('#confirmSupervision').checked; });
  $('#cancelStartButton').addEventListener('click', closeStartDialog);
  $('#confirmStartButton').addEventListener('click', confirmStart);

  window.addEventListener('beforeunload', (event) => {
    if (['motion', 'paused'].includes(machineStateKind(state.client?.status))) {
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
    const technical = addFont(font, false);
    state.builtInFontNames.add(technical.meta.name);
    state.handwritingFont = createHandwritingFont(font);
    const handwriting = addFont(state.handwritingFont, true);
    state.builtInFontNames.add(handwriting.meta.name);
    const savedFonts = readJsonStorage(FONT_STORAGE_KEY, []);
    if (Array.isArray(savedFonts)) {
      for (const saved of savedFonts) {
        try { addFont(saved); } catch { /* ignore invalid old user font */ }
      }
    }
    loadMachineProfiles();
    populateTextPresets();
    populateToolProfiles();
    bindEvents();
    restoreSettings();
    drawGlyphBoard();
    await generate();
    updateReadiness();
    if (isLikelyControllerOrigin()) {
      setTimeout(() => connectMachine().catch((error) => logMachine(`Автоподключение: ${error.message}`)), 250);
    }
  } catch (error) {
    state.validation = { valid: false, issues: [error instanceof Error ? error.message : String(error)] };
    state.analysis = analyzeJob([], activeToolOptions());
    updateValidation();
    updateAdvice();
  }
}

init();
