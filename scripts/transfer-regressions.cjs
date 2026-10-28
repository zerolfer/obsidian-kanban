const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

function loadModule(filename, dependencies, cache = new Map()) {
  const absolute = path.resolve(filename);
  if (cache.has(absolute)) return cache.get(absolute).exports;
  const module = { exports: {} };
  cache.set(absolute, module);
  const source = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2018,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(
    'Array.prototype.last = function () { return this[this.length - 1]; };\n' + source,
    {
      module,
      exports: module.exports,
      console,
      require: (name) => {
        if (Object.hasOwn(dependencies, name)) return dependencies[name];
        if (name.startsWith('.') || name.startsWith('src/')) {
          const resolved = name.startsWith('.')
            ? path.resolve(path.dirname(absolute), name)
            : path.resolve(name);
          return loadModule(resolved + '.ts', dependencies, cache);
        }
        return require(name);
      },
    },
    { filename }
  );
  return module.exports;
}

function fixture(sourceUndo = true, targetUndo = true, closed = false) {
  const notices = [];
  const files = new Map();
  const managers = new Map();
  const plugin = {
    settings: {},
    stateManagers: managers,
    getStateManager: (file) => managers.get(file),
    app: {
      vault: {
        cachedRead: async (file) => files.get(file),
        read: async (file) => files.get(file),
        modify: async (file, text) => {
          files.set(file, text);
        },
        process: async (file, transform) => {
          const next = transform(files.get(file));
          files.set(file, next);
          return next;
        },
      },
      metadataCache: { getFileCache: () => ({}) },
    },
  };
  const dependencies = {
    obsidian: {
      Notice: class {
        constructor(text) {
          notices.push(text);
        }
      },
    },
    './lang/helpers': { t: (text) => text },
    'src/lang/helpers': { t: (text) => text },
    'src/parsers/common': { completeString: '**Complete**', frontmatterKey: 'kanban-plugin' },
    'src/parsers/helpers/parser': {
      indentNewLines: (text) => text.trim().replace(/\n/g, '\n    '),
    },
  };
  const { KanbanUndoManager } = loadModule('src/UndoManager.ts', dependencies);
  const { sendItemToBoard } = loadModule('src/helpers/crossBoard.ts', dependencies);
  plugin.undoManager = new KanbanUndoManager(plugin);
  const item = {
    id: 'card',
    type: 'item',
    children: [],
    data: { titleRaw: 'Keep me', checkChar: ' ', metadata: {} },
  };
  const makeManager = (name, cards, enabled) => {
    const file = { path: name + '.md' };
    const manager = {
      file,
      app: plugin.app,
      viewSet: new Set(),
      state: {
        data: { settings: {}, errors: [] },
        children: [{ id: 'lane', data: {}, children: cards }],
      },
      getSetting: (key) =>
        key === 'enable-undo' ? enabled : key === 'show-undo-notice' ? false : undefined,
      getAView: () => ({ plugin }),
      parser: { boardToMd: (board) => JSON.stringify(board) },
      getParsedBoard: (text) => JSON.parse(text),
      getNewItem: (titleRaw, checkChar) => ({
        ...item,
        id: 'target-card',
        data: { titleRaw, checkChar },
      }),
      setState: (updater) => {
        manager.state = typeof updater === 'function' ? updater(manager.state) : updater;
        files.set(file, manager.parser.boardToMd(manager.state));
      },
    };
    managers.set(file, manager);
    files.set(file, manager.parser.boardToMd(manager.state));
    return manager;
  };
  const source = makeManager('Source', [item], sourceUndo);
  const target = makeManager('Target', [], targetUndo);
  if (closed) {
    managers.delete(target.file);
    files.set(target.file, '---\nkanban-plugin: board\n---\n\n## Todo\n\n');
  }
  const cardPath = [0, 0];
  cardPath.last = () => cardPath[cardPath.length - 1];
  return { plugin, source, target, item, cardPath, files, notices, sendItemToBoard };
}

for (const [sourceUndo, targetUndo] of [
  [false, true],
  [true, false],
]) {
  test(`multi-board undo never records half a move (${sourceUndo}/${targetUndo})`, async () => {
    const f = fixture(sourceUndo, targetUndo);
    const before = [f.plugin.undoManager.capture(f.source), f.plugin.undoManager.capture(f.target)];
    f.source.setState((board) => ({
      ...board,
      children: [{ ...board.children[0], children: [] }],
    }));
    f.target.setState((board) => ({
      ...board,
      children: [{ ...board.children[0], children: [f.item] }],
    }));
    f.plugin.undoManager.record('Move card', before);
    assert.equal(f.plugin.undoManager.canUndo(), false);
  });
}

test('overlapping undo calls preserve both history entries', async () => {
  const f = fixture();
  f.plugin.undoManager.run('first', f.source, (board) => ({
    ...board,
    data: { ...board.data, value: 1 },
  }));
  const first = f.source.state;
  f.plugin.undoManager.run('second', f.source, (board) => ({
    ...board,
    data: { ...board.data, value: 2 },
  }));
  await Promise.all([f.plugin.undoManager.undoLast(), f.plugin.undoManager.undoLast()]);
  assert.equal(f.source.state, first);
  assert.equal(f.plugin.undoManager.canUndo(), true);
  await f.plugin.undoManager.undoLast();
  assert.equal(f.source.state.data.value, undefined);
  await f.plugin.undoManager.redoLast();
  assert.equal(f.source.state.data.value, 1);
  await f.plugin.undoManager.redoLast();
  assert.equal(f.source.state.data.value, 2);
});

test('a missing destination lane keeps the source card', async () => {
  const f = fixture();
  f.target.state.children = [];
  await f.sendItemToBoard(f.source, f.cardPath, f.item, f.target.file, 0);
  assert.equal(f.source.state.children[0].children.length, 1);
});

test('a failed closed-board write keeps the source card', async () => {
  const f = fixture(true, true, true);
  const fail = async () => {
    throw new Error('Disk unavailable');
  };
  f.plugin.app.vault.modify = fail;
  f.plugin.app.vault.process = fail;
  await f.sendItemToBoard(f.source, f.cardPath, f.item, f.target.file, 0);
  assert.equal(f.source.state.children[0].children.length, 1);
});

test('a missing lane in a closed board keeps the source card', async () => {
  const f = fixture(true, true, true);
  f.files.set(f.target.file, '# No lanes\n');
  await f.sendItemToBoard(f.source, f.cardPath, f.item, f.target.file, 0);
  assert.equal(f.source.state.children[0].children.length, 1);
});

test('open-board menu transfer undoes and redoes both boards together', async () => {
  const f = fixture();
  await f.sendItemToBoard(f.source, f.cardPath, f.item, f.target.file, 0);
  assert.equal(f.source.state.children[0].children.length, 0);
  assert.equal(f.target.state.children[0].children.length, 1);
  assert.equal(f.plugin.undoManager.canUndo(), true);
  await f.plugin.undoManager.undoLast();
  assert.equal(f.source.state.children[0].children.length, 1);
  assert.equal(f.target.state.children[0].children.length, 0);
  await f.plugin.undoManager.redoLast();
  assert.equal(f.source.state.children[0].children.length, 0);
  assert.equal(f.target.state.children[0].children.length, 1);
});

test('closed-board menu transfer undoes and redoes both files together', async () => {
  const f = fixture(true, true, true);
  const original = f.files.get(f.target.file);
  await f.sendItemToBoard(f.source, f.cardPath, f.item, f.target.file, 0);
  const transferred = f.files.get(f.target.file);
  assert.match(transferred, /- \[ \] Keep me/);
  assert.equal(f.source.state.children[0].children.length, 0);
  await f.plugin.undoManager.undoLast();
  assert.equal(f.source.state.children[0].children.length, 1);
  assert.equal(f.files.get(f.target.file), original);
  await f.plugin.undoManager.redoLast();
  assert.equal(f.source.state.children[0].children.length, 0);
  assert.equal(f.files.get(f.target.file), transferred);
});

test('failed closed-board undo keeps both boards and its history intact', async () => {
  const f = fixture(true, true, true);
  await f.sendItemToBoard(f.source, f.cardPath, f.item, f.target.file, 0);
  const after = f.files.get(f.target.file);
  f.plugin.app.vault.modify = async () => {
    throw new Error('Disk unavailable');
  };
  await assert.doesNotReject(() => f.plugin.undoManager.undoLast());
  assert.equal(f.source.state.children[0].children.length, 0);
  assert.equal(f.files.get(f.target.file), after);
  assert.equal(f.plugin.undoManager.canUndo(), true);
});

test('undoing a delayed transfer preserves intervening source edits', async () => {
  const f = fixture(true, true, true);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const processFile = f.plugin.app.vault.process;
  f.plugin.app.vault.process = async (...args) => {
    await gate;
    return processFile(...args);
  };
  const transferring = f.sendItemToBoard(f.source, f.cardPath, f.item, f.target.file, 0);
  const other = { ...f.item, id: 'other-card' };
  f.source.setState((board) => ({
    ...board,
    children: [{ ...board.children[0], children: [other, f.item] }],
  }));
  release();
  await transferring;
  assert.deepEqual(
    f.source.state.children[0].children.map((card) => card.id),
    ['other-card']
  );
  await f.plugin.undoManager.undoLast();
  assert.deepEqual(
    f.source.state.children[0].children.map((card) => card.id),
    ['other-card', 'card']
  );
});
