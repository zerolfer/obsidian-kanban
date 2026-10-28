// Type-check a Git revision against the installed dependencies without changing the checkout.
const cp = require('node:child_process');
const path = require('node:path');
const ts = require('typescript');
const revision = process.argv[2];
if (!revision) throw new Error('Usage: node scripts/typecheck-revision.cjs <revision>');
const root = process.cwd();
const records = cp
  .execFileSync('git', ['ls-tree', '-r', revision, 'src'], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .map((line) => {
    const match = line.match(/^\d+ blob ([a-f0-9]+)\t(.+)$/);
    return match && { hash: match[1], filename: match[2] };
  })
  .filter(Boolean);
const blobs = cp.execFileSync('git', ['cat-file', '--batch'], {
  input: records.map((record) => record.hash).join('\n') + '\n',
  maxBuffer: 32 * 1024 * 1024,
});
const files = new Map();
const normalize = (filename) => path.resolve(filename).replaceAll('\\', '/').toLowerCase();
let offset = 0;
for (const record of records) {
  const end = blobs.indexOf(10, offset);
  const size = Number(blobs.subarray(offset, end).toString().split(' ')[2]);
  files.set(normalize(record.filename), blobs.subarray(end + 1, end + 1 + size).toString());
  offset = end + 1 + size + 1;
}
const sourceRoot = normalize(path.join(root, 'src')) + '/';
const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const host = ts.createCompilerHost(parsed.options);
const read = host.readFile.bind(host);
const exists = host.fileExists.bind(host);
host.readFile = (filename) =>
  normalize(filename).startsWith(sourceRoot) ? files.get(normalize(filename)) : read(filename);
host.fileExists = (filename) =>
  normalize(filename).startsWith(sourceRoot) ? files.has(normalize(filename)) : exists(filename);
host.getSourceFile = (filename, languageVersion) => {
  const source = host.readFile(filename);
  return source === undefined ? undefined : ts.createSourceFile(filename, source, languageVersion);
};
const program = ts.createProgram(
  parsed.fileNames.filter(
    (filename) => !normalize(filename).startsWith(sourceRoot) || files.has(normalize(filename))
  ),
  {
    ...parsed.options,
    noEmit: true,
  },
  host
);
const diagnostics = ts.getPreEmitDiagnostics(program);
console.log(`Revision ${revision}: ${diagnostics.length} TypeScript diagnostics`);
console.log(
  ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (filename) => filename,
    getCurrentDirectory: () => root,
    getNewLine: () => '\n',
  })
);
process.exitCode = diagnostics.length ? 1 : 0;
