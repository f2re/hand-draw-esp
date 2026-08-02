function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBaseUrl(value) {
  const source = String(value || '').trim();
  if (!source) {
    if (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null') return window.location.origin;
    return 'http://127.0.0.1';
  }
  return /^https?:\/\//i.test(source) ? source.replace(/\/$/, '') : `http://${source.replace(/\/$/, '')}`;
}

function websocketUrl(baseUrl) {
  return baseUrl.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:') + '/';
}

function parseMachinePosition(field) {
  const match = /^(?:MPos|WPos):([^,|>]+),([^,|>]+),([^,|>]+)/i.exec(field);
  if (!match) return null;
  return { x: finite(match[1]), y: finite(match[2]), z: finite(match[3]) };
}

function parseSdField(field) {
  if (!field.startsWith('SD:')) return null;
  const value = field.slice(3).trim();
  const progress = /^([0-9]+(?:\.[0-9]+)?),(.+)$/.exec(value);
  if (progress) {
    return {
      percent: Math.max(0, Math.min(100, finite(progress[1]))),
      file: progress[2].trim(),
      complete: false,
    };
  }
  const sent = /^(.+?):\s*Sent\s*$/i.exec(value);
  if (sent) return { percent: 100, file: sent[1].trim(), complete: true };
  return { percent: null, file: value, complete: false };
}

export function parseFluidNCStatus(raw) {
  const text = String(raw ?? '').trim();
  const result = {
    raw: text,
    state: 'Unknown',
    mpos: null,
    wpos: null,
    feed: null,
    spindle: null,
    job: null,
    fields: {},
  };
  const match = /^<([^>]*)>$/.exec(text);
  if (!match) return result;
  const fields = match[1].split('|');
  result.state = fields.shift() || 'Unknown';
  for (const field of fields) {
    const position = parseMachinePosition(field);
    if (position) {
      if (field.startsWith('MPos:')) result.mpos = position;
      else result.wpos = position;
      continue;
    }
    if (field.startsWith('FS:')) {
      const [feed, spindle] = field.slice(3).split(',');
      result.feed = finite(feed);
      result.spindle = finite(spindle);
      continue;
    }
    const job = parseSdField(field);
    if (job) {
      result.job = job;
      continue;
    }
    const separator = field.indexOf(':');
    if (separator > 0) result.fields[field.slice(0, separator)] = field.slice(separator + 1);
    else result.fields[field] = true;
  }
  return result;
}

export function machineStateKind(statusOrState) {
  const state = String(typeof statusOrState === 'string' ? statusOrState : statusOrState?.state || 'Unknown');
  const base = state.split(':', 1)[0].toLowerCase();
  if (base === 'idle') return 'idle';
  if (base === 'run' || base === 'cycle' || base === 'jog' || base === 'home' || base === 'homing') return 'motion';
  if (base === 'hold' || base === 'door') return 'paused';
  if (base === 'alarm' || base === 'critical' || base === 'configalarm') return 'alarm';
  return 'unknown';
}

function normalizeJobPath(path, storage) {
  let normalized = `/${String(path || '').replace(/^\/+/, '')}`;
  if (storage === 'sd') normalized = normalized.replace(/^\/sd(?=\/|$)/, '') || '/';
  if (storage === 'local') normalized = normalized.replace(/^\/(?:flash|local)(?=\/|$)/, '') || '/';
  return normalized;
}

const CYRILLIC_JOB_MAP = Object.freeze({
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
});

export function safeJobFileName(value = 'handdraw-job.gcode') {
  const transliterated = [...String(value || '')].map((symbol) => {
    const lower = symbol.toLowerCase();
    const mapped = CYRILLIC_JOB_MAP[lower];
    if (mapped === undefined) return symbol;
    return symbol === lower ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1);
  }).join('');
  const compact = transliterated
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^0-9A-Za-z._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 72);
  const base = compact || 'handdraw-job';
  return base.toLowerCase().endsWith('.gcode') ? base : `${base}.gcode`;
}

function encodeCommand(command) {
  return new TextEncoder().encode(`${command}\n`);
}

function commandLines(commands) {
  return (Array.isArray(commands) ? commands : [commands])
    .map((command) => String(command ?? '').trim())
    .filter(Boolean);
}

async function payloadBytes(payload) {
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  if (ArrayBuffer.isView(payload)) return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
  if (typeof Blob !== 'undefined' && payload instanceof Blob) return new Uint8Array(await payload.arrayBuffer());
  return new TextEncoder().encode(String(payload ?? ''));
}

function bytesEqual(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function protocolError(line, command) {
  const message = String(line || 'Неизвестная ошибка FluidNC.').trim();
  const error = new Error(command ? `${message} Команда: ${command}` : message);
  error.protocolLine = message;
  error.command = command;
  return error;
}

export class FluidNCClient extends EventTarget {
  constructor(baseUrl = '', options = {}) {
    super();
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.websocket = null;
    this.connected = false;
    this.fileName = 'handdraw-job.gcode';
    this.status = parseFluidNCStatus('');
    this.pollIntervalMs = Math.max(200, Number(options.pollIntervalMs ?? 500));
    this.commandTimeoutMs = Math.max(1000, Number(options.commandTimeoutMs ?? 12000));
    this.pollTimer = null;
    this.reconnectTimer = null;
    this.autoReconnect = options.autoReconnect !== false;
    this.commandQueue = [];
    this.activeCommand = null;
  }

  setBaseUrl(value) {
    const normalized = normalizeBaseUrl(value);
    if (normalized === this.baseUrl) return;
    this.disconnect();
    this.baseUrl = normalized;
  }

  connect() {
    if (this.websocket && this.websocket.readyState <= 1) return;
    this.autoReconnect = true;
    if (typeof WebSocket === 'undefined') throw new Error('WebSocket недоступен в этом окружении.');
    const socket = new WebSocket(websocketUrl(this.baseUrl), ['arduino']);
    socket.binaryType = 'arraybuffer';
    this.websocket = socket;
    socket.addEventListener('open', () => {
      this.connected = true;
      this.dispatchEvent(new CustomEvent('connection', { detail: { connected: true, baseUrl: this.baseUrl } }));
      this.startPolling();
      this.sendRealtime('?');
      this.pumpCommandQueue();
    });
    socket.addEventListener('message', (event) => this.handleMessage(event.data));
    socket.addEventListener('error', (event) => this.dispatchEvent(new CustomEvent('error', { detail: event })));
    socket.addEventListener('close', () => {
      this.connected = false;
      this.stopPolling();
      this.rejectAllCommands(new Error('Соединение с FluidNC закрыто до подтверждения команды.'));
      this.dispatchEvent(new CustomEvent('connection', { detail: { connected: false, baseUrl: this.baseUrl } }));
      if (this.autoReconnect && typeof window !== 'undefined') {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connect(), 1600);
      }
    });
  }

  disconnect() {
    this.autoReconnect = false;
    clearTimeout(this.reconnectTimer);
    this.stopPolling();
    this.rejectAllCommands(new Error('Соединение с FluidNC отключено оператором.'));
    if (this.websocket) this.websocket.close();
    this.websocket = null;
    this.connected = false;
  }

  handleMessage(data) {
    let text;
    if (typeof data === 'string') text = data;
    else if (data instanceof ArrayBuffer) text = new TextDecoder().decode(data);
    else text = String(data ?? '');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      this.handleProtocolLine(trimmed);
    }
  }

  handleProtocolLine(line) {
    if (line.startsWith('<') && line.endsWith('>')) {
      this.status = parseFluidNCStatus(line);
      this.dispatchEvent(new CustomEvent('status', { detail: this.status }));
      if (machineStateKind(this.status) === 'alarm') this.rejectAllCommands(protocolError(this.status.state, this.activeCommand?.command));
      return;
    }
    if (/^ok\b/i.test(line)) {
      this.finishActiveCommand(null, line);
      return;
    }
    if (/^(?:error\b|alarm\b|critical\b|configalarm\b)/i.test(line)) {
      const error = protocolError(line, this.activeCommand?.command);
      this.finishActiveCommand(error, line);
      this.rejectAllCommands(error);
      this.dispatchEvent(new CustomEvent('message', { detail: line }));
      return;
    }
    this.dispatchEvent(new CustomEvent('message', { detail: line }));
  }

  startPolling() {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      if (this.connected) this.sendRealtime('?');
    }, this.pollIntervalMs);
  }

  stopPolling() {
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  ensureConnected() {
    if (!this.connected || !this.websocket || this.websocket.readyState !== WebSocket.OPEN) throw new Error('Нет соединения с FluidNC.');
  }

  ensureIdle() {
    this.ensureConnected();
    if (this.activeCommand || this.commandQueue.length) throw new Error('FluidNC ещё подтверждает предыдущую команду.');
    if (machineStateKind(this.status) !== 'idle') throw new Error(`Станок занят: ${this.status.state}.`);
  }

  sendRaw(data) {
    this.ensureConnected();
    this.websocket.send(data);
  }

  sendCommand(command, options = {}) {
    const value = String(command ?? '').trim();
    if (!value) return Promise.resolve({ command: '', response: 'skipped' });
    this.ensureConnected();
    const timeoutMs = Math.max(1000, Number(options.timeoutMs ?? this.commandTimeoutMs));
    return new Promise((resolve, reject) => {
      this.commandQueue.push({ command: value, timeoutMs, resolve, reject, timer: null });
      this.pumpCommandQueue();
    });
  }

  async sendCommands(commands, options = {}) {
    const responses = [];
    for (const command of commandLines(commands)) responses.push(await this.sendCommand(command, options));
    return responses;
  }

  pumpCommandQueue() {
    if (this.activeCommand || !this.commandQueue.length) return;
    if (!this.connected || !this.websocket || this.websocket.readyState !== WebSocket.OPEN) return;
    const entry = this.commandQueue.shift();
    this.activeCommand = entry;
    entry.timer = setTimeout(() => {
      if (this.activeCommand !== entry) return;
      const error = new Error(`FluidNC не подтвердил команду за ${entry.timeoutMs} мс: ${entry.command}`);
      this.rejectAllCommands(error);
      this.dispatchEvent(new CustomEvent('error', { detail: error }));
    }, entry.timeoutMs);
    try {
      this.websocket.send(encodeCommand(entry.command));
    } catch (error) {
      this.finishActiveCommand(error instanceof Error ? error : new Error(String(error)));
    }
  }

  finishActiveCommand(error = null, response = '') {
    const entry = this.activeCommand;
    if (!entry) return;
    this.activeCommand = null;
    clearTimeout(entry.timer);
    if (error) {
      entry.reject(error);
      this.dispatchEvent(new CustomEvent('error', { detail: error }));
    } else {
      entry.resolve({ command: entry.command, response });
    }
    queueMicrotask(() => this.pumpCommandQueue());
  }

  rejectAllCommands(error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    const active = this.activeCommand;
    this.activeCommand = null;
    if (active) {
      clearTimeout(active.timer);
      active.reject(failure);
    }
    while (this.commandQueue.length) this.commandQueue.shift().reject(failure);
  }

  sendRealtime(command) {
    const value = String(command ?? '');
    if (!value) return;
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) this.websocket.send(value);
  }

  async ensureDirectory(remotePath) {
    const response = await fetch(`${this.baseUrl}${remotePath}`, {
      method: 'MKCOL',
      credentials: 'same-origin',
    });
    if (![201, 204, 405, 409].includes(response.status) && !response.ok) {
      throw new Error(`Не удалось подготовить каталог ${remotePath}: HTTP ${response.status}.`);
    }
  }

  async readFileBytes(remotePath) {
    const response = await fetch(`${this.baseUrl}${remotePath}?verify=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(`Файл записан, но не прочитан обратно: HTTP ${response.status}.`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async putFile(remotePath, payload, contentType = 'application/octet-stream', verify = true) {
    const expected = await payloadBytes(payload);
    const response = await fetch(`${this.baseUrl}${remotePath}`, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: expected,
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(`FluidNC вернул HTTP ${response.status} для ${remotePath}.`);
    if (verify) {
      const actual = await this.readFileBytes(remotePath);
      if (!bytesEqual(actual, expected)) {
        throw new Error(`Побайтовая проверка записи не пройдена: получено ${actual.byteLength} байт вместо точной копии ${expected.byteLength} байт.`);
      }
    }
    return { response, bytes: expected.byteLength, verified: verify ? 'byte-for-byte' : 'none' };
  }

  async deleteFile(remotePath) {
    const response = await fetch(`${this.baseUrl}${remotePath}`, { method: 'DELETE', credentials: 'same-origin' });
    return response.ok || response.status === 404;
  }

  async moveFile(sourcePath, targetPath) {
    const destination = new URL(targetPath, `${this.baseUrl}/`).href;
    const response = await fetch(`${this.baseUrl}${sourcePath}`, {
      method: 'MOVE',
      headers: { Destination: destination, Overwrite: 'T' },
      credentials: 'same-origin',
    });
    if ([405, 501].includes(response.status)) return false;
    if (!response.ok) throw new Error(`Не удалось завершить атомарную запись: HTTP ${response.status}.`);
    return true;
  }

  async uploadJob(gcode, fileName = this.fileName, storage = 'sd') {
    this.ensureIdle();
    this.fileName = safeJobFileName(fileName);
    const root = storage === 'local' ? '/flash' : '/sd/jobs';
    if (storage === 'sd') await this.ensureDirectory('/sd/jobs');
    const finalPath = `${root}/${encodeURIComponent(this.fileName)}`;
    const temporaryPath = `${finalPath}.part-${Date.now().toString(36)}`;
    const payload = new TextEncoder().encode(String(gcode));
    let moved = false;
    try {
      await this.putFile(temporaryPath, payload, 'text/plain;charset=utf-8', true);
      moved = await this.moveFile(temporaryPath, finalPath);
      if (!moved) {
        await this.putFile(finalPath, payload, 'text/plain;charset=utf-8', true);
        await this.deleteFile(temporaryPath);
      } else {
        const finalBytes = await this.readFileBytes(finalPath);
        if (!bytesEqual(finalBytes, payload)) throw new Error('Итоговый файл после переименования отличается от подготовленного G-code.');
      }
    } catch (error) {
      await this.deleteFile(temporaryPath).catch(() => false);
      throw error;
    }
    return {
      storage,
      path: storage === 'local' ? `/${this.fileName}` : `/jobs/${this.fileName}`,
      bytes: payload.byteLength,
      verified: 'byte-for-byte',
      atomicMove: moved,
    };
  }

  async startJob(path = this.fileName, storage = 'sd') {
    this.ensureIdle();
    const normalized = normalizeJobPath(path, storage);
    return this.sendCommand(storage === 'local' ? `$LocalFS/Run=${normalized}` : `$SD/Run=${normalized}`);
  }

  pause() { this.sendRealtime('!'); }
  resume() { this.sendRealtime('~'); }
  stop() {
    this.rejectAllCommands(new Error('Командная очередь сброшена аварийной остановкой.'));
    this.sendRealtime('\x18');
  }

  async home() {
    this.ensureConnected();
    return this.sendCommand('$H', { timeoutMs: 120000 });
  }

  async unlock() {
    this.ensureConnected();
    return this.sendCommand('$X');
  }

  async jog(axis, distance, feed = 600) {
    this.ensureIdle();
    const name = String(axis || '').toUpperCase();
    if (!['X', 'Y', 'Z'].includes(name)) throw new Error('Неизвестная ось jog.');
    return this.sendCommand(`$J=G91 G21 ${name}${finite(distance)} F${Math.max(1, finite(feed, 600))}`, { timeoutMs: 30000 });
  }

  async setPen(up = true, options = {}) {
    this.ensureIdle();
    const penUp = finite(options.penUp, 5);
    const penDown = finite(options.penDown, 0);
    const feed = Math.max(1, finite(options.feed, 240));
    const dwell = Math.max(0, finite(options.dwell, 0));
    return this.sendCommands(['G90', `G0 Z${up ? penUp : penDown} F${feed}`, ...(dwell > 0 ? [`G4 P${dwell}`] : [])]);
  }

  async testPen(options = {}) {
    this.ensureIdle();
    const penUp = finite(options.penUp, 5);
    const penDown = finite(options.penDown, 0);
    const feed = Math.max(1, finite(options.feed, 180));
    const downDwell = Math.max(0.2, finite(options.penDownDwell, 0.4));
    const upDwell = Math.max(0.2, finite(options.penUpDwell, 0.4));
    return this.sendCommands([
      'G90',
      `G0 Z${penUp} F${feed}`,
      `G4 P${upDwell}`,
      `G0 Z${penDown} F${feed}`,
      `G4 P${downDwell}`,
      `G0 Z${penUp} F${feed}`,
      `G4 P${upDwell}`,
    ], { timeoutMs: 15000 });
  }
}
