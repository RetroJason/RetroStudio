// rwp-import.test.js
// Regression test for shared-source imports.
//
// A shared project downloaded from /api/apps/<slug>/versions/<uuid>/package is an
// .rws workspace package (a zip wrapping a single .rwp). RetroStudio names the
// downloaded file from the x-project-source-format response header and used to
// unwrap the embedded .rwp only when that name ended in .rws. When the header was
// missing the file was named .rwp, the manifest was never found, and importProject
// silently created a project with zero files - a tile with an empty workspace.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JSZip = require('jszip');

function loadRwpService() {
  const sourcePath = path.join(__dirname, 'rwp-service.js');
  const source = fs.readFileSync(sourcePath, 'utf8');

  globalThis.window = globalThis;
  globalThis.JSZip = JSZip;
  globalThis.alert = () => {};

  vm.runInThisContext(`${source}\n;globalThis.__RwpServiceClass = RwpService;`, {
    filename: sourcePath,
  });

  return globalThis.__RwpServiceClass;
}

async function buildRwsBuffer(projectName) {
  const inner = new JSZip();
  inner.file(
    'rwp.json',
    JSON.stringify({
      format: 'retro-watch-project',
      projectName,
      files: [{ path: 'Resources/Scripts/main.lua', binary: false }],
    })
  );
  inner.file('Resources/Scripts/main.lua', 'function _init() end');
  const innerBuffer = await inner.generateAsync({ type: 'nodebuffer' });

  const outer = new JSZip();
  outer.file(`${projectName}.rwp`, innerBuffer);
  return await outer.generateAsync({ type: 'nodebuffer' });
}

function createExplorerStub() {
  const addedFiles = [];
  return {
    addedFiles,
    projectData: { structure: {} },
    addProject(name) {
      this.projectData.structure[name] = {};
    },
    setFocusedProjectName() {},
    async addFileToProject(file, folderPath) {
      addedFiles.push(`${folderPath}/${file.name}`);
    },
    renderTree() {},
  };
}

async function checkRwsImportsWhenNamedRwp() {
  const RwpService = loadRwpService();
  const projectName = 'SharedProject';
  const buffer = await buildRwsBuffer(projectName);

  const service = new RwpService(null);
  const explorer = createExplorerStub();
  service.projectExplorer = explorer;

  // Deliberately the WRONG extension: this is what the client produced before the
  // package route started sending x-project-source-format.
  const file = new File([buffer], `${projectName}.rwp`, { type: 'application/zip' });

  await service.importProject(file, { projectNameOverride: projectName });

  if (!explorer.projectData.structure[projectName]) {
    throw new Error('Project was never added to the explorer.');
  }

  if (explorer.addedFiles.length === 0) {
    throw new Error(
      'Imported an .rws named .rwp as an EMPTY project - the embedded .rwp was not unwrapped.'
    );
  }

  const expected = `${projectName}/Resources/Scripts/main.lua`;
  // The exact folder depends on window.ProjectPaths, which is not present in this
  // harness, so assert on the file itself rather than the resolved folder.
  if (!explorer.addedFiles.some((entry) => entry.endsWith('/main.lua'))) {
    throw new Error(
      `Expected the imported project to contain main.lua (e.g. ${expected}), got: ${JSON.stringify(explorer.addedFiles)}`
    );
  }
}

function checkPackageRouteSendsSourceFormat() {
  const routePath = path.resolve(
    __dirname,
    '../../../apps/web/src/app/api/apps/[slug]/versions/[versionUuid]/package/route.ts'
  );

  if (!fs.existsSync(routePath)) {
    throw new Error(`Package route not found at ${routePath}`);
  }

  const source = fs.readFileSync(routePath, 'utf8');

  if (!/"x-project-source-format":\s*sourceFormat/.test(source)) {
    throw new Error(
      'Package route no longer sends the x-project-source-format header; shared .rws downloads will import empty.'
    );
  }

  if (!/const sourceFormat =[\s\S]{0,120}source_rws[\s\S]{0,40}"rws"[\s\S]{0,20}"rwp"/.test(source)) {
    throw new Error('Package route no longer derives sourceFormat from the source_rws asset kind.');
  }
}

async function main() {
  const failures = [];

  for (const [name, check] of [
    ['rws named rwp still imports its files', checkRwsImportsWhenNamedRwp],
    ['package route sends x-project-source-format', checkPackageRouteSendsSourceFormat],
  ]) {
    try {
      await check();
      console.log(`  PASS  ${name}`);
    } catch (error) {
      failures.push(name);
      console.error(`  FAIL  ${name}: ${error.message}`);
    }
  }

  if (failures.length > 0) {
    console.error(`rwp-import.test.js: FAIL (${failures.length})`);
    process.exit(1);
  }

  console.log('rwp-import.test.js: PASS');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
