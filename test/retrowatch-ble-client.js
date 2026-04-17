const SERVICE_UUID = "ed5c1400-2ac0-4349-ad36-dfe8831383ee";
const CHARACTERISTIC_UUID = "ed5c1401-2ac0-4349-ad36-dfe8831383ee";
const RX_CHARACTERISTIC_UUID = "ed5c1401-2ac0-4349-ad36-dfe8831383ee";
const TX_CHARACTERISTIC_UUID = "ed5c1402-2ac0-4349-ad36-dfe8831383ee";

const MSG = {
  NONE: 0x0000,
  PING: 0x0001,
  PONG: 0x0002,
  ERROR: 0x0003,
  TRANSPORT_INFO_REQ: 0x0004,
  TRANSPORT_INFO_RSP: 0x0005,
  SET_TIME_REQ: 0x0006,
  SET_TIME_RSP: 0x0007,
  LOG_DUMP_REQ: 0x0008,
  LOG_DUMP_RSP: 0x0009,
  LFS_LIST_REQ: 0x0100,
  LFS_LIST_RSP: 0x0101,
  LFS_READ_REQ: 0x0102,
  LFS_READ_RSP: 0x0103,
  LFS_WRITE_REQ: 0x0104,
  LFS_WRITE_RSP: 0x0105,
  LFS_DELETE_REQ: 0x0106,
  LFS_DELETE_RSP: 0x0107,
  LFS_MKDIR_REQ: 0x0108,
  LFS_MKDIR_RSP: 0x0109,
  LFS_STAT_REQ: 0x010a,
  LFS_STAT_RSP: 0x010b,
  LFS_RENAME_REQ: 0x010c,
  LFS_RENAME_RSP: 0x010d,
  FILE_BEGIN_REQ: 0x0200,
  FILE_BEGIN_RSP: 0x0201,
  FILE_CHUNK_REQ: 0x0202,
  FILE_CHUNK_RSP: 0x0203,
  FILE_COMMIT_REQ: 0x0204,
  FILE_COMMIT_RSP: 0x0205,
  FILE_LAUNCH_REQ: 0x0206,
  FILE_LAUNCH_RSP: 0x0207,
};

// Backward-compatible aliases for existing UI codepaths.
MSG.OTA_BEGIN_REQ = MSG.FILE_BEGIN_REQ;
MSG.OTA_BEGIN_RSP = MSG.FILE_BEGIN_RSP;
MSG.OTA_CHUNK_REQ = MSG.FILE_CHUNK_REQ;
MSG.OTA_CHUNK_RSP = MSG.FILE_CHUNK_RSP;
MSG.OTA_COMMIT_REQ = MSG.FILE_COMMIT_REQ;
MSG.OTA_COMMIT_RSP = MSG.FILE_COMMIT_RSP;

const STATUS = {
  OK: 0,
  BAD_REQUEST: 1,
  NOT_FOUND: 2,
  IO_ERROR: 3,
  NOT_SUPPORTED: 4,
  INTERNAL: 5,
};

const OTA_ERROR_REASON = {
  0: "NONE",
  1: "BAD_LEN",
  2: "NO_ACTIVE_SESSION",
  3: "ALLOC_FAILED",
  4: "CHUNK_SIZE_MISMATCH",
  5: "CHUNK_RANGE",
  6: "CHUNK_OFFSET",
  7: "COMMIT_INCOMPLETE",
  8: "CRC_MISMATCH",
  9: "ZIP_OPEN_FAILED",
  10: "FIRMWARE_IMG_NOT_FOUND",
  11: "APPLY_FAILED",
  12: "BAD_FLAGS",
  13: "PATH_REQUIRED",
  14: "SAVE_FAILED",
  15: "LAUNCH_UNSUPPORTED",
};

const UPLOAD_FLAG = {
  LAUNCH: 0x01,
  SAVE: 0x02,
};

const MSG_NAME_BY_TYPE = Object.fromEntries(Object.entries(MSG).map(([name, value]) => [value, name]));
const STATUS_NAME_BY_CODE = Object.fromEntries(Object.entries(STATUS).map(([name, value]) => [value, name]));

function encodePacket(type, payloadBytes) {
  const payload = payloadBytes || new Uint8Array(0);
  const totalSize = 4 + payload.length;
  const out = new Uint8Array(totalSize);
  out[0] = type & 0xff;
  out[1] = (type >> 8) & 0xff;
  out[2] = totalSize & 0xff;
  out[3] = (totalSize >> 8) & 0xff;
  out.set(payload, 4);
  return out;
}

function decodePacket(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 4) {
    throw new Error("Packet too short");
  }

  const type = bytes[0] | (bytes[1] << 8);
  const size = bytes[2] | (bytes[3] << 8);
  if (size < 4) {
    throw new Error("Packet has invalid total size");
  }

  if (bytes.length < size) {
    throw new Error("Packet size mismatch");
  }

  return {
    type,
    size,
    payload: bytes.slice(4, size),
  };
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16LE(value) {
  return new Uint8Array([value & 0xff, (value >> 8) & 0xff]);
}

function u32LE(value) {
  return new Uint8Array([
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >> 24) & 0xff,
  ]);
}

function concatBytes(parts) {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function textToBytes(text) {
  return new TextEncoder().encode(text || "");
}

function bytesToText(bytes) {
  return new TextDecoder().decode(bytes);
}

function bytesToHex(bytes, maxLen = 32) {
  if (!bytes || bytes.length === 0) {
    return "";
  }
  const shown = bytes.slice(0, maxLen);
  const hex = Array.from(shown).map((b) => b.toString(16).padStart(2, "0")).join(" ");
  if (bytes.length > maxLen) {
    return `${hex} ...(+${bytes.length - maxLen} bytes)`;
  }
  return hex;
}

function statusName(code) {
  return STATUS_NAME_BY_CODE[code] || `UNKNOWN(${code})`;
}

function msgTypeName(type) {
  return MSG_NAME_BY_TYPE[type] || `0x${(type & 0xffff).toString(16).padStart(4, "0")}`;
}

function otaReasonName(reasonCode) {
  return OTA_ERROR_REASON[reasonCode] || `UNKNOWN_REASON(${reasonCode})`;
}

function parseRspHeader(payload) {
  if (!payload || payload.length < 3) {
    throw new Error("Response payload too short");
  }
  const status = payload[0];
  const requestId = payload[1] | (payload[2] << 8);
  const body = payload.slice(3);
  return { status, requestId, body };
}

class RetroWatchBleClient {
  constructor(opts = {}) {
    this.serviceUuid = (opts.serviceUuid || SERVICE_UUID).toLowerCase();
    this.characteristicUuid = (opts.characteristicUuid || CHARACTERISTIC_UUID).toLowerCase();
    this.rxCharacteristicUuid = (opts.rxCharacteristicUuid || this.characteristicUuid || RX_CHARACTERISTIC_UUID).toLowerCase();
    this.txCharacteristicUuid = (opts.txCharacteristicUuid || TX_CHARACTERISTIC_UUID).toLowerCase();

    this.device = null;
    this.knownDevice = null;
    this.server = null;
    this.service = null;
    this.characteristic = null;
    this.writeCharacteristic = null;
    this.notifyCharacteristic = null;

    this.requestId = 1;
    this.listeners = new Set();
    this.disconnectListeners = new Set();
    this.pending = new Set();
    this.txLock = Promise.resolve();
    this.requestLock = Promise.resolve();

    this.maxNotifyPayloadBytes = 20;
    this.maxMessagePayloadBytes = 17;
    this.debugLogger = typeof opts.debugLogger === "function" ? opts.debugLogger : null;

    this._onNotification = this._onNotification.bind(this);
    this._onDisconnected = this._onDisconnected.bind(this);
  }

  setDebugLogger(logger) {
    this.debugLogger = typeof logger === "function" ? logger : null;
  }

  _emitDebug(evt) {
    if (!this.debugLogger) {
      return;
    }
    try {
      this.debugLogger(evt);
    } catch (err) {
      // Keep transport flow alive even if debug sink throws.
    }
  }

  async connect() {
    if (!navigator.bluetooth) {
      throw new Error("Web Bluetooth is not available in this browser");
    }

    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "RetroWatch" }],
      optionalServices: [this.serviceUuid],
    });

    this.knownDevice = this.device;

    return this.reconnect();
  }

  async reconnect() {
    const dev = this.device || this.knownDevice;
    if (!dev) {
      throw new Error("No previously selected RetroWatch device");
    }

    if (this.isConnected()) {
      return dev.name || "RetroWatch";
    }

    this.device = dev;

    this.device.removeEventListener("gattserverdisconnected", this._onDisconnected);
    this.device.addEventListener("gattserverdisconnected", this._onDisconnected);

    this.server = await this.device.gatt.connect();
    try {
      this.service = await this.server.getPrimaryService(this.serviceUuid);
    } catch (err) {
      let available = [];
      try {
        const services = await this.server.getPrimaryServices();
        available = services.map((s) => (s && s.uuid ? String(s.uuid).toLowerCase() : ""));
      } catch (listErr) {
        // Ignore secondary diagnostic errors.
      }

      if (this.server && this.server.connected) {
        this.server.disconnect();
      }
      this.server = null;
      this.service = null;
      this.characteristic = null;
      this.writeCharacteristic = null;
      this.notifyCharacteristic = null;
      this.clearKnownDevice();

      const availableText = available.length ? available.join(", ") : "(none discovered)";
      throw new Error(`Primary service ${this.serviceUuid} not found. Available: ${availableText}. Re-select the device from Connect.`);
    }
    this.writeCharacteristic = await this.service.getCharacteristic(this.rxCharacteristicUuid);

    this.notifyCharacteristic = await this.service.getCharacteristic(this.txCharacteristicUuid);

    this.characteristic = this.writeCharacteristic;

    await this.notifyCharacteristic.startNotifications();
    this.notifyCharacteristic.removeEventListener("characteristicvaluechanged", this._onNotification);
    this.notifyCharacteristic.addEventListener("characteristicvaluechanged", this._onNotification);

    await this._refreshTransportInfo();

    return this.device.name || "RetroWatch";
  }

  async disconnect() {
    if (this.notifyCharacteristic) {
      this.notifyCharacteristic.removeEventListener("characteristicvaluechanged", this._onNotification);
    }

    if (this.device) {
      this.device.removeEventListener("gattserverdisconnected", this._onDisconnected);
    }

    if (this.server && this.server.connected) {
      this.server.disconnect();
    }

    if (this.device) {
      this.knownDevice = this.device;
    }

    this.device = this.knownDevice;
    this.server = null;
    this.service = null;
    this.characteristic = null;
    this.writeCharacteristic = null;
    this.notifyCharacteristic = null;

    this._rejectPending(new Error("Disconnected"));
  }

  isConnected() {
    return !!(this.server && this.server.connected && this.characteristic);
  }

  canReconnect() {
    return !!(this.device || this.knownDevice);
  }

  clearKnownDevice() {
    if (this.notifyCharacteristic) {
      this.notifyCharacteristic.removeEventListener("characteristicvaluechanged", this._onNotification);
    }
    if (this.device) {
      this.device.removeEventListener("gattserverdisconnected", this._onDisconnected);
    }

    this.device = null;
    this.knownDevice = null;
    this.server = null;
    this.service = null;
    this.characteristic = null;
    this.writeCharacteristic = null;
    this.notifyCharacteristic = null;

    this._rejectPending(new Error("Disconnected"));
  }

  onPacket(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  onDisconnect(cb) {
    this.disconnectListeners.add(cb);
    return () => this.disconnectListeners.delete(cb);
  }

  async sendRaw(type, payload) {
    if (!this.isConnected()) {
      await this.reconnect();
    }

    this._assertConnected();
    const packet = encodePacket(type, payload);
    const writeJob = this.txLock.then(async () => {
      this._assertConnected();
      await this.writeCharacteristic.writeValueWithoutResponse(packet);
    });

    this.txLock = writeJob.catch(() => {});
    await writeJob;
  }

  _setTransportPayloadLimits(notifyPayloadBytes, messagePayloadBytes = null) {
    const clampedNotify = Math.max(20, Math.min(505, notifyPayloadBytes | 0));
    this.maxNotifyPayloadBytes = clampedNotify;
    const protocolPayloadCap = Math.max(0, clampedNotify - 3);

    if (messagePayloadBytes == null) {
      this.maxMessagePayloadBytes = protocolPayloadCap;
      return;
    }

    const clampedMessage = Math.max(0, Math.min(protocolPayloadCap, messagePayloadBytes | 0));
    this.maxMessagePayloadBytes = clampedMessage;
  }

  _maxRspBodyBytes() {
    return Math.max(0, this.maxMessagePayloadBytes - 3);
  }

  _maxReadChunkForPath(pathLen) {
    const requestOverhead = 10 + pathLen;
    const byReq = this.maxMessagePayloadBytes - requestOverhead;
    const byRsp = this._maxRspBodyBytes();
    return Math.min(byReq, byRsp);
  }

  _maxWriteChunkForPath(pathLen) {
    const requestOverhead = 10 + pathLen;
    return this.maxMessagePayloadBytes - requestOverhead;
  }

  _maxListChunkBytes() {
    /* listPaged response body: has_more(1) + next_off(2) + chunk_len(2) + chunk */
    return this._maxRspBodyBytes() - 5;
  }

  async _refreshTransportInfo() {
    try {
      const info = await this.getTransportInfo();
      if (info.status === STATUS.OK) {
        this._setTransportPayloadLimits(info.notifyPayloadMax, info.messagePayloadMax);
        this._emitDebug({
          phase: "transport_info",
          status: info.status,
          statusName: statusName(info.status),
          requestId: info.requestId,
          notifyPayloadMax: info.notifyPayloadMax,
          messagePayloadMax: info.messagePayloadMax,
          estimatedAttMtu: info.notifyPayloadMax + 3,
        });
      } else {
        this._emitDebug({
          phase: "transport_info",
          status: info.status,
          statusName: statusName(info.status),
          requestId: info.requestId,
          notifyPayloadMax: this.maxNotifyPayloadBytes,
          messagePayloadMax: this.maxMessagePayloadBytes,
          estimatedAttMtu: this.maxNotifyPayloadBytes + 3,
        });
      }
    } catch (err) {
      /* Keep conservative defaults when running against older firmware. */
      this._setTransportPayloadLimits(20);
      this._emitDebug({
        phase: "transport_info",
        status: STATUS.INTERNAL,
        statusName: statusName(STATUS.INTERNAL),
        requestId: null,
        notifyPayloadMax: this.maxNotifyPayloadBytes,
        messagePayloadMax: this.maxMessagePayloadBytes,
        estimatedAttMtu: this.maxNotifyPayloadBytes + 3,
        error: err && err.message ? err.message : String(err),
      });
    }
  }

  async getTransportInfo() {
    const reqId = this._nextRequestId();
    const payload = u16LE(reqId);

    const packet = await this.sendRequest(MSG.TRANSPORT_INFO_REQ, payload, {
      expectType: MSG.TRANSPORT_INFO_RSP,
      timeoutMs: 3000,
      requestId: reqId,
    });

    const parsed = parseRspHeader(packet.payload);
    let notifyPayloadMax = this.maxNotifyPayloadBytes;
    let messagePayloadMax = this.maxMessagePayloadBytes;

    if (parsed.body.length >= 4) {
      notifyPayloadMax = parsed.body[0] | (parsed.body[1] << 8);
      messagePayloadMax = parsed.body[2] | (parsed.body[3] << 8);
    }

    return {
      requestId: parsed.requestId,
      status: parsed.status,
      notifyPayloadMax,
      messagePayloadMax,
    };
  }

  async ping(dataText = "hello") {
    const payload = textToBytes(dataText);
    const packet = await this.sendRequest(MSG.PING, payload, {
      expectType: MSG.PONG,
      timeoutMs: 2500,
      requestIdInHeader: false,
    });
    return bytesToText(packet.payload);
  }

  async setTimeUnix(unixSeconds, tzOffsetMinutesEast = 0) {
    const reqId = this._nextRequestId();
    const sec = Number(unixSeconds) >>> 0;
    const tz = Number(tzOffsetMinutesEast) | 0;
    const tzLe = u16LE(tz & 0xffff);
    const payload = concatBytes([u16LE(reqId), u32LE(sec), tzLe]);

    const packet = await this.sendRequest(MSG.SET_TIME_REQ, payload, {
      expectType: MSG.SET_TIME_RSP,
      timeoutMs: 3000,
      requestId: reqId,
    });

    const parsed = parseRspHeader(packet.payload);
    return {
      requestId: parsed.requestId,
      status: parsed.status,
      unixSeconds: sec,
      tzOffsetMinutesEast: tz,
    };
  }

  async logDump(offset = 0, requestedLen = null) {
    const reqId = this._nextRequestId();
    let maxChunk = this._maxRspBodyBytes() - 5;
    if (maxChunk < 1) {
      maxChunk = 1;
    }

    const reqChunk = requestedLen == null ? maxChunk : Math.max(1, Math.min(requestedLen | 0, 0xffff));
    const payload = concatBytes([
      u16LE(reqId),
      u16LE(offset & 0xffff),
      u16LE(reqChunk),
    ]);

    const packet = await this.sendRequest(MSG.LOG_DUMP_REQ, payload, {
      expectType: MSG.LOG_DUMP_RSP,
      timeoutMs: 4000,
      requestId: reqId,
    });

    const parsed = parseRspHeader(packet.payload);
    if (parsed.status !== STATUS.OK) {
      return {
        requestId: parsed.requestId,
        status: parsed.status,
        hasMore: false,
        nextOffset: offset & 0xffff,
        chunk: new Uint8Array(0),
        text: "",
      };
    }

    if (parsed.body.length < 5) {
      return {
        requestId: parsed.requestId,
        status: parsed.status,
        hasMore: false,
        nextOffset: offset & 0xffff,
        chunk: new Uint8Array(0),
        text: "",
      };
    }

    const hasMore = parsed.body[0] !== 0;
    const nextOffset = parsed.body[1] | (parsed.body[2] << 8);
    const chunkLen = parsed.body[3] | (parsed.body[4] << 8);
    const chunk = parsed.body.slice(5, 5 + chunkLen);

    return {
      requestId: parsed.requestId,
      status: parsed.status,
      hasMore,
      nextOffset,
      chunk,
      text: bytesToText(chunk),
    };
  }

  async logDumpAll(startOffset = 0, requestedLen = null, maxBytes = 64 * 1024) {
    let text = "";
    let offset = startOffset & 0xffff;
    let loops = 0;

    while (text.length < maxBytes && loops < 1024) {
      loops += 1;
      const rsp = await this.logDump(offset, requestedLen);
      if (rsp.status !== STATUS.OK) {
        return rsp;
      }

      text += rsp.text;
      if (!rsp.hasMore) {
        break;
      }
      offset = rsp.nextOffset;
    }

    return {
      status: STATUS.OK,
      text,
      nextOffset: offset,
    };
  }

  async list(path = "/") {
    const reqId = this._nextRequestId();
    const pathBytes = textToBytes(path);
    const payload = concatBytes([u16LE(reqId), u16LE(pathBytes.length), pathBytes]);

    const packet = await this.sendRequest(MSG.LFS_LIST_REQ, payload, {
      expectType: MSG.LFS_LIST_RSP,
      timeoutMs: 4000,
      requestId: reqId,
    });

    const parsed = parseRspHeader(packet.payload);
    return {
      requestId: parsed.requestId,
      status: parsed.status,
      text: bytesToText(parsed.body),
    };
  }

  async listPaged(path = "/", offset = 0, maxBytes = null) {
    const reqId = this._nextRequestId();
    const pathBytes = textToBytes(path);
    let requestChunkBytes = maxBytes == null ? this._maxListChunkBytes() : maxBytes;
    if (requestChunkBytes < 1) {
      requestChunkBytes = 1;
    }
    if (requestChunkBytes > 0xffff) {
      requestChunkBytes = 0xffff;
    }
    const payload = concatBytes([
      u16LE(reqId),
      u16LE(pathBytes.length),
      pathBytes,
      u16LE(offset & 0xffff),
      u16LE(requestChunkBytes & 0xffff),
    ]);

    const packet = await this.sendRequest(MSG.LFS_LIST_REQ, payload, {
      expectType: MSG.LFS_LIST_RSP,
      timeoutMs: 4000,
      requestId: reqId,
    });

    const parsed = parseRspHeader(packet.payload);
    if (parsed.status !== STATUS.OK) {
      return {
        requestId: parsed.requestId,
        status: parsed.status,
        hasMore: false,
        nextOffset: offset,
        text: "",
      };
    }

    if (parsed.body.length < 5) {
      return {
        requestId: parsed.requestId,
        status: parsed.status,
        hasMore: false,
        nextOffset: offset,
        text: "",
      };
    }

    const hasMore = parsed.body[0] !== 0;
    const nextOffset = parsed.body[1] | (parsed.body[2] << 8);
    const chunkLen = parsed.body[3] | (parsed.body[4] << 8);
    const chunkBytes = parsed.body.slice(5, 5 + chunkLen);

    return {
      requestId: parsed.requestId,
      status: parsed.status,
      hasMore,
      nextOffset,
      text: bytesToText(chunkBytes),
    };
  }

  async listAll(path = "/") {
    let text = "";
    let offset = 0;
    let loops = 0;

    while (loops < 2048) {
      loops += 1;
      const rsp = await this.listPaged(path, offset);
      if (rsp.status !== STATUS.OK) {
        return rsp;
      }

      text += rsp.text;
      if (!rsp.hasMore) {
        break;
      }

      offset = rsp.nextOffset;
    }

    return {
      status: STATUS.OK,
      text,
    };
  }

  async read(path, offset = 0, length = null) {
    const reqId = this._nextRequestId();
    const pathBytes = textToBytes(path);
    let readLen = length == null ? this._maxReadChunkForPath(pathBytes.length) : length;
    if (readLen < 1) {
      throw new Error(`Path too long for current BLE transport: ${path}`);
    }
    if (readLen > 0xffff) {
      readLen = 0xffff;
    }
    const payload = concatBytes([
      u16LE(reqId),
      u32LE(offset >>> 0),
      u16LE(readLen),
      u16LE(pathBytes.length),
      pathBytes,
    ]);

    const packet = await this.sendRequest(MSG.LFS_READ_REQ, payload, {
      expectType: MSG.LFS_READ_RSP,
      timeoutMs: 5000,
      requestId: reqId,
    });

    const parsed = parseRspHeader(packet.payload);
    return {
      requestId: parsed.requestId,
      status: parsed.status,
      data: parsed.body,
      text: bytesToText(parsed.body),
    };
  }

  async write(path, offset, data) {
    const reqId = this._nextRequestId();
    const pathBytes = textToBytes(path);
    const dataBytes = typeof data === "string" ? textToBytes(data) : data;

    const payload = concatBytes([
      u16LE(reqId),
      u32LE(offset >>> 0),
      u16LE(pathBytes.length),
      u16LE(dataBytes.length),
      pathBytes,
      dataBytes,
    ]);

    const packet = await this.sendRequest(MSG.LFS_WRITE_REQ, payload, {
      expectType: MSG.LFS_WRITE_RSP,
      timeoutMs: 5000,
      requestId: reqId,
    });

    const parsed = parseRspHeader(packet.payload);
    let written = 0;
    if (parsed.body.length >= 2) {
      written = parsed.body[0] | (parsed.body[1] << 8);
    }

    return {
      requestId: parsed.requestId,
      status: parsed.status,
      written,
    };
  }

  async mkdir(path) {
    const reqId = this._nextRequestId();
    const pathBytes = textToBytes(path);
    const payload = concatBytes([u16LE(reqId), u16LE(pathBytes.length), pathBytes]);

    const packet = await this.sendRequest(MSG.LFS_MKDIR_REQ, payload, {
      expectType: MSG.LFS_MKDIR_RSP,
      timeoutMs: 4000,
      requestId: reqId,
    });

    const parsed = parseRspHeader(packet.payload);
    return {
      requestId: parsed.requestId,
      status: parsed.status,
    };
  }

  async remove(path) {
    const reqId = this._nextRequestId();
    const pathBytes = textToBytes(path);
    const payload = concatBytes([u16LE(reqId), u16LE(pathBytes.length), pathBytes]);

    const packet = await this.sendRequest(MSG.LFS_DELETE_REQ, payload, {
      expectType: MSG.LFS_DELETE_RSP,
      timeoutMs: 4000,
      requestId: reqId,
    });

    const parsed = parseRspHeader(packet.payload);
    return {
      requestId: parsed.requestId,
      status: parsed.status,
    };
  }

  async stat(path) {
    const reqId = this._nextRequestId();
    const pathBytes = textToBytes(path);
    const payload = concatBytes([u16LE(reqId), u16LE(pathBytes.length), pathBytes]);

    const packet = await this.sendRequest(MSG.LFS_STAT_REQ, payload, {
      expectType: MSG.LFS_STAT_RSP,
      timeoutMs: 4000,
      requestId: reqId,
    });

    const parsed = parseRspHeader(packet.payload);
    let isDir = false;
    let size = 0;

    if (parsed.body.length >= 5) {
      isDir = parsed.body[0] !== 0;
      size =
        parsed.body[1] |
        (parsed.body[2] << 8) |
        (parsed.body[3] << 16) |
        (parsed.body[4] << 24);
    }

    return {
      requestId: parsed.requestId,
      status: parsed.status,
      isDir,
      size,
    };
  }

  async rename(srcPath, dstPath) {
    const reqId = this._nextRequestId();
    const srcBytes = textToBytes(srcPath);
    const dstBytes = textToBytes(dstPath);
    const payload = concatBytes([
      u16LE(reqId),
      u16LE(srcBytes.length),
      u16LE(dstBytes.length),
      srcBytes,
      dstBytes,
    ]);

    const packet = await this.sendRequest(MSG.LFS_RENAME_REQ, payload, {
      expectType: MSG.LFS_RENAME_RSP,
      timeoutMs: 4000,
      requestId: reqId,
    });

    const parsed = parseRspHeader(packet.payload);
    return {
      requestId: parsed.requestId,
      status: parsed.status,
    };
  }

  async otaBegin(totalSize, imageCrc32, opts = {}) {
    const reqId = this._nextRequestId();
    const launch = opts.launch !== false;
    const save = !!opts.save;
    const pathText = opts.path ? String(opts.path) : "";
    const pathBytes = textToBytes(pathText);
    let flags = 0;
    if (launch) flags |= UPLOAD_FLAG.LAUNCH;
    if (save) flags |= UPLOAD_FLAG.SAVE;

    const payload = concatBytes([
      u16LE(reqId),
      u32LE(totalSize >>> 0),
      u32LE(imageCrc32 >>> 0),
      new Uint8Array([flags & 0xff]),
      u16LE(pathBytes.length),
      pathBytes,
    ]);

    const beginTimeoutMs = opts.beginTimeoutMs == null ? 6000 : opts.beginTimeoutMs;

    const packet = await this.sendRequest(MSG.OTA_BEGIN_REQ, payload, {
      expectType: MSG.OTA_BEGIN_RSP,
      timeoutMs: beginTimeoutMs,
      requestId: reqId,
    });

    const parsed = parseRspHeader(packet.payload);
    const reason = parsed.body.length > 0 ? parsed.body[0] : 0;

    this._emitDebug({
      phase: "ota_begin_rsp",
      msgType: packet.type,
      msgName: msgTypeName(packet.type),
      requestId: parsed.requestId,
      status: parsed.status,
      statusName: statusName(parsed.status),
      reason,
      reasonName: otaReasonName(reason),
      bodyHex: bytesToHex(parsed.body),
      imageSize: totalSize >>> 0,
      imageCrc32: imageCrc32 >>> 0,
      flags: flags & 0xff,
      path: pathText,
    });

    return {
      requestId: parsed.requestId,
      status: parsed.status,
      body: parsed.body,
    };
  }

  async otaChunk(offset, chunkBytes, opts = {}) {
    const reqId = this._nextRequestId();
    const payload = concatBytes([
      u16LE(reqId),
      u32LE(offset >>> 0),
      u16LE(chunkBytes.length & 0xffff),
      chunkBytes,
    ]);

    const chunkTimeoutMs = opts.chunkTimeoutMs == null ? 6000 : opts.chunkTimeoutMs;

    const packet = await this.sendRequest(MSG.OTA_CHUNK_REQ, payload, {
      expectType: MSG.OTA_CHUNK_RSP,
      timeoutMs: chunkTimeoutMs,
      requestId: reqId,
    });

    const parsed = parseRspHeader(packet.payload);
    let accepted = 0;
    if (parsed.body.length >= 2) {
      accepted = parsed.body[0] | (parsed.body[1] << 8);
    }

    if (parsed.status !== STATUS.OK || accepted <= 0) {
      const reason = parsed.body.length > 0 ? parsed.body[0] : 0;
      this._emitDebug({
        phase: "ota_chunk_rsp",
        msgType: packet.type,
        msgName: msgTypeName(packet.type),
        requestId: parsed.requestId,
        status: parsed.status,
        statusName: statusName(parsed.status),
        reason,
        reasonName: otaReasonName(reason),
        bodyHex: bytesToHex(parsed.body),
        offset: offset >>> 0,
        requestedLen: chunkBytes.length,
        accepted,
      });
    }

    return {
      requestId: parsed.requestId,
      status: parsed.status,
      accepted,
    };
  }

  async otaCommit(opts = {}) {
    const reqId = this._nextRequestId();
    const payload = u16LE(reqId);

    const commitTimeoutMs = opts.commitTimeoutMs == null ? 10000 : opts.commitTimeoutMs;

    const packet = await this.sendRequest(MSG.OTA_COMMIT_REQ, payload, {
      expectType: MSG.OTA_COMMIT_RSP,
      timeoutMs: commitTimeoutMs,
      requestId: reqId,
    });

    const parsed = parseRspHeader(packet.payload);
    const reason = parsed.body.length > 0 ? parsed.body[0] : 0;

    this._emitDebug({
      phase: "ota_commit_rsp",
      msgType: packet.type,
      msgName: msgTypeName(packet.type),
      requestId: parsed.requestId,
      status: parsed.status,
      statusName: statusName(parsed.status),
      reason,
      reasonName: otaReasonName(reason),
      bodyHex: bytesToHex(parsed.body),
    });

    return {
      requestId: parsed.requestId,
      status: parsed.status,
      body: parsed.body,
    };
  }

  async otaUploadFirmware(data, opts = {}) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

    // Re-query transport limits before upload so chunk sizing matches the
    // latest negotiated BLE MTU.
    await this._refreshTransportInfo();

    const launch = opts.launch !== false;
    const save = !!opts.save;
    const path = opts.path ? String(opts.path) : "";
    const pathOverhead = 2 + 4 + 2;
    const autoChunk = this.maxMessagePayloadBytes - pathOverhead;
    const requestedChunk = opts.chunkSize == null ? autoChunk : opts.chunkSize;
    const chunkSize = Math.max(1, Math.min(requestedChunk, autoChunk, 0xffff));
    const requestedWindow = opts.chunksPerAck == null ? 16 : opts.chunksPerAck;
    const allowOutOfOrder = opts.allowOutOfOrder === true;
    // Firmware currently validates strict in-order chunk offsets, so default to single in-flight chunk.
    const chunkWindow = allowOutOfOrder ? Math.max(1, Math.min(requestedWindow | 0, 16)) : 1;
    const totalCrc32 = crc32(bytes);

    this._emitDebug({
      phase: "ota_begin_tx",
      msgType: MSG.OTA_BEGIN_REQ,
      msgName: msgTypeName(MSG.OTA_BEGIN_REQ),
      imageSize: bytes.length,
      imageCrc32: totalCrc32,
      launch,
      save,
      path,
      chunkSize,
      chunkWindow,
      maxNotifyPayloadBytes: this.maxNotifyPayloadBytes,
      maxMessagePayloadBytes: this.maxMessagePayloadBytes,
      estimatedAttMtu: this.maxNotifyPayloadBytes + 3,
    });

    let beginRsp;
    try {
      beginRsp = await this.otaBegin(bytes.length, totalCrc32, {
        launch,
        save,
        path,
        beginTimeoutMs: opts.beginTimeoutMs,
      });
    } catch (err) {
      throw new Error(`OTA begin failed: ${err?.message || err}`);
    }
    if (beginRsp.status !== STATUS.OK) {
      const beginReason = beginRsp.body.length > 0 ? beginRsp.body[0] : 0;
      return {
        status: beginRsp.status,
        sent: 0,
        crc32: totalCrc32,
        phase: "begin",
        beginRequestId: beginRsp.requestId,
        error: {
          code: beginRsp.status,
          name: statusName(beginRsp.status),
          reason: beginReason,
          reasonName: otaReasonName(beginReason),
          bodyHex: bytesToHex(beginRsp.body),
        },
      };
    }

    let nextOffset = 0;
    let acknowledged = 0;
    const inFlight = [];

    const enqueueChunk = () => {
      if (nextOffset >= bytes.length) {
        return false;
      }

      const end = Math.min(nextOffset + chunkSize, bytes.length);
      const chunk = bytes.slice(nextOffset, end);
      const chunkOffset = nextOffset;
      nextOffset = end;

      this._emitDebug({
        phase: "ota_chunk_tx",
        msgType: MSG.OTA_CHUNK_REQ,
        msgName: msgTypeName(MSG.OTA_CHUNK_REQ),
        offset: chunkOffset,
        length: chunk.length,
      });

      inFlight.push({
        offset: chunkOffset,
        length: chunk.length,
        promise: this.otaChunk(chunkOffset, chunk, {
          chunkTimeoutMs: opts.chunkTimeoutMs,
        }),
      });

      return true;
    };

    while (inFlight.length < chunkWindow && enqueueChunk()) {
      // Fill initial window.
    }

    while (inFlight.length > 0) {
      const current = inFlight.shift();
      let rsp;
      try {
        rsp = await current.promise;
      } catch (err) {
        throw new Error(`OTA chunk failed at offset ${current.offset}: ${err?.message || err}`);
      }

      if (rsp.status !== STATUS.OK) {
        return {
          status: rsp.status,
          sent: acknowledged,
          crc32: totalCrc32,
          phase: "chunk",
          chunkRequestId: rsp.requestId,
          chunkOffset: current.offset,
          chunkLength: current.length,
          accepted: rsp.accepted,
          error: {
            code: rsp.status,
            name: statusName(rsp.status),
          },
        };
      }

      if (rsp.accepted !== current.length) {
        throw new Error(`OTA chunk acceptance mismatch (offset=${current.offset}, len=${current.length}, accepted=${rsp.accepted})`);
      }

      acknowledged += rsp.accepted;

      if (opts.onProgress) {
        try {
          opts.onProgress(acknowledged, bytes.length);
        } catch (err) {
          // Keep upload flow alive even if UI callback throws.
        }
      }

      while (inFlight.length < chunkWindow && enqueueChunk()) {
        // Keep a steady in-flight window for throughput.
      }
    }

    let commitRsp;
    try {
      commitRsp = await this.otaCommit({
        commitTimeoutMs: opts.commitTimeoutMs,
      });
    } catch (err) {
      throw new Error(`OTA commit failed: ${err?.message || err}`);
    }
    if (commitRsp.status !== STATUS.OK) {
      const commitReason = commitRsp.body.length > 0 ? commitRsp.body[0] : 0;
      return {
        status: commitRsp.status,
        sent: acknowledged,
        crc32: totalCrc32,
        phase: "commit",
        commitRequestId: commitRsp.requestId,
        error: {
          code: commitRsp.status,
          name: statusName(commitRsp.status),
          reason: commitReason,
          reasonName: otaReasonName(commitReason),
          bodyHex: bytesToHex(commitRsp.body),
        },
      };
    }

    return {
      status: commitRsp.status,
      sent: acknowledged,
      crc32: totalCrc32,
      phase: "done",
      beginRequestId: beginRsp.requestId,
      commitRequestId: commitRsp.requestId,
    };
  }

  async readFileAll(path, chunkSize = null, maxBytes = 4 * 1024 * 1024) {
    const pathLen = textToBytes(path).length;
    const autoChunk = this._maxReadChunkForPath(pathLen);
    const effectiveChunk = chunkSize == null ? autoChunk : Math.min(chunkSize, autoChunk);
    if (effectiveChunk < 1) {
      throw new Error(`Path too long for current BLE transport: ${path}`);
    }

    let offset = 0;
    const chunks = [];

    while (offset < maxBytes) {
      const rsp = await this.read(path, offset, effectiveChunk);
      if (rsp.status !== STATUS.OK) {
        return rsp;
      }

      const got = rsp.data.length;
      if (got > 0) {
        chunks.push(rsp.data);
      }

      offset += got;
      if (got < effectiveChunk) {
        break;
      }
    }

    const out = concatBytes(chunks);
    return {
      status: STATUS.OK,
      data: out,
      text: bytesToText(out),
    };
  }

  async writeFileAll(path, data, chunkSize = null) {
    const bytes = typeof data === "string" ? textToBytes(data) : data;
    const pathLen = textToBytes(path).length;
    const autoChunk = this._maxWriteChunkForPath(pathLen);
    const effectiveChunk = chunkSize == null ? autoChunk : Math.min(chunkSize, autoChunk);
    if (effectiveChunk < 1) {
      throw new Error(`Path too long for current BLE transport: ${path}`);
    }

    let offset = 0;

    while (offset < bytes.length) {
      const end = Math.min(bytes.length, offset + effectiveChunk);
      const chunk = bytes.slice(offset, end);
      const rsp = await this.write(path, offset, chunk);

      if (rsp.status !== STATUS.OK) {
        return rsp;
      }

      if (rsp.written <= 0) {
        throw new Error("Write returned 0 bytes");
      }

      offset += rsp.written;
    }

    return {
      status: STATUS.OK,
      written: offset,
    };
  }

  async sendRequest(type, payload, opts = {}) {
    this._assertConnected();

    const runRequest = async () => {
      this._assertConnected();

      const timeoutMs = opts.timeoutMs || 3000;
      const expectType = opts.expectType;
      const requestId = opts.requestId;
      const requestIdInHeader = opts.requestIdInHeader !== false;

      return new Promise(async (resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(entry);
          reject(new Error(`Timed out waiting for BLE response (type=${msgTypeName(type)}, reqId=${requestId == null ? "n/a" : requestId})`));
        }, timeoutMs);

        const entry = {
          expectType,
          requestId,
          requestIdInHeader,
          resolve: (packet) => {
            clearTimeout(timer);
            resolve(packet);
          },
          reject: (err) => {
            clearTimeout(timer);
            reject(err);
          },
        };

        this.pending.add(entry);

        try {
          this._emitDebug({
            phase: "tx",
            msgType: type,
            msgName: msgTypeName(type),
            requestId: requestId == null ? null : requestId,
            payloadLen: payload ? payload.length : 0,
          });
          await this.sendRaw(type, payload);
        } catch (err) {
          this.pending.delete(entry);
          clearTimeout(timer);
          reject(err);
        }
      });
    };

    const queued = this.requestLock.then(runRequest, runRequest);
    this.requestLock = queued.catch(() => {});
    return queued;
  }

  _onNotification(event) {
    let packet;
    try {
      const dv = event.target.value;
      const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
      packet = decodePacket(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    } catch (err) {
      return;
    }

    for (const cb of this.listeners) {
      try {
        cb(packet);
      } catch (err) {
        // Keep listeners isolated.
      }
    }

    for (const entry of [...this.pending]) {
      if (entry.expectType != null && packet.type !== entry.expectType) {
        continue;
      }

      if (entry.requestId != null && entry.requestIdInHeader) {
        if (packet.payload.length < 3) {
          continue;
        }
        const rspReqId = packet.payload[1] | (packet.payload[2] << 8);
        if (rspReqId !== entry.requestId) {
          continue;
        }
      }

      this.pending.delete(entry);
      entry.resolve(packet);
      break;
    }
  }

  _onDisconnected() {
    if (this.device) {
      this.knownDevice = this.device;
    }

    this.device = this.knownDevice;
    this.server = null;
    this.service = null;
    this.characteristic = null;
    this.writeCharacteristic = null;
    this.notifyCharacteristic = null;
    for (const cb of this.disconnectListeners) {
      try {
        cb();
      } catch (err) {
        // Keep listeners isolated.
      }
    }
    this._rejectPending(new Error("Device disconnected"));
  }

  _rejectPending(err) {
    for (const entry of [...this.pending]) {
      this.pending.delete(entry);
      entry.reject(err);
    }
  }

  _nextRequestId() {
    const out = this.requestId;
    this.requestId = (this.requestId + 1) & 0xffff;
    if (this.requestId === 0) {
      this.requestId = 1;
    }
    return out;
  }

  _assertConnected() {
    if (!this.isConnected()) {
      throw new Error("BLE not connected");
    }
  }
}

window.RetroWatchBle = {
  RetroWatchBleClient,
  MSG,
  STATUS,
  OTA_ERROR_REASON,
  msgTypeName,
  statusName,
  crc32,
  SERVICE_UUID,
  CHARACTERISTIC_UUID,
  RX_CHARACTERISTIC_UUID,
  TX_CHARACTERISTIC_UUID,
  decodePacket,
  encodePacket,
};