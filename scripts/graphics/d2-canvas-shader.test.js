const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'd2-canvas.js'), 'utf8');
const fragmentShader = source.match(/const FRAG_SRC = `([\s\S]*?)`;/)?.[1];

test('indexed sub-byte pixels are unpacked as a continuous D2 bitstream', () => {
  assert.ok(fragmentShader, 'fragment shader source should be present');
  assert.match(fragmentShader, /int byteOff\s*=\s*pixelIndex \/ 8;\s*int bitIdx\s*=\s*pixelIndex & 7;/);
  assert.match(fragmentShader, /int byteOff\s*=\s*pixelIndex \/ 4;\s*int shift\s*=\s*\(pixelIndex & 3\) \* 2;/);
  assert.match(fragmentShader, /int byteOff\s*=\s*pixelIndex \/ 2;/);
  assert.doesNotMatch(fragmentShader, /byteOff\s*=\s*py \* u_texStride \+ px/);
});

test('color-key matching happens before texture tinting', () => {
  assert.ok(fragmentShader, 'fragment shader source should be present');
  const keyCheck = fragmentShader.indexOf('if (u_colorKey >= 0)');
  const tint = fragmentShader.indexOf('fragColor.rgb *= u_tint.rgb;');
  assert.ok(keyCheck >= 0 && tint >= 0 && keyCheck < tint);
  assert.match(
    fragmentShader.slice(keyCheck, tint),
    /toRGB565\(fragColor\)\s*==\s*u_colorKey\)\s*discard;/
  );
});
