import type {OutputInfo, Preview, Selection} from './protocol';

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K, text?: string, css?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (css) node.className = css;
  return node;
}

export class Inspector {
  #selection: Selection | null = null;
  #preferredName: string | null = null;
  #outputs: OutputInfo[] = [];
  #info: HTMLDListElement;
  #controls: HTMLDivElement;
  #display: HTMLDivElement;
  #caption: HTMLParagraphElement;
  #grid: HTMLDivElement;
  #previousRow: HTMLButtonElement;
  #nextRow: HTMLButtonElement;
  #previousCol: HTMLButtonElement;
  #nextCol: HTMLButtonElement;

  constructor(private readonly variables: HTMLSelectElement, private readonly target: HTMLDivElement,
    private readonly request: (selection: Selection) => void) {
    this.#info = element('dl', undefined, 'meta');
    this.#controls = element('div', undefined, 'slice-controls');
    this.#display = element('div');
    this.#caption = element('p', '', 'empty');
    this.#grid = element('div', undefined, 'grid-scroll');
    this.#grid.tabIndex = 0;
    this.#grid.setAttribute('role', 'region');
    this.#grid.setAttribute('aria-label', 'Scrollable array values');
    this.#previousRow = this.#step('Previous rows', 'row', -16);
    this.#nextRow = this.#step('Next rows', 'row', 16);
    this.#previousCol = this.#step('Previous columns', 'col', -16);
    this.#nextCol = this.#step('Next columns', 'col', 16);
    variables.addEventListener('change', () => {
      this.#preferredName = variables.value;
      this.#select(variables.value);
    });
  }

  get selection() { return this.#selection; }

  setOutputs(outputs: OutputInfo[]) {
    this.#outputs = outputs;
    this.variables.hidden = !outputs.length;
    this.variables.replaceChildren(...outputs.map(output => {
      const option = element('option', output.name + ' [' + output.type + ']');
      option.value = output.name;
      return option;
    }));
    if (!outputs.length) {
      this.#selection = null;
      this.#preferredName = null;
      this.target.replaceChildren(element('p', 'Run your code to explore values, shapes, and indices.', 'empty'));
      return;
    }
    const selected = outputs.find(output => output.name === this.#preferredName)
      ?? outputs.filter(output => output.type === 'ndarray').at(-1) ?? outputs.at(-1)!;
    this.#select(selected.name);
  }

  #select(name: string) {
    const value = this.#outputs.find(output => output.name === name);
    if (!value) return;
    this.variables.value = name;
    this.#selection = {name, row: 0, col: 0, axes: []};
    const metrics = value.shape ? [
      ['Shape', '(' + value.shape.join(', ') + (value.shape.length === 1 ? ',' : '') + ')'],
      ['dtype', value.dtype ?? '—'], ['Dimensions', String(value.ndim)], ['Size', String(value.size)],
    ] : [['Type', value.type]];
    this.#info.replaceChildren(...metrics.map(([label, value]) => {
      const metric = element('div');
      metric.append(element('dt', label), element('dd', value));
      return metric;
    }));
    this.#controls.replaceChildren();
    if (value.shape && value.size) {
      value.shape.slice(0, -2).forEach((count, axis) => {
        const label = element('label', 'Axis ' + axis);
        const input = element('input');
        input.type = 'number';
        input.min = '0';
        input.max = String(count - 1);
        input.step = '1';
        input.value = '0';
        input.addEventListener('change', () => {
          if (!this.#selection) return;
          const index = Number.isFinite(input.valueAsNumber) ? Math.trunc(input.valueAsNumber) : 0;
          const axes = [...this.#selection.axes];
          while (axes.length <= axis) axes.push(0);
          axes[axis] = Math.max(0, Math.min(count - 1, index));
          input.value = String(axes[axis]);
          this.#selection = {...this.#selection, row: 0, col: 0, axes};
          this.request(this.#selection);
        });
        label.append(input);
        this.#controls.append(label);
      });
    }
    this.#controls.append(this.#previousRow, this.#nextRow, this.#previousCol, this.#nextCol);
    this.#caption.textContent = '';
    this.#display.replaceChildren(element('p', 'Reading value…', 'empty'));
    this.target.replaceChildren(this.#info, this.#controls, this.#caption, this.#display);
    this.#previousRow.hidden = this.#nextRow.hidden = this.#previousCol.hidden = this.#nextCol.hidden = true;
    this.request(this.#selection);
  }

  #step(label: string, axis: 'row' | 'col', delta: number) {
    const button = element('button', label, 'utility');
    button.type = 'button';
    button.addEventListener('click', () => {
      if (!this.#selection) return;
      this.#selection = {...this.#selection, [axis]: Math.max(0, this.#selection[axis] + delta)};
      this.request(this.#selection);
    });
    return button;
  }

  render(preview: Preview | null) {
    if (!preview) {
      this.#display.replaceChildren(element('p', 'Run the current draft to inspect this value.', 'empty'));
      return;
    }
    this.#selection = preview.selection;
    if (preview.text !== undefined) {
      this.#display.replaceChildren(element('pre', preview.text, 'array-text'));
      return;
    }
    const {rows, cols, selection, cells} = preview;
    this.#previousRow.hidden = this.#nextRow.hidden = rows <= 16;
    this.#previousCol.hidden = this.#nextCol.hidden = cols <= 16;
    this.#previousRow.disabled = selection.row === 0;
    this.#previousCol.disabled = selection.col === 0;
    this.#nextRow.disabled = selection.row + 16 >= rows;
    this.#nextCol.disabled = selection.col + 16 >= cols;
    this.#caption.textContent = rows > 16 || cols > 16
      ? 'Rows ' + (selection.row + 1) + '–' + Math.min(selection.row + 16, rows) + ' of ' + rows
        + ' · Columns ' + (selection.col + 1) + '–' + Math.min(selection.col + 16, cols) + ' of ' + cols
      : '';
    const table = element('table', undefined, 'array-table');
    const caption = element('caption', selection.name + ' array values and indices', 'sr-only');
    const tbody = element('tbody');
    const finite = cells.flat().map(cell => cell.value.trim() ? Number(cell.value) : NaN)
      .filter(Number.isFinite);
    const low = finite.length ? Math.min(...finite) : 0;
    const span = finite.length ? (Math.max(...finite) - low || 1) : 1;
    for (const row of cells) {
      const tr = element('tr');
      for (const cell of row) {
        const td = element('td', cell.value);
        td.dataset.tone = cell.tone;
        const numeric = cell.value.trim() ? Number(cell.value) : NaN;
        if (!cell.tone && Number.isFinite(numeric)) {
          td.style.setProperty('--heat', (14 + 44 * ((numeric - low) / span)) + '%');
        }
        td.append(element('small', cell.index));
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(caption, tbody);
    this.#grid.replaceChildren(table);
    this.#grid.scrollLeft = 0;
    this.#grid.scrollTop = 0;
    if (this.#grid.parentNode !== this.#display) this.#display.replaceChildren(this.#grid);
  }
}
