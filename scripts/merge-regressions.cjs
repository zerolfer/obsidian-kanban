const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const ts = require('typescript');

// Obsidian supplies these APIs at runtime. Keep note-title and card-update logic real.
function loadItemMenu() {
  const filename = 'src/components/Item/ItemMenu.ts';
  const source = process.env.TEST_REVISION
    ? execFileSync('git', ['show', `${process.env.TEST_REVISION}:${filename}`], {
        encoding: 'utf8',
      })
    : fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
  const actions = new Map();
  class Menu {
    addItem(callback) {
      const item = {
        setIcon() {
          return this;
        },
        setTitle(title) {
          this.title = title;
          return this;
        },
        setChecked() {
          return this;
        },
        onClick(action) {
          actions.set(this.title, action);
          return this;
        },
        setSubmenu() {
          return new Menu();
        },
      };
      callback(item);
      return this;
    }
    addSeparator() {
      return this;
    }
    showAtPosition() {}
  }
  class TFolder {}
  const module = { exports: {} };
  const dependencies = {
    obsidian: { Menu, Notice: class {}, TFile: class {}, TFolder, Platform: { isPhone: false } },
    'preact/hooks': { useCallback: (callback) => callback },
    'src/lang/helpers': { t: (text) => text },
    '../helpers': {
      applyTemplate: async () => {},
      escapeRegExpStr: (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      generateInstanceId: () => 'test-id',
    },
    './helpers': {},
    '../../helpers/crossBoard': {},
    'src/dnd/util/data': {},
  };
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 },
  }).outputText;
  vm.runInNewContext(
    compiled,
    {
      module,
      exports: module.exports,
      require: (name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)),
    },
    { filename }
  );
  return { useItemMenu: module.exports.useItemMenu, actions, TFolder };
}

async function createNote(titleRaw, settings = {}) {
  const { useItemMenu, actions, TFolder } = loadItemMenu();
  let noteTitle;
  let cardTitle;
  const values = {
    'date-trigger': '@',
    'time-trigger': '@@',
    'clean-tags-in-new-note-title': true,
    ...settings,
  };
  const stateManager = {
    file: { path: 'Board.md' },
    state: { children: [] },
    getSetting: (key) => values[key],
    getGlobalSetting: () => undefined,
    updateItemContent: (item, title) => ({ ...item, data: { ...item.data, titleRaw: title } }),
    app: {
      vault: { getAbstractFileByPath: () => null },
      fileManager: {
        getNewFileParent: () => new TFolder(),
        createNewMarkdownFile: async (folder, title) => {
          assert.ok(folder instanceof TFolder);
          noteTitle = title;
          return { path: `${title}.md` };
        },
        generateMarkdownLink: () => '[[Created note]]',
      },
      workspace: {
        splitActiveLeaf: () => ({ openFile: async () => {} }),
        setActiveLeaf: () => {},
      },
    },
  };
  const onMenu = useItemMenu({
    item: { data: { titleRaw, metadata: {} } },
    path: [0, 0],
    setEditState: () => {},
    stateManager,
    boardModifiers: {
      updateItem: (_path, item) => {
        cardTitle = item.data.titleRaw;
      },
    },
  });
  onMenu({ clientX: 0, clientY: 0 });
  await actions.get('New note from card')();
  return { noteTitle, cardTitle };
}

test('new note cleans edge tags and preserves card tags', async () => {
  assert.deepEqual(await createNote('#work Plan #urgent'), {
    noteTitle: 'Plan',
    cardTitle: '[[Created note]] #work #urgent',
  });
});

test('new note keeps date and time out of the filename and on the card', async () => {
  assert.deepEqual(await createNote('#work Plan #urgent @{2026-10-28} @@{12:30}'), {
    noteTitle: 'Plan',
    cardTitle: '[[Created note]] #work #urgent @{2026-10-28} @@{12:30}',
  });
});

test('new note preserves linked daily-note dates', async () => {
  assert.deepEqual(
    await createNote('Plan #work @[[2026-10-28]]', {
      'link-date-to-daily-note': true,
    }),
    {
      noteTitle: 'Plan',
      cardTitle: '[[Created note]] #work @[[2026-10-28]]',
    }
  );
});

test('new note preserves markdown daily-note dates', async () => {
  assert.deepEqual(
    await createNote('Plan #work @[Today](2026-10-28.md)', {
      'link-date-to-daily-note': true,
    }),
    {
      noteTitle: 'Plan',
      cardTitle: '[[Created note]] #work @[Today](2026-10-28.md)',
    }
  );
});

test('new note handles metadata inside the title without losing it', async () => {
  assert.deepEqual(await createNote('Plan @{2026-10-28} for today #work\nDescription'), {
    noteTitle: 'Plan for today',
    cardTitle: '[[Created note]] #work @{2026-10-28}\nDescription',
  });
});

test('new note keeps legacy tag naming when tag cleaning is disabled', async () => {
  assert.deepEqual(
    await createNote('#work Plan @{2026-10-28}', {
      'clean-tags-in-new-note-title': false,
    }),
    {
      noteTitle: 'work Plan',
      cardTitle: '[[Created note]] @{2026-10-28}',
    }
  );
});

test('tag-only cards still produce a usable filename and unique tags', async () => {
  assert.deepEqual(await createNote('#work #work'), {
    noteTitle: 'work work',
    cardTitle: '[[Created note]] #work',
  });
});

test('custom date and time triggers are escaped and preserved', async () => {
  assert.deepEqual(
    await createNote('Plan +{2026-10-28} ?{12:30} #work', {
      'date-trigger': '+',
      'time-trigger': '?',
    }),
    {
      noteTitle: 'Plan',
      cardTitle: '[[Created note]] #work +{2026-10-28} ?{12:30}',
    }
  );
});

function renderLane(autoCreate, insertionMethod = 'append', runtime = {}) {
  const filename = 'src/components/Lane/Lane.tsx';
  const source = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
  const context = {
    KanbanContext: {},
    SearchContext: {},
    SortContext: { Provider: 'sort-provider' },
  };
  const stateManager = {
    useSetting: (key) =>
      key === 'auto-create-note'
        ? autoCreate
        : key === 'new-card-insertion-method'
          ? insertionMethod
          : undefined,
    ...runtime.stateManager,
  };
  const dependencies = {
    obsidian: runtime.obsidian || {},
    'preact/compat': {
      Fragment: 'fragment',
      memo: (component) => component,
      useCallback: (callback) => callback,
      useMemo: (factory) => factory(),
      useRef: () => ({ current: null }),
      useState: (value) => [value, () => {}],
      useContext: (key) =>
        key === context.KanbanContext
          ? {
              stateManager,
              boardModifiers: runtime.boardModifiers || {},
              view: { useViewState: () => 'board', getWindow: () => ({ setTimeout: () => {} }) },
            }
          : null,
    },
    'src/dnd/components/Droppable': { useNestedEntityPath: () => [0], Droppable: 'droppable' },
    'src/dnd/components/ScrollContainer': { ScrollContainer: 'scroll-container' },
    'src/dnd/components/SortPlaceholder': { SortPlaceholder: 'placeholder' },
    'src/dnd/components/Sortable': { Sortable: 'sortable' },
    'src/dnd/managers/DragManager': { useDragHandle: () => () => {} },
    'src/parsers/common': { frontmatterKey: 'kanban-plugin' },
    'src/parsers/helpers/inlineMetadata': { getTaskStatusDone: () => 'x' },
    'src/lang/helpers': { t: (text) => text },
    '../Item/Item': { Items: 'items' },
    '../Item/ItemForm': { ItemForm: 'item-form' },
    '../context': context,
    '../helpers': { c: (name) => name, ...runtime.helpers },
    '../types': { DataTypes: { Item: 'item' }, EditingState: { cancel: null } },
    './LaneHeader': { LaneHeader: 'lane-header' },
  };
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2018,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        jsxImportSource: 'preact',
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      require: (name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)),
    },
    { filename }
  );
  const tree = module.exports.DraggableLane({
    lane: { id: 'lane', data: {}, children: [] },
    laneIndex: 0,
    collapseDir: 'horizontal',
  });
  const nodes = [];
  function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    nodes.push(node);
    walk(node.props?.children);
  }
  walk(tree);
  return nodes;
}

for (const insertion of ['append', 'prepend', 'prepend-compact']) {
  test(`auto-note setting leaves normal card creation available (${insertion})`, () => {
    for (const value of [false, undefined]) {
      const nodes = renderLane(value, insertion);
      const form = nodes.find((node) => node.type === 'item-form');
      assert.equal(form.props.onAutoCreate, undefined);
      const header = nodes.find((node) => node.type === 'lane-header');
      assert.equal(header.props.onAutoCreate, undefined);
    }
  });
  test(`auto-note setting enables note creation when requested (${insertion})`, () => {
    const nodes = renderLane(true, insertion);
    const form = nodes.find((node) => node.type === 'item-form');
    assert.equal(typeof form.props.onAutoCreate, 'function');
    if (insertion === 'prepend-compact') {
      const header = nodes.find((node) => node.type === 'lane-header');
      assert.equal(typeof header.props.onAutoCreate, 'function');
    }
  });
}

function autoNoteFixture(fail = false) {
  class TFolder {}
  const folder = new TFolder();
  const notes = [];
  const cards = [];
  const notices = [];
  const manager = {
    file: { path: 'Board.md', basename: 'Board' },
    state: { data: { settings: { 'auto-create-note-counter': 3 } }, children: [] },
    getSetting: (key) => (key === 'new-note-folder' ? 'Deleted folder' : undefined),
    getGlobalSetting: () => 'Valid global folder',
    setState: (updater) => {
      manager.state = updater(manager.state);
    },
    getNewItem: (titleRaw) => ({ data: { titleRaw } }),
    app: {
      vault: { getAbstractFileByPath: (name) => (name === 'Valid global folder' ? folder : null) },
      fileManager: {
        getNewFileParent: () => folder,
        createNewMarkdownFile: async (target, name) => {
          if (fail) throw new Error('Creation failed');
          assert.equal(target, folder);
          notes.push(name);
          return { path: name + '.md' };
        },
        generateMarkdownLink: () => '[[BOARD-4]]',
      },
      workspace: { splitActiveLeaf: () => ({ openFile: async () => {} }), setActiveLeaf: () => {} },
    },
  };
  const nodes = renderLane(true, 'append', {
    stateManager: manager,
    obsidian: {
      TFolder,
      Notice: class {
        constructor(text) {
          notices.push(text);
        }
      },
    },
    helpers: { resolveNoteNameFormat: () => 'BOARD-4', applyTemplate: async () => {} },
    boardModifiers: { appendItems: (_path, items) => cards.push(...items) },
  });
  return {
    manager,
    notes,
    cards,
    notices,
    create: nodes.find((node) => node.type === 'item-form').props.onAutoCreate,
  };
}

test('auto notes use the valid global folder when the local folder vanished', async () => {
  const f = autoNoteFixture();
  await f.create();
  assert.deepEqual(f.notes, ['BOARD-4']);
  assert.equal(f.cards.length, 1);
  assert.equal(f.manager.state.data.settings['auto-create-note-counter'], 4);
});

test('failed auto notes keep the counter and report the failure', async () => {
  const f = autoNoteFixture(true);
  await f.create();
  assert.equal(f.manager.state.data.settings['auto-create-note-counter'], 3);
  assert.equal(f.cards.length, 0);
  assert.equal(f.notices.length, 1);
});

test('table field filtering keeps only matching cards and their original board paths', () => {
  const filename = 'src/components/Table/helpers.tsx';
  const first = { id: 'hidden', data: { title: 'Hidden', metadata: {} } };
  const second = { id: 'matching', data: { title: 'Matching', metadata: {} } };
  const search = { query: '', isFiltering: true, items: new Set([second]) };
  const dependencies = {
    'preact/hooks': {
      useContext: () => search,
      useMemo: (factory) => factory(),
      useRef: (value) => ({ current: value }),
      useState: (value) => [value, () => {}],
      useCallback: (callback) => callback,
    },
    'src/components/helpers': { c: (name) => name },
    'src/helpers/util': {},
    'src/lang/helpers': { t: (value) => value },
    'src/parsers/helpers/inlineMetadata': { taskFields: new Set() },
    '../Item/ItemContent': {},
    '../Item/MetadataTable': {},
    '../context': { SearchContext: {} },
    './Cells': {},
  };
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2018,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        jsxImportSource: 'preact',
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      require: (name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)),
    },
    { filename }
  );
  const board = { children: [{ data: { title: 'Todo' }, children: [first, second] }] };
  const stateManager = { useSetting: () => undefined, getSetting: () => [] };
  const { data } = module.exports.useTableColumns(board, stateManager);
  assert.deepEqual(
    Array.from(data, (row) => row.item.id),
    ['matching']
  );
  assert.deepEqual(Array.from(data[0].path), [0, 1]);
  search.isFiltering = false;
  assert.equal(module.exports.useTableColumns(board, stateManager).data.length, 2);
});
