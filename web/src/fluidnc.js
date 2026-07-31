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

function normalizeJobPath(path, storage) {
  let normalized = `/${String(path || '').replace(/^\/+/, '')}`;
  if (storage === 'sd') normalized = normalized.replace(/^\/sd(?=\/|$)/, '') || '/';
  if (storage === 'local') normalized = normalized.replace(/^\/(?:flash|local)(?=\/|$)/, '') || '/';
  return normalized;
}

function encodeCommand(command) {
  return new TextEncoder().encode(`${command}\n`);
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
    this.pollTimer = null;
    this.reconnectTimer = null;
    this.autoReconnect = options.autoReconnect !== false;
  }

  setBaseUrl(value) {
    const normalized = normalizeBaseUrl(value);
    if (normalized === this.baseUrl) return;
    this.disconnect();
    this.baseUrl = normalized;
  }

  connect() {
    if (this.websocket && this.websocket.readyState <= 1) return;
    if (typeof WebSocket === 'undefined') throw new Error('WebSocket недоступен в этом окружении.');
    const socket = new WebSocket(websocketUrl(this.baseUrl), ['arduino']);
    socket.binaryType = 'arraybuffer';
    this.websocket = socket;
    socket.addEventListener('open', () => {
      this.connected = true;
      this.dispatchEvent(new CustomEvent('connection', { detail: { connected: true } }));
      this.startPolling();
      this.sendRealtime('?');
    });
    socket.addEventListener('message', (event) => this.handleMessage(event.data));
    socket.addEventListener('error', (event) => this.dispatchEvent(new CustomEvent('error', { detail: event })));
    socket.addEventListener('close', () => {
      this.connected = false;
      this.stopPolling();
      this.dispatchEvent(new CustomEvent('connection', { detail: { connected: false } }));
      if (this.autoReconnect && typeof window !== 'undefined') {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connect(), 1500);
      }
    });
  }

  disconnect() {
    this.autoReconnect = false;
    clearTimeout(this.reconnectTimer);
    this.stopPolling();
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
      if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
        this.status = parseFluidNCStatus(trimmed);
        this.dispatchEvent(new CustomEvent('status', { detail: this.status }));
      } else {
        this.dispatchEvent(new CustomEvent('message', { detail: trimmed }));
      }
    }
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

  sendRaw(data) {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) throw new Error('Нет соединения с FluidNC.');
    this.websocket.send(data);
  }

  sendCommand(command) {
    const value = String(command ?? '').trim();
    if (!value) return;
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.sendRaw(encodeCommand(value));
      return;
    }
    const query = new URLSearchParams({ commandText: value });
    fetch(`${this.baseUrl}/command?${query}`, { method: 'GET', credentials: 'same-origin' }).catch((error) => {
      this.dispatchEvent(new CustomEvent('error', { detail: error }));
    });
  }

  sendRealtime(command) {
    const value = String(command ?? '');
    if (!value) return;
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) this.sendRaw(value);
  }

  async putFile(remotePath, payload, contentType = 'application/octet-stream') {
    const response = await fetch(`${this.baseUrl}${remotePath}`, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: payload,
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(`FluidNC вернул HTTP ${response.status} для ${remotePath}.`);
    return response;
  }

  async uploadJob(gcode, fileName = this.fileName, storage = 'sd') {
    const safeName = String(fileName || 'handdraw-job.gcode').replace(/[^0-9A-Za-zА-Яа-яЁё._-]+/g, '-');
    this.fileName = safeName.endsWith('.gcode') ? safeName : `${safeName}.gcode`;
    const root = storage === 'local' ? '/flash' : '/sd/jobs';
    const path = `${root}/${encodeURIComponent(this.fileName)}`;
    await this.putFile(path, new Blob([String(gcode)], { type: 'text/plain;charset=utf-8' }), 'text/plain;charset=utf-8');
    return { storage, path: storage === 'local' ? `/${this.fileName}` : `/jobs/${this.fileName}` };
  }

  startJob(path = this.fileName, storage = 'sd') {
    const normalized = normalizeJobPath(path, storage);
    this.sendCommand(storage === 'local' ? `$LocalFS/Run=${normalized}` : `$SD/Run=${normalized}`);
  }

  pause() { this.sendRealtime('!'); }
  resume() { this.sendRealtime('~'); }
  stop() { this.sendRealtime('\x18'); }
  home() { this.sendCommand('$H'); }
  unlock() { this.sendCommand('$X'); }
  jog(axis, distance, feed = 600) {
    const name = String(axis || '').toUpperCase();
    if (!['X', 'Y', 'Z'].includes(name)) throw new Error('Неизвестная ось jog.');
    this.sendCommand(`$J=G91 G21 ${name}${finite(distance)} F${Math.max(1, finite(feed, 600))}`);
  }
  setPen(up = true) { this.sendCommand(`G0 Z${up ? 5 : 0}`); }
}
