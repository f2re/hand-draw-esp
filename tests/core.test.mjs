import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PAGE_PRESETS, boundsOfPaths, calculateTravelLength, cleanPaths, fitPathsToPage, generateGcode, layoutText, optimizePathOrder, rasterToContourPaths, rasterToHatchPaths, validateFont, validatePathsWithinPage } from '../web/src/core.js';
import { FluidNCClient, parseFluidNCStatus } from '../web/src/fluidnc.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const font = validateFont(JSON.parse(fs.readFileSync(path.join(here, '../web/src/fonts/technical-cyrillic.json'), 'utf8')));

test('bundled font contains Cyrillic, Latin and engineering symbols', () => {
  for (const symbol of ['А', 'Я', 'A', 'Z', '0', '9', '№', '°', '+', '-']) {
    assert.ok(font.glyphs[symbol], `missing glyph ${symbol}`);
    assert.ok(font.glyphs[symbol][0].strokes.length > 0, `empty glyph ${symbol}`);
  }
  assert.equal(font.meta.author.length > 0, true);
});

test('Russian technical text produces finite one-line paths', () => {
  const result = layoutText('МЕТЕОСТАНЦИЯ № 12\nТЕМПЕРАТУРА +18 °C', font, { fontSize: 7, letterSpacing: 0.8, wordSpacing: 3, lineHeight: 1.4, originX: 10, originY: 10, maxWidth: 190, seed: 17 });
  assert.ok(result.paths.length > 25);
  assert.deepEqual(result.unsupported, []);
  const box = boundsOfPaths(result.paths);
  assert.ok(box.width > 50 && box.height > 8);
  assert.ok(result.paths.flat().every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
});

test('lowercase fallback renders as configurable small caps', () => {
  const uppercase = layoutText('АБВ', font, { fontSize: 10, lowercaseScale: 0.7 });
  const lowercase = layoutText('абв', font, { fontSize: 10, lowercaseScale: 0.7 });
  const upperBox = boundsOfPaths(uppercase.paths); const lowerBox = boundsOfPaths(lowercase.paths);
  assert.ok(lowerBox.height < upperBox.height * 0.8); assert.ok(lowerBox.width < upperBox.width);
});

test('fit and validation keep imported geometry inside A4 margins', () => {
  const source = [[{ x: -20, y: 5 }, { x: 980, y: 5 }, { x: 980, y: 620 }, { x: -20, y: 620 }, { x: -20, y: 5 }]];
  const page = PAGE_PRESETS.A4_PORTRAIT;
  const fitted = fitPathsToPage(source, page, { marginLeft: 10, marginRight: 10, marginTop: 12, marginBottom: 12 });
  const validation = validatePathsWithinPage(fitted, page);
  assert.equal(validation.valid, true, validation.issues.join('; '));
  const box = boundsOfPaths(fitted);
  assert.ok(box.minX >= 9.99 && box.minY >= 11.99); assert.ok(box.maxX <= 200.01 && box.maxY <= 285.01);
});

test('path optimizer reduces or preserves travel length', () => {
  const paths = [[{ x: 100, y: 100 }, { x: 110, y: 100 }], [{ x: 10, y: 10 }, { x: 20, y: 10 }], [{ x: 60, y: 30 }, { x: 50, y: 30 }]];
  const before = calculateTravelLength(paths, { x: 0, y: 0 });
  const optimized = optimizePathOrder(paths, { x: 0, y: 0 }, true);
  assert.equal(optimized.paths.length, 3); assert.ok(calculateTravelLength(optimized.paths, { x: 0, y: 0 }) <= before);
});

test('raster conversion creates hatch and contour trajectories', () => {
  const width = 24, height = 18; const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) { const inside = x >= 5 && x <= 18 && y >= 4 && y <= 13; const value = inside ? 0 : 255; const index = (y * width + x) * 4; data[index] = data[index + 1] = data[index + 2] = value; data[index + 3] = 255; }
  const imageData = { data, width, height };
  const hatch = rasterToHatchPaths(imageData, { widthMm: 120, heightMm: 90, threshold: 0.5, rowSpacingMm: 3 });
  const contour = rasterToContourPaths(imageData, { widthMm: 120, heightMm: 90, threshold: 0.5, sampleStepPx: 1 });
  assert.ok(hatch.length >= 3); assert.ok(contour.length >= 1); assert.ok(cleanPaths(contour).every((item) => item.length >= 2));
});

test('generated G-code uses millimetres, safe pen sequence and byte progress', () => {
  const paths = [[{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }], [{ x: 60, y: 40 }, { x: 80, y: 45 }]];
  const result = generateGcode(paths, PAGE_PRESETS.A4_PORTRAIT, { drawFeed: 1200, travelFeed: 4000, penUp: 5, penDown: 0, penDwell: 0.12, invertY: true });
  assert.match(result.gcode, /G21/); assert.match(result.gcode, /G90/); assert.match(result.gcode, /G0 Z5/); assert.match(result.gcode, /G0 Z0/); assert.match(result.gcode, /G1 X30 Y267 F1200/);
  assert.equal(result.pathByteRanges.length, 2); assert.ok(result.pathByteRanges[0].endFraction < result.pathByteRanges[1].endFraction); assert.equal(result.validation.valid, true);
});

test('FluidNC status parser extracts position and SD progress', () => {
  const status = parseFluidNCStatus('<Run|MPos:12.500,44.000,0.000|FS:1200,0|SD:37.25,/jobs/demo.gcode>');
  assert.equal(status.state, 'Run'); assert.deepEqual(status.mpos, { x: 12.5, y: 44, z: 0 }); assert.equal(status.feed, 1200); assert.equal(status.job.percent, 37.25);
  const complete = parseFluidNCStatus('<Idle|MPos:0,0,5|SD:/jobs/demo.gcode: Sent>'); assert.equal(complete.job.percent, 100); assert.equal(complete.job.complete, true);
});

test('FluidNC job commands address SD and local roots correctly', () => {
  const client = Object.create(FluidNCClient.prototype); const commands = []; client.sendCommand = (command) => commands.push(command); client.fileName = 'handdraw-job.gcode';
  client.startJob('/jobs/demo.gcode', 'sd'); client.startJob('/sd/jobs/legacy.gcode', 'sd'); client.startJob('/short.gcode', 'local');
  assert.deepEqual(commands, ['$SD/Run=/jobs/demo.gcode', '$SD/Run=/jobs/legacy.gcode', '$LocalFS/Run=/short.gcode']);
});
