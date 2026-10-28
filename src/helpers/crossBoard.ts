import update from 'immutability-helper';
import { App, Notice, TFile } from 'obsidian';
import { StateManager } from 'src/StateManager';
import { Path } from 'src/dnd/types';
import { removeEntity } from 'src/dnd/util/data';
import { t } from 'src/lang/helpers';
import KanbanPlugin from 'src/main';
import { completeString, frontmatterKey } from 'src/parsers/common';
import { indentNewLines } from 'src/parsers/helpers/parser';

import { Item } from '../components/types';

export function getBoardLabel(plugin: KanbanPlugin, file: TFile) {
  return plugin.settings['board-switcher-labels']?.[file.path] || file.basename;
}

export function getKanbanFiles(app: App, exclude?: string) {
  return app.vault
    .getMarkdownFiles()
    .filter((f) => {
      if (f.path === exclude) return false;
      const cache = app.metadataCache.getFileCache(f);
      return cache?.frontmatter && cache.frontmatter[frontmatterKey];
    })
    .sort((a, b) => a.basename.localeCompare(b.basename));
}

// Lane names of a board that may not be open, read from the metadata cache.
export function getLaneNames(app: App, file: TFile): string[] {
  const cache = app.metadataCache.getFileCache(file);
  return (cache?.headings || [])
    .filter((h) => h.level === 2 && h.heading !== t('Archive'))
    .map((h) => h.heading);
}

// Insert the item line at the top of lane `laneIdx` in raw markdown.
function insertIntoMarkdown(content: string, laneIdx: number, line: string) {
  const lines = content.split('\n');
  let lane = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^## (.+)$/);
    if (!m || m[1] === t('Archive')) continue;
    if (++lane !== laneIdx) continue;
    let ins = i + 1;
    while (ins < lines.length && lines[ins].trim() === '') ins++;
    if (lines[ins] === completeString) ins++;
    lines.splice(ins, 0, line);
    return lines.join('\n');
  }
  return null;
}

// Move an item from the current board to the top of a lane on another board.
// An open target board is updated through its StateManager; a closed one
// through its file.
export async function sendItemToBoard(
  sourceSM: StateManager,
  sourcePath: Path,
  item: Item,
  targetFile: TFile,
  laneIdx: number
) {
  const plugin = sourceSM.getAView().plugin;
  const targetSM = plugin.stateManagers.get(targetFile);
  const { titleRaw, checkChar } = item.data;
  if (targetSM === sourceSM) return false;
  if (sourceSM.state.children[sourcePath[0]]?.children[sourcePath[1]]?.id !== item.id) return false;

  try {
    let targetBefore: ReturnType<typeof plugin.undoManager.capture>;
    let markdownChange: { file: TFile; beforeMd: string; afterMd: string; undoEnabled: boolean };
    if (targetSM) {
      if (!targetSM.state.children[laneIdx]) throw new Error('Destination list no longer exists');
      targetBefore = plugin.undoManager.capture(targetSM);
      const newItem = targetSM.getNewItem(titleRaw, checkChar);
      targetSM.setState((board) =>
        update(board, {
          children: { [laneIdx]: { children: { $unshift: [newItem] } } },
        })
      );
      if (!targetSM.state.children[laneIdx]?.children.includes(newItem)) {
        throw new Error('Could not insert the card');
      }
    } else {
      const line = `- [${checkChar}] ${indentNewLines(titleRaw)}`;
      // Vault.process serializes read-modify-write operations on this file.
      await plugin.app.vault.process(targetFile, (content) => {
        const next = insertIntoMarkdown(content, laneIdx, line);
        if (next === null) throw new Error('Destination list no longer exists');
        const footer = content.match(/%% kanban:settings\s*```\s*([\s\S]*?)```/);
        const localSettings = footer ? JSON.parse(footer[1]) : {};
        const frontmatter = plugin.app.metadataCache.getFileCache(targetFile)?.frontmatter;
        markdownChange = {
          file: targetFile,
          beforeMd: content,
          afterMd: next,
          undoEnabled:
            (frontmatter?.['enable-undo'] ??
              localSettings['enable-undo'] ??
              plugin.settings['enable-undo']) !== false,
        };
        return next;
      });
    }

    // The source may have changed while a closed destination was being written.
    const sourceBefore = plugin.undoManager.capture(sourceSM);
    sourceSM.setState((board) => {
      for (let lane = 0; lane < board.children.length; lane++) {
        const index = board.children[lane].children.findIndex((card) => card.id === item.id);
        if (index < 0) continue;
        const currentPath: Path = [lane, index];
        return removeEntity(board, currentPath);
      }
      return board;
    });
    plugin.undoManager.record(
      t('Move card'),
      targetBefore ? [sourceBefore, targetBefore] : [sourceBefore],
      markdownChange ? [markdownChange] : []
    );
    return true;
  } catch (error) {
    new Notice(t('The card could not be moved. Check the destination board and try again.'));
    return false;
  }
}
