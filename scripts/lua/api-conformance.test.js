/**
 * API-wide Lua extension conformance test.
 *
 * Purpose:
 * - Ensure every API function declared in api.json is implemented.
 * - Enforce a single argument parsing path: JS positional args only.
 *   Any call into luaState.raw_tostring from extension API methods is flagged.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const STACK_READ_SENTINEL = '__STACK_READ_SENTINEL__';

function repoPath(...parts) {
  return path.resolve(__dirname, ...parts);
}

function loadApiContract() {
  const apiPath = repoPath('api.json');
  const raw = fs.readFileSync(apiPath, 'utf8');
  return JSON.parse(raw);
}

function setupGlobals() {
  global.window = global.window || {};

  const basePath = repoPath('base-lua-extension.js');
  delete require.cache[basePath];
  const exportedBase = require(basePath);

  const BaseLuaExtension = exportedBase || global.window.BaseLuaExtension;
  if (typeof BaseLuaExtension !== 'function') {
    throw new Error('Failed to load BaseLuaExtension');
  }

  global.BaseLuaExtension = BaseLuaExtension;
}

function extensionClassName(categoryName) {
  return `Lua${categoryName}Extensions`;
}

function extensionFilePath(categoryName) {
  return repoPath(`${categoryName.toLowerCase()}.js`);
}

function sampleArg(type) {
  const normalized = String(type || '').toLowerCase();
  if (normalized.includes('string')) return 'test';
  if (normalized.includes('bool')) return true;
  if (normalized.includes('float')) return 1.25;
  if (normalized.includes('int')) return 1;
  if (normalized.includes('number')) return 1;
  return 1;
}

function sampleArgsForFunction(func) {
  const parameters = Array.isArray(func.parameters) ? func.parameters : [];
  return parameters.map((param) => sampleArg(param.type));
}

function makeMockLuaState() {
  return {
    raw_tostring() {
      throw new Error(STACK_READ_SENTINEL);
    },
    type() {
      return 0;
    },
    toboolean() {
      return 0;
    },
    execute() {
      return null;
    },
  };
}

function makeMockGameEmulator() {
  return {
    getService() {
      return null;
    },
    projectExplorer: null,
    allocateRenderOrder() {
      return 1;
    },
  };
}

async function callMaybeAsync(fn, args) {
  const result = fn(...args);
  if (result && typeof result.then === 'function') {
    await result;
  }
}

async function run() {
  setupGlobals();

  const api = loadApiContract();
  const categories = (api.categories || []).filter((c) => Array.isArray(c.functions) && c.functions.length > 0);

  const missingFiles = [];
  const missingClasses = [];
  const missingMethods = [];
  const stackReadViolations = [];

  for (const category of categories) {
    const filePath = extensionFilePath(category.name);
    const className = extensionClassName(category.name);

    if (!fs.existsSync(filePath)) {
      missingFiles.push({ category: category.name, filePath });
      continue;
    }

    delete require.cache[filePath];
    const exportedClass = require(filePath);

    const ExtensionClass =
      (typeof exportedClass === 'function' ? exportedClass : null)
      || global.window[className];
    if (typeof ExtensionClass !== 'function') {
      missingClasses.push({ category: category.name, className, filePath });
      continue;
    }

    const instance = new ExtensionClass(makeMockGameEmulator());
    instance.setLuaState(makeMockLuaState());

    for (const func of category.functions) {
      const methodName = func.name;
      const method = instance[methodName];

      if (typeof method !== 'function') {
        missingMethods.push({ category: category.name, methodName });
        continue;
      }

      const args = sampleArgsForFunction(func);

      try {
        await callMaybeAsync(method.bind(instance), args);
      } catch (error) {
        const message = String(error && error.message ? error.message : error);
        if (message.includes(STACK_READ_SENTINEL)) {
          stackReadViolations.push({
            category: category.name,
            methodName,
          });
        }
      }
    }
  }

  const report = {
    categoriesChecked: categories.length,
    missingFiles,
    missingClasses,
    missingMethods,
    stackReadViolations,
  };

  console.log(JSON.stringify(report, null, 2));

  assert.strictEqual(missingFiles.length, 0, 'Missing extension files for API categories');
  assert.strictEqual(missingClasses.length, 0, 'Missing extension classes for API categories');
  assert.strictEqual(missingMethods.length, 0, 'Missing extension methods declared in API contract');
  assert.strictEqual(stackReadViolations.length, 0, 'Some API methods still read args from luaState.raw_tostring');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  run,
};
