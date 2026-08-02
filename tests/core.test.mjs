import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PAGE_PRESETS,
  TEXT_PRESETS,
  calculateCalibratedStepsPerMm,
  createDefaultMachineProfile,
  TOOL_PROFILES,
  analyzeJob,
  boundsOfPaths,
  calculateTravelLength,
  cleanPaths,
  fitPathsToPage,
  generateBoundaryGcode,
  generateGcode,
  getToolProfile,
  layoutText,
  optimizePathOrder,
  rasterToComicPaths,
  rasterToContourPaths,
  rasterToHatchPaths,
  validateFont,
  validateMachineProfile,
  validatePathsWithinPage,
} from '../web/src/core.js';
import { FluidNCClient, machineStateKind, parseControllerBuildInfo, parseFluidNCStatus, safeJobFileName } from '../web/src/fluidnc.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const font = validateFont(JSON.parse(fs.readFileSync(path.join(here, '../web/src/fonts/technical-cyrillic.json'), 'utf8')));

function sampleImage(width = 24, height = 18) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside = x >= 5 && x <= 18 && y >= 4 && y <= 13;
      const value = inside ? Math.max(0, 30 + (x - 5) * 7) : 255;
      const index = (y * width + x) * 4;
      data[index] = data[index + 1] = data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  return { data, width, height };
}

test('bundled font contains Cyrillic, Latin and engineering symbols', () => {
  for (const symbol of ['А', 'Я', 'A', 'Z', '0', '9', '№', '°', '+', '-']) {
    assert.ok(font.glyphs[symbol], `missing glyph ${symbol}`);
    assert.ok(font.glyphs[symbol][0].strokes.length > 0, `empty glyph ${symbol}`);
  }
  assert.equal(font.meta.author.length > 0, true);
});

test('human handwriting preset produces finite repeatable one-line paths', () => {
  const preset = TEXT_PRESETS.handwriting;
  const options = {
    ...preset,
    fontSize: preset.fontSize,
    lowercaseScale: preset.lowercaseScale,
    originX: 10,
    originY: 10,
    maxWidth: 190,
    seed: 17,
  };
  const first = layoutText('Метеостанция № 12\nТемпература +18 °C', font, options);
  const second = layoutText('Метеостанция № 12\nТемпература +18 °C', font, options);
  assert.ok(first.paths.length > 25);
  assert.deepEqual(first.unsupported, []);
  assert.deepEqual(first.paths, second.paths);
  const box = boundsOfPaths(first.paths);
  assert.ok(box.width > 50 && box.height > 8);
  assert.ok(first.paths.flat().every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
});

test('lowercase fallback renders as configurable small caps', () => {
  const uppercase = layoutText('АБВ', font, { fontSize: 10, lowercaseScale: 0.7 });
  const lowercase = layoutText('абв', font, { fontSize: 10, lowercaseScale: 0.7 });
  const upperBox = boundsOfPaths(uppercase.paths);
  const lowerBox = boundsOfPaths(lowercase.paths);
  assert.ok(lowerBox.height < upperBox.height * 0.8);
  assert.ok(lowerBox.width < upperBox.width);
});

test('tool profiles expose conservative motion and media defaults', () => {
  assert.ok(Object.keys(TOOL_PROFILES).length >= 6);
  const ink = getToolProfile('ink');
  const fineliner = getToolProfile('fineliner');
  assert.equal(ink.allowReverse, false);
  assert.ok(ink.drawFeed < fineliner.drawFeed);
  assert.ok(ink.penDownDwell > fineliner.penDownDwell);
  assert.ok(ink.maxContinuousStroke < fineliner.maxContinuousStroke);
  assert.equal(getToolProfile('missing').id, 'fineliner');
});

test('fit and validation keep imported geometry inside A4 margins', () => {
  const source = [[{ x: -20, y: 5 }, { x: 980, y: 5 }, { x: 980, y: 620 }, { x: -20, y: 620 }, { x: -20, y: 5 }]];
  const page = PAGE_PRESETS.A4_PORTRAIT;
  const fitted = fitPathsToPage(source, page, { marginLeft: 10, marginRight: 10, marginTop: 12, marginBottom: 12 });
  const validation = validatePathsWithinPage(fitted, page);
  assert.equal(validation.valid, true, validation.issues.join('; '));
  const box = boundsOfPaths(fitted);
  assert.ok(box.minX >= 9.99 && box.minY >= 11.99);
  assert.ok(box.maxX <= 200.01 && box.maxY <= 285.01);
});

test('path optimizer reduces or preserves travel length and respects direction lock', () => {
  const paths = [[{ x: 100, y: 100 }, { x: 110, y: 100 }], [{ x: 10, y: 10 }, { x: 20, y: 10 }], [{ x: 60, y: 30 }, { x: 50, y: 30 }]];
  const before = calculateTravelLength(paths, { x: 0, y: 0 });
  const optimized = optimizePathOrder(paths, { x: 0, y: 0 }, true);
  const directed = optimizePathOrder(paths, { x: 0, y: 0 }, false);
  assert.equal(optimized.paths.length, 3);
  assert.ok(calculateTravelLength(optimized.paths, { x: 0, y: 0 }) <= before);
  assert.deepEqual(directed.paths.find((item) => item.some((point) => point.x === 60)), paths[2]);
});

test('raster conversion creates angled hatch, crosshatch, contours and comics', () => {
  const imageData = sampleImage();
  const common = { widthMm: 120, heightMm: 90, threshold: 0.5, rowSpacingMm: 3 };
  const hatch = rasterToHatchPaths(imageData, { ...common, angleDeg: 35 });
  const cross = rasterToHatchPaths(imageData, { ...common, angleDeg: 35, crossHatch: true });
  const contour = rasterToContourPaths(imageData, { ...common, sampleStepPx: 1 });
  const comic = rasterToComicPaths(imageData, { ...common, angleDeg: 35, sampleStepPx: 1 });
  assert.ok(hatch.length >= 3);
  assert.ok(cross.length > hatch.length);
  assert.ok(contour.length >= 1);
  assert.ok(comic.length > contour.length);
  assert.ok(cleanPaths(comic).every((item) => item.length >= 2));
});

test('generated G-code applies separate pen dwell, repeat passes and byte progress', () => {
  const paths = [[{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }], [{ x: 60, y: 40 }, { x: 80, y: 45 }]];
  const result = generateGcode(paths, PAGE_PRESETS.A4_PORTRAIT, {
    drawFeed: 900,
    travelFeed: 3000,
    penUp: 5,
    penDown: 0,
    penDownDwell: 0.18,
    penUpDwell: 0.08,
    strokeRepeats: 2,
    invertY: true,
    toolId: 'pencil',
    toolName: 'Карандаш',
  });
  assert.match(result.gcode, /; Tool: Карандаш/);
  assert.match(result.gcode, /G21/);
  assert.match(result.gcode, /G94/);
  assert.match(result.gcode, /G0 Z5/);
  assert.match(result.gcode, /G0 Z0/);
  assert.match(result.gcode, /G4 P0\.18/);
  assert.match(result.gcode, /G4 P0\.08/);
  assert.match(result.gcode, /; Paper offset: X7\.5 Y9/);
  assert.match(result.gcode, /G1 X17\.5 Y296 F3000/);
  assert.match(result.gcode, /G1 X37\.5 Y276 F900/);
  assert.ok((result.gcode.match(/G1 X17\.5 Y296 F900/g) || []).length >= 1, 'repeat pass should return to the first point');
  assert.doesNotMatch(result.gcode, /G0 X|G0 Y/);
  assert.equal(result.pathByteRanges.length, 2);
  assert.ok(result.pathByteRanges[0].endFraction < result.pathByteRanges[1].endFraction);
  assert.equal(result.validation.valid, true);
  assert.equal(result.analysis.strokeRepeats, 2);
});

test('directional repeated strokes lift and restart instead of reversing the nib', () => {
  const path = [[{ x: 10, y: 10 }, { x: 40, y: 10 }]];
  const result = generateGcode(path, PAGE_PRESETS.A4_PORTRAIT, {
    ...TOOL_PROFILES.ink,
    strokeRepeats: 2,
    invertY: true,
  });
  assert.equal(result.analysis.allowReverse, false);
  assert.equal(result.analysis.penLifts, 2);
  assert.ok((result.gcode.match(/G1 X17\.5 Y296 F2100/g) || []).length >= 2);
  assert.equal((result.gcode.match(/G1 X47\.5 Y296 F520/g) || []).length, 2);
  assert.doesNotMatch(result.gcode, /G1 X17\.5 Y296 F520/);
  assert.ok(result.analysis.warnings.some((item) => item.code === 'directional-repeat'));
});

test('job filenames are transliterated and limited to portable ASCII', () => {
  assert.equal(safeJobFileName('Комикс № 1'), 'Komiks-No-1.gcode');
  assert.equal(safeJobFileName('../../опасное имя.gcode'), 'opasnoe-imya.gcode');
  assert.equal(safeJobFileName(''), 'handdraw-job.gcode');
});

test('job analysis reports unsafe pen range and long ink strokes', () => {
  const paths = [[{ x: 0, y: 0 }, { x: 180, y: 0 }]];
  const analysis = analyzeJob(paths, { ...TOOL_PROFILES.ink, penUp: 0, penDown: 1 });
  assert.equal(analysis.valid, false);
  assert.ok(analysis.errors.some((item) => item.code === 'pen-range'));
  assert.ok(analysis.warnings.some((item) => item.code === 'continuous-stroke'));
  const fast = analyzeJob(paths, { ...TOOL_PROFILES.fineliner, travelFeed: 5000 });
  assert.ok(fast.errors.some((item) => item.code === 'feed-limit'));
  const outsideServo = analyzeJob(paths, { ...TOOL_PROFILES.fineliner, penUp: 6, penDown: 0 });
  assert.ok(outsideServo.errors.some((item) => item.code === 'pen-range-limit'));
  const invalidPoint = generateGcode([[{ x: 1, y: 1 }, { x: Number.NaN, y: 2 }]]);
  assert.equal(invalidPoint.validation.valid, false);
  assert.ok(invalidPoint.analysis.errors.some((item) => item.code === 'invalid-coordinate'));
});

test('boundary program never lowers the pen', () => {
  const result = generateBoundaryGcode({ minX: 10, minY: 20, maxX: 80, maxY: 100, width: 70, height: 80 }, PAGE_PRESETS.A4_PORTRAIT, { penUp: 5, travelFeed: 2000 });
  assert.match(result.gcode, /boundary check/);
  assert.match(result.gcode, /G0 Z5/);
  assert.doesNotMatch(result.gcode, /Z0(?:\D|$)/);
  assert.ok(result.bounds.minX >= 0 && result.bounds.maxY <= 297);
});


test('machine profile keeps commissioned geometry and calculates corrected steps', () => {
  const profile = createDefaultMachineProfile('Эталонный станок');
  profile.geometry.paperOffsetX = 8.1;
  profile.geometry.stepsPerMmX = calculateCalibratedStepsPerMm(80, 100, 99.4);
  profile.commissioning.directionX = true;
  const normalized = validateMachineProfile(profile);
  assert.equal(normalized.name, 'Эталонный станок');
  assert.equal(normalized.geometry.paperOffsetX, 8.1);
  assert.ok(Math.abs(normalized.geometry.stepsPerMmX - 80.4829) < 0.0001);
  assert.equal(normalized.commissioning.directionX, true);
});

test('controller build parser extracts pinned FluidNC version', () => {
  const info = parseControllerBuildInfo(['[VER:3.4 FluidNC v4.0.3 (wifi):]', '[OPT:V,15,128]']);
  assert.equal(info.version, '4.0.3');
  assert.match(info.summary, /FluidNC/);
});

test('FluidNC status parser extracts position, state kind and SD progress', () => {
  const status = parseFluidNCStatus('<Run|MPos:12.500,44.000,0.000|FS:1200,0|SD:37.25,/jobs/demo.gcode>');
  assert.equal(status.state, 'Run');
  assert.deepEqual(status.mpos, { x: 12.5, y: 44, z: 0 });
  assert.equal(status.feed, 1200);
  assert.equal(status.job.percent, 37.25);
  assert.equal(machineStateKind(status), 'motion');
  assert.equal(machineStateKind(parseFluidNCStatus('<Idle|MPos:0,0,5>')), 'idle');
  const complete = parseFluidNCStatus('<Idle|MPos:0,0,5|SD:/jobs/demo.gcode: Sent>');
  assert.equal(complete.job.percent, 100);
  assert.equal(complete.job.complete, true);
});

test('FluidNC job commands address SD and local roots correctly', () => {
  const client = Object.create(FluidNCClient.prototype);
  const commands = [];
  client.ensureIdle = () => {};
  client.sendCommand = (command) => commands.push(command);
  client.fileName = 'handdraw-job.gcode';
  client.startJob('/jobs/demo.gcode', 'sd');
  client.startJob('/sd/jobs/legacy.gcode', 'sd');
  client.startJob('/short.gcode', 'local');
  assert.deepEqual(commands, ['$SD/Run=/jobs/demo.gcode', '$SD/Run=/jobs/legacy.gcode', '$LocalFS/Run=/short.gcode']);
});
