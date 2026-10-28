const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

function runtime(enabledPlugins = []) {
  const app = {
    plugins: {
      enabledPlugins: new Set(enabledPlugins),
      plugins: { dataview: {}, 'obsidian-tasks-plugin': {} },
    },
  };
  let search = null;
  const hooks = {
    useMemo: (factory) => factory(),
    useEffect: () => {},
    useContext: () => search,
    useRef: (value) => ({ current: value }),
    useState: (value) => [value, () => {}],
    useCallback: (callback) => callback,
  };
  const external = {
    obsidian: { moment: require('moment') },
    'preact/compat': hooks,
    'preact/hooks': hooks,
    'src/lang/helpers': { t: (text) => text },
    'src/helpers': {},
    '../common': { archiveString: '***', completeString: '**Complete**' },
    '../parseMarkdown': {},
    '../Item/ItemContent': {},
    '../Item/MetadataTable': {},
    '../context': { IntersectionObserverContext: { Provider: 'observer' } },
    '../Icon/Icon': { Icon: 'icon' },
    './Cells': {},
  };
  const cache = new Map();
  function load(filename) {
    const absolute = path.resolve(filename);
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const module = { exports: {} };
    cache.set(absolute, module);
    const source = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2018,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        jsxImportSource: 'preact',
      },
    }).outputText;
    vm.runInNewContext(
      source,
      {
        module,
        exports: module.exports,
        app,
        require: (name) => {
          if (Object.hasOwn(external, name)) return external[name];
          if (name.startsWith('.') || name.startsWith('src/')) {
            const resolved = name.startsWith('.')
              ? path.resolve(path.dirname(absolute), name)
              : path.resolve(name);
            return load(fs.existsSync(resolved + '.ts') ? resolved + '.ts' : resolved + '.tsx');
          }
          return require(name);
        },
      },
      { filename }
    );
    return module.exports;
  }
  return {
    load,
    setExternal: (name, value) => {
      external[name] = value;
    },
    setSearch: (value) => {
      search = value;
    },
  };
}

function fixture(enabledPlugins = []) {
  const r = runtime(enabledPlugins);
  const { fromMarkdown } = require('mdast-util-from-markdown');
  const taskList = r.load('src/parsers/extensions/taskList.ts');
  const { listItemToItemData } = r.load('src/parsers/formats/list.ts');
  const helpers = r.load('src/components/helpers.ts');
  const settings = {
    'date-trigger': '@',
    'time-trigger': '@@',
    'inline-metadata-position': 'body',
    'metadata-keys': [],
  };
  const manager = {
    app: {},
    getSetting: (key) => settings[key],
    useSetting: (key) => settings[key],
  };
  function card(id, title) {
    const md = '- [ ] ' + title;
    const ast = fromMarkdown(md, {
      extensions: [taskList.gfmTaskListItem],
      mdastExtensions: [taskList.gfmTaskListItemFromMarkdown],
    });
    // Obsidian adds these Array helpers; they are used by the production Markdown reader.
    function decorate(value) {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        Object.defineProperty(value, 'first', {
          value() {
            return this[0];
          },
        });
        Object.defineProperty(value, 'last', {
          value() {
            return this[this.length - 1];
          },
        });
        value.forEach(decorate);
      } else Object.values(value).forEach(decorate);
    }
    decorate(ast);
    return { id, data: listItemToItemData(manager, md, ast.children[0].children[0]) };
  }
  const items = [
    card('ana', 'Revisar propuesta [assignee:: Ana]'),
    card('luis', 'Revisar presupuesto [assignee:: Luis]'),
  ];
  return {
    ...r,
    helpers,
    manager,
    items,
    board: { children: [{ data: { title: 'Todo' }, children: items }] },
  };
}

test('bracket fields are parsed with no Dataview or Tasks installed', () => {
  const { extractInlineFields } = runtime().load('src/parsers/helpers/inlineMetadata.ts');
  assert.deepEqual(
    Array.from(extractInlineFields('Revisar [assignee:: Ana]', true), ({ key, value }) => [
      key,
      value,
    ]),
    [['assignee', 'Ana']]
  );
});

test('raw Markdown cards populate the assignee filter without Dataview', () => {
  const f = fixture();
  const options = f.helpers.collectInlineFieldOptions(f.board);
  assert.deepEqual(Array.from(options.keys()), ['assignee']);
  assert.deepEqual(Array.from(options.get('assignee')), ['Ana', 'Luis']);
  const matches = f.helpers.useFieldFilterMatches(f.board, { key: 'assignee', value: 'Ana' });
  assert.deepEqual(
    Array.from(matches.items, (item) => item.id),
    ['ana']
  );
});

test('table filtering uses fields read from raw Markdown and retains edit paths', () => {
  const f = fixture();
  const matches = f.helpers.useFieldFilterMatches(f.board, { key: 'assignee', value: 'Ana' });
  f.setSearch({ query: '', isFiltering: true, ...matches });
  const table = f.load('src/components/Table/helpers.tsx').useTableColumns(f.board, f.manager);
  assert.deepEqual(
    Array.from(table.data, (row) => row.item.id),
    ['ana']
  );
  assert.deepEqual(Array.from(table.data[0].path), [0, 0]);
});

test('Dataview installations keep the same bracket field parsing', () => {
  const f = fixture(['dataview']);
  assert.deepEqual(Array.from(f.helpers.collectInlineFieldOptions(f.board).get('assignee')), [
    'Ana',
    'Luis',
  ]);
});

test('table rows keep the identity of their cards when filtering changes their positions', () => {
  const f = fixture();
  const tableApi = require('@tanstack/react-table');
  let renderedTable;
  f.setExternal('@tanstack/react-table', {
    ...tableApi,
    useReactTable: (options) => {
      renderedTable = tableApi.createTable({
        ...options,
        onStateChange: () => {},
        renderFallbackValue: null,
      });
      renderedTable.setOptions((previous) => ({
        ...previous,
        state: { ...renderedTable.initialState, ...options.state },
      }));
      return renderedTable;
    },
  });
  f.manager.app = { vault: { getConfig: () => false } };
  const { TableView } = f.load('src/components/Table/Table.tsx');
  TableView({ boardData: f.board, stateManager: f.manager });
  const before = renderedTable
    .getCoreRowModel()
    .rows.find((row) => row.original.item.id === 'luis').id;
  const matches = f.helpers.useFieldFilterMatches(f.board, { key: 'assignee', value: 'Luis' });
  f.setSearch({ query: '', isFiltering: true, ...matches });
  TableView({ boardData: f.board, stateManager: f.manager });
  const rows = renderedTable.getCoreRowModel().rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].original.item.id, 'luis');
  assert.equal(rows[0].id, before);
});
