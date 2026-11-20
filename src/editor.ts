import type {RichEditor} from './rich-editor';

export class CodeEditor {
  #rich: RichEditor | null = null;
  #plain: HTMLTextAreaElement | null = null;
  #module: typeof import('./rich-editor') | null = null;
  #loading = false;
  #preferPlain = false;

  constructor(private readonly host: HTMLElement,
    private readonly onEdit: (source: string) => void,
    private readonly onRun: () => void) {}

  get source() {
    return this.#rich?.source() ?? this.#plain?.value ?? '';
  }

  show(source: string, plain: boolean) {
    this.#rich?.destroy();
    this.#rich = null;
    this.#plain = null;
    this.#preferPlain = plain;
    this.host.replaceChildren();
    if (!plain && this.#module) {
      this.#mountRich(source);
      return;
    }

    const field = document.createElement('textarea');
    field.setAttribute('aria-label', 'NumPy mission code editor');
    field.setAttribute('role', 'textbox');
    field.setAttribute('aria-multiline', 'true');
    field.value = source;
    field.spellcheck = false;
    field.autocapitalize = 'off';
    field.addEventListener('input', () => this.onEdit(field.value));
    field.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        this.onRun();
      }
    });
    field.addEventListener('focus', () => this.enhance());
    field.addEventListener('blur', () => this.#upgrade());
    this.host.append(field);
    this.#plain = field;
  }

  enhance() {
    if (this.#preferPlain || this.#loading || this.#module || !this.#plain) return;
    this.#loading = true;
    void import('./rich-editor').then(module => {
      this.#module = module;
      this.#upgrade();
    }).catch(() => {
      // The text editor remains usable if the optional enhancement cannot load.
    }).finally(() => this.#loading = false);
  }

  #upgrade() {
    const field = this.#plain;
    if (!this.#module || !field || this.#preferPlain || document.activeElement === field) return;
    this.#mountRich(field.value);
  }

  #mountRich(source: string) {
    this.#plain = null;
    this.host.replaceChildren();
    this.#rich = this.#module!.mountRichEditor(this.host, source, this.onEdit, this.onRun);
  }
}
