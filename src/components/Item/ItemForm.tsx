import { EditorView } from '@codemirror/view';
import { Dispatch, StateUpdater, useContext, useEffect, useRef } from 'preact/hooks';
import useOnclickOutside from 'react-cool-onclickoutside';
import { t } from 'src/lang/helpers';

import { MarkdownEditor, allowNewLine } from '../Editor/MarkdownEditor';
import { getDropAction } from '../Editor/helpers';
import { KanbanContext } from '../context';
import { c } from '../helpers';
import { EditState, EditingState, Item, isEditing } from '../types';

interface ItemFormProps {
  addItems: (items: Item[]) => void;
  editState: EditState;
  setEditState: Dispatch<StateUpdater<EditState>>;
  hideButton?: boolean;
}

export function ItemForm({ addItems, editState, setEditState, hideButton }: ItemFormProps) {
  const { stateManager, view } = useContext(KanbanContext);
  const editorRef = useRef<EditorView>();
  const owner = useRef({});
  const drafts = view.plugin.cardDrafts;
  const editing = isEditing(editState);

  const clear = () => setEditState(EditingState.cancel);
  useEffect(() => {
    if (!editing) return;
    drafts.activate(stateManager.file.path, owner.current, clear);
    return () => drafts.release(owner.current);
  }, [editing, drafts, stateManager]);

  const clickOutsideRef = useOnclickOutside(clear, {
    ignoreClass: [c('ignore-click-outside'), 'mobile-toolbar', 'suggestion-container'],
  });

  const createItem = (title: string) => {
    if (!title.trim()) return;

    const item = stateManager.getNewItem(title, ' ');
    addItems([item]);
    if (!stateManager.state.children.some((lane) => lane.children.some((i) => i.id === item.id)))
      return;
    drafts.set(stateManager.file.path, '', owner.current);
    const cm = editorRef.current;
    if (cm) {
      cm.dispatch({
        changes: {
          from: 0,
          to: cm.state.doc.length,
          insert: '',
        },
      });
    }
  };

  if (editing) {
    return (
      <div className={c('item-form')} ref={clickOutsideRef}>
        <div className={c('item-input-wrapper')}>
          <MarkdownEditor
            editorRef={editorRef}
            editState={{ x: 0, y: 0 }}
            className={c('item-input')}
            placeholder={t('Card title...')}
            value={drafts.get(stateManager.file.path)}
            onChange={(update) => {
              if (update.docChanged) {
                drafts.set(stateManager.file.path, update.state.doc.toString(), owner.current);
              }
            }}
            onEnter={(cm, mod, shift) => {
              if (!allowNewLine(stateManager, mod, shift)) {
                createItem(cm.state.doc.toString());
                return true;
              }
            }}
            onSubmit={(cm) => {
              createItem(cm.state.doc.toString());
            }}
            onEscape={clear}
          />
        </div>
      </div>
    );
  }

  if (hideButton) return null;

  return (
    <div className={c('item-button-wrapper')}>
      <button
        className={c('new-item-button')}
        onClick={() => setEditState({ x: 0, y: 0 })}
        onDragOver={(e) => {
          if (getDropAction(stateManager, e.dataTransfer)) {
            setEditState({ x: 0, y: 0 });
          }
        }}
      >
        <span className={c('item-button-plus')}>+</span> {t('Add a card')}
      </button>
    </div>
  );
}
