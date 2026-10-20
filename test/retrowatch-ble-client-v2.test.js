const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({ window: {} });
const clientSource = fs.readFileSync(
  path.join(__dirname, 'retrowatch-ble-client-v2.js'),
  'utf8'
);
vm.runInContext(clientSource, context);

const BLE = context.window.RetroWatchBle;

test('framebuffer response parser validates and reads RGB565 chunks', () => {
  const payload = Uint8Array.from([
    BLE.STATUS.OK,
    0x34, 0x12,
    1,
    16, 0, 0, 0,
    2, 0,
    0xaa, 0xbb,
  ]);

  const response = BLE.parseFramebufferDumpResponse(payload, 0x1234);
  assert.equal(response.requestId, 0x1234);
  assert.equal(response.hasMore, true);
  assert.equal(response.nextOffset, 16);
  assert.deepEqual(Array.from(response.chunk), [0xaa, 0xbb]);
  assert.throws(() => BLE.parseFramebufferDumpResponse(payload, 0x1235), /request ID mismatch/);
});

test('framebuffer capture requests contiguous chunks and reports progress', async () => {
  const client = Object.create(BLE.RetroWatchBleClient.prototype);
  const totalBytes = BLE.FRAMEBUFFER_WIDTH * BLE.FRAMEBUFFER_HEIGHT * 2;
  client.maxMessagePayloadBytes = BLE.MAX_PAYLOAD;
  client._assertConnected = () => {};
  let nextRequestId = 1;
  let requestCount = 0;
  client._nextRequestId = () => nextRequestId++;
  client.sendRequest = async (type, payload, options) => {
    assert.equal(type, BLE.MSG.FB_DUMP_REQ);
    assert.equal(options.expectType, BLE.MSG.FB_DUMP_RSP);

    const request = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const requestId = request.getUint16(0, true);
    const offset = request.getUint32(2, true);
    const requestedLength = request.getUint16(6, true);
    const chunkLength = Math.min(requestedLength, totalBytes - offset);
    const nextOffset = offset + chunkLength;
    const responsePayload = new Uint8Array(10 + chunkLength);
    const response = new DataView(responsePayload.buffer);
    responsePayload[0] = BLE.STATUS.OK;
    response.setUint16(1, requestId, true);
    responsePayload[3] = nextOffset < totalBytes ? 1 : 0;
    response.setUint32(4, nextOffset, true);
    response.setUint16(8, chunkLength, true);
    for (let index = 0; index < chunkLength; index++) {
      responsePayload[10 + index] = (offset + index) & 0xff;
    }
    requestCount++;
    return { payload: responsePayload };
  };

  let lastProgress = null;
  const framebuffer = await client.captureFramebuffer({
    onProgress: (captured, total) => {
      lastProgress = [captured, total];
    },
  });

  assert.equal(framebuffer.width, BLE.FRAMEBUFFER_WIDTH);
  assert.equal(framebuffer.height, BLE.FRAMEBUFFER_HEIGHT);
  assert.equal(framebuffer.pixels.length, totalBytes);
  assert.deepEqual(Array.from(framebuffer.pixels.slice(0, 4)), [0, 1, 2, 3]);
  assert.equal(framebuffer.pixels[totalBytes - 1], (totalBytes - 1) & 0xff);
  assert.ok(requestCount > 1);
  assert.deepEqual(lastProgress, [totalBytes, totalBytes]);
});
