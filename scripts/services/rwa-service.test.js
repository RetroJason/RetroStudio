const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global.window || {};

require('./rwa-service.js');
require('./rwp-service.js');

test('makeAppIni emits the saved watch-face category as runtime type', () => {
  const service = new window.RwaService(null);

  const ini = service.makeAppIni('Digital', {
    category: 'watch',
    packageKind: 'rwa',
    title: 'Digital',
    author: 'Retro Watch Co',
    version: '1.0.0',
    description: 'Digital watch face',
    icons: { icon32: 'icon32.png', icon128: 'icon128.png' },
    screenshots: [],
    videos: [],
  });

  assert.match(ini, /^type = watch$/m);
  assert.doesNotMatch(ini, /^icon32 = /m);
  assert.doesNotMatch(ini, /^icon128 = /m);
});

test('makeAppIni keeps runtime icons for non-watch app categories', () => {
  const service = new window.RwaService(null);

  const ini = service.makeAppIni('Counter', {
    category: 'lua_app',
    packageKind: 'rwa',
    title: 'Counter',
    author: 'Retro Watch Co',
    version: '1.0.0',
    description: 'Counter app',
    icons: { icon32: 'icon32.d2', icon128: 'icon128.d2' },
    screenshots: [],
    videos: [],
  });

  assert.match(ini, /^icon32 = icon32\.d2$/m);
  assert.match(ini, /^icon128 = icon128\.d2$/m);
});

test('makeAppIni requires a category when synthesizing app.ini', () => {
  const service = new window.RwaService(null);

  assert.throws(
    () => service.makeAppIni('Digital', {
      packageKind: 'rwa',
      title: 'Digital',
      author: 'Retro Watch Co',
      version: '1.0.0',
      description: 'Digital watch face',
      icons: { icon32: '', icon128: '' },
      screenshots: [],
      videos: [],
    }),
    /Category is required for app\.ini/,
  );
});

test('buildPackageIni emits the saved category in package.ini', () => {
  const service = new window.RwpService(null);

  const ini = service.buildPackageIni(
    'Digital',
    {
      uniqueId: 'digital-watch',
      category: 'watch',
      targetDeviceSlug: 'retrowatch-classic',
      shortDescription: 'Digital watch face',
      description: 'Digital watch face',
      version: '1.0.0',
      versionCode: 1,
      title: 'Digital',
      author: 'Retro Watch Co',
      icons: { icon32: 'Sources/Package/icons/icon32.png' },
      screenshots: [],
      videos: [],
    },
    { filename: 'Digital.rwa' },
    '0.9.3',
  );

  assert.match(ini, /^category=watch$/m);
});