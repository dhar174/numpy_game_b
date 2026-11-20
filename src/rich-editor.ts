import {history, historyKeymap, defaultKeymap} from '@codemirror/commands';
import {python} from '@codemirror/lang-python';
import {HighlightStyle, syntaxHighlighting} from '@codemirror/language';
import {EditorState} from '@codemirror/state';
import {EditorView, keymap, lineNumbers, highlightActiveLine} from '@codemirror/view';
import {tags} from '@lezer/highlight';

const colors = HighlightStyle.define([
  {tag: tags.comment, color: '#8fa5b9', fontStyle: 'italic'},
  {tag: [tags.keyword, tags.operatorKeyword], color: '#d0b1ff'},
  {tag: [tags.number, tags.bool, tags.null], color: '#ffcb87'},
  {tag: [tags.string, tags.special(tags.string)], color: '#9af3c7'},
  {tag: [tags.function(tags.variableName), tags.attributeName], color: '#93d7ff'},
]);

export type RichEditor = {source: () => string; destroy: () => void};

export function mountRichEditor(host: HTMLElement, source: string,
  onEdit: (source: string) => void, onRun: () => void): RichEditor {
  const run = () => {
    onRun();
    return true;
  };
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: source,
      extensions: [
        python(), lineNumbers(), EditorView.lineWrapping, highlightActiveLine(), history(), syntaxHighlighting(colors),
        keymap.of([{key: 'Mod-Enter', run}, ...defaultKeymap, ...historyKeymap]),
        EditorView.theme({'.cm-content': {padding: '10px 0'}, '.cm-line': {padding: '0 9px'},
          '.cm-activeLine': {backgroundColor: '#162236'}, '.cm-cursor': {borderColor: '#edf4fc'},
          '.cm-scroller': {fontFamily: 'inherit'}}, {dark: true}),
        EditorView.contentAttributes.of({'aria-label': 'NumPy mission code editor',
          spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off'}),
        EditorView.updateListener.of(event => {
          if (event.docChanged) onEdit(event.state.doc.toString());
        }),
      ],
    }),
  });
  return {source: () => view.state.doc.toString(), destroy: () => view.destroy()};
}
