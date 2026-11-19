import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-700.css';
import '@fontsource/press-start-2p/latin-400.css';
import '@fontsource/space-mono/latin-400.css';
import '@fontsource/space-mono/latin-700.css';
import '../styles.css';
import {Campaign} from './campaign';
import type {Mode, Motion} from './campaign';
import {labDatasets, sectors} from './curriculum';
import type {Checkpoint, Sector} from './curriculum';
import {CodeEditor} from './editor';
import {Engine} from './engine';
import {element, Inspector} from './inspection';
import type {Preview, RunInput, RunResult} from './protocol';
import {ShipView} from './ship';
import {primeSound, repairSound, toggleAmbience} from './sound';

const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const button = (id: string) => get<HTMLButtonElement>(id);
const details = (id: string) => get<HTMLDetailsElement>(id);
const dialog = (id: string) => get<HTMLDialogElement>(id);

const game = new Campaign();
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const ship = new ShipView(get<HTMLCanvasElement>('ship-canvas'));
const runButton = button('run-btn');
const nextButton = button('next-btn');
const stopButton = button('stop-btn');
const retryButton = button('retry-btn');
const summary = get('run-summary');
const sectorList = get('sector-list');
const modeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-mode]'));

let revision = 0;
let issuedRunId = 0;
let inspectionId = 0;
let hintCount = 0;
let last: {input: Pick<RunInput, 'runId' | 'checkpointId' | 'revision'>; result: RunResult} | null = null;
let latestPreview: Preview | null = null;
let inspectRunId = 0;
let engineNote = '';
let onConfirm: (() => void) | null = null;

const editor = new CodeEditor(get('code-editor'), source => {
  revision++;
  game.edit(source);
  syncStorage();
  syncControls();
}, run);

const inspector = new Inspector(get<HTMLSelectElement>('variable-select'), get<HTMLDivElement>('array-inspector'), selection => {
  latestPreview = null;
  if (inspectRunId) engine.inspect(++inspectionId, inspectRunId, selection);
  else inspector.render(null);
});

const engine = new Engine(event => {
  if (event.kind === 'result') {
    if (event.checkpointId !== game.workspaceId) return;
    const {runId, checkpointId, revision: submittedRevision, result} = event;
    const sectorWasRestored = game.completeSector(game.sector);
    last = {input: {runId, checkpointId, revision: submittedRevision}, result};
    inspectRunId = runId;
    engineNote = '';
    if (submittedRevision === revision && game.save.mode !== 'lab' && passed(result) && game.recordClear()) {
      refreshNavigation();
      ship.repair(sectors.indexOf(game.sector));
      repairSound(game.save.settings.sound, !sectorWasRestored && game.completeSector(game.sector));
    }
    renderOutput();
    inspector.setOutputs(result.arrays);
  } else if (event.kind === 'preview') {
    if (event.requestId !== inspectionId || event.runId !== inspectRunId) return;
    latestPreview = event.preview;
    inspector.render(event.preview);
  } else if (event.kind === 'ready') {
    editor.enhance();
  } else if (event.kind === 'loading') {
    inspectRunId = 0;
    latestPreview = null;
    if (inspector.selection) inspector.render(null);
  } else if (event.kind === 'failure') {
    engineNote = 'NumPy could not start or stopped unexpectedly. ' + event.message;
  } else if (event.kind === 'stopped') {
    engineNote = event.reason;
  }
  syncControls();
});

function run() {
  if (engine.status !== 'ready' || engine.activeRun) return;
  if (editor.source.length > 64000) {
    engineNote = 'The script is over 64,000 characters. Shorten it to run.';
    syncControls();
    return;
  }
  if (game.save.settings.sound) primeSound();
  const checkpoint = game.save.mode === 'lab' ? null : game.checkpoint;
  const input = {
    runId: ++issuedRunId, revision, checkpointId: game.workspaceId,
    source: editor.source, setup: checkpoint?.setup ?? '',
    alternate: checkpoint?.alternate, checks: checkpoint?.checks ?? [],
  };
  engineNote = '';
  engine.run(input);
  syncControls();
}

function passed(result: RunResult) {
  return !result.error && !result.alternateError && result.checks.length > 0
    && result.checks.every(check => check.passed);
}

function reduced() {
  return game.save.settings.motion === 'reduced' || (game.save.settings.motion === 'system' && motion.matches);
}

function syncStorage() {
  get('storage-notice').hidden = game.persistence;
}

function friendly(error: NonNullable<RunResult['error']>) {
  const where = error.line === null ? '' : ' on line ' + error.line;
  const prefix = error.name + where + '. ';
  if (error.name === 'SyntaxError') return prefix + error.message;
  if (error.name === 'NameError') return prefix + error.message + ' Check the names in Provided inputs.';
  if (error.message.toLowerCase().includes('broadcast')) {
    return prefix + 'The shapes cannot broadcast together. Compare their trailing dimensions.';
  }
  return prefix + error.message;
}

function syncControls() {
  const status = get('engine-status');
  status.dataset.state = engine.status;
  status.textContent = {loading: 'Loading NumPy…', ready: 'NumPy ready', failed: 'Runtime offline'}[engine.status];
  runButton.disabled = engine.status !== 'ready' || !!engine.activeRun;
  stopButton.hidden = !engine.activeRun;
  retryButton.hidden = engine.status !== 'failed';
  const current = game.save.mode === 'lab' ? null : game.checkpoint;
  const canAdvance = current && game.isComplete(current.id);
  nextButton.hidden = !canAdvance;
  if (canAdvance) {
    const sector = game.sector;
    const isLastCampaign = current === sectors.at(-1)?.campaign.at(-1);
    const isLastNebula = current === sectors.at(-1)?.nebula;
    const sectorDone = current === sector.campaign.at(-1);
    nextButton.textContent = isLastCampaign ? 'Launch colony ship →'
      : isLastNebula ? 'Open Ship Log →'
      : sectorDone ? 'Next sector →'
      : game.save.mode === 'nebula' ? 'Next challenge →' : 'Next checkpoint →';
  }

  let state = 'idle';
  let message = 'Ready. Edit the script, then run it.';
  if (engine.activeRun) message = 'Running Python…';
  else if (engineNote) {
    message = engineNote;
    state = engine.status === 'failed' ? 'error' : 'stale';
  } else if (engine.status === 'loading') message = 'Starting the NumPy engine…';
  else if (last) {
    const result = last.result;
    if (last.input.revision !== revision) {
      message = 'Last run shown. Your draft has changed.';
      state = 'stale';
    } else if (result.error) {
      message = friendly(result.error);
      state = 'error';
    } else if (current && passed(result)) {
      message = game.save.mode === 'nebula' ? 'Nebula challenge cleared.'
        : current === game.sector.campaign.at(-1) ? game.sector.title + ' restored.'
        : 'Checkpoint complete.';
      state = 'success';
    } else if (current) {
      const count = result.checks.filter(check => check.passed).length;
      message = count + ' of ' + result.checks.length + ' checks passed. Review the feedback in Run output.';
      state = 'stale';
    } else {
      message = 'Run complete. Explore the result in Array inspector.';
      state = 'success';
    }
  } else if (canAdvance) {
    message = 'Checkpoint restored. You can replay the exercise or continue.';
    state = 'success';
  }
  get('run-banner').dataset.state = state;
  if (summary.textContent !== message) summary.textContent = message;
  syncStorage();
}

function stream(name: 'stdout' | 'stderr' | 'error', content = '', truncated = false) {
  const disclosure = details(name + '-details');
  disclosure.hidden = !content && !truncated;
  get(name + '-pane').textContent = content + (truncated ? '\n[Output truncated at 32 KiB.]' : '');
}

function renderOutput() {
  const result = last?.result;
  get('output-empty').hidden = !!result;
  const checks = get('validation-list');
  checks.replaceChildren(...(result?.checks ?? []).map(check => {
    const item = element('li', undefined, check.passed ? 'check passed' : 'check');
    item.append(element('strong', check.passed ? 'Pass' : 'Review'), document.createTextNode(check.label));
    if (!check.passed) {
      const hint = check.samplePassed
        ? 'The visible sample passed. Use the provided inputs so the same code works when the data changes. ' + check.hint
        : check.hint;
      item.append(element('p', hint));
    }
    return item;
  }));
  if (result?.alternateError) checks.prepend(element('li', 'The second dataset raised an error. '
    + friendly(result.alternateError), 'check'));
  if (result && !result.checks.length && !result.stdout && !result.stderr && !result.error) {
    checks.append(element('li', 'Python completed without printed output.', 'empty'));
  }
  stream('stdout', result?.stdout, result?.stdoutTruncated);
  stream('stderr', result?.stderr, result?.stderrTruncated);
  stream('error', result?.error?.traceback ?? result?.alternateError?.traceback);
}

const cutaway = element('nav', undefined, 'ship-links');
cutaway.setAttribute('aria-label', 'Ship cutaway rooms');
get('ship-canvas').after(cutaway);
const rooms = sectors.map((sector, index) => {
  const control = element('button', undefined, 'sector-button');
  control.type = 'button';
  control.dataset.sector = sector.id;
  const number = element('span', String(index + 1).padStart(2, '0'), 'sector-num');
  number.setAttribute('aria-hidden', 'true');
  const text = element('span');
  const status = element('span', '', 'sector-status');
  text.append(element('span', sector.title, 'sector-name'), status);
  control.append(number, text);
  const item = element('li');
  item.append(control);
  sectorList.append(item);
  const marker = element('button', String(index + 1), 'ship-node');
  marker.type = 'button';
  marker.dataset.sector = sector.id;
  marker.style.left = 'var(--room-' + index + ', 0%)';
  cutaway.append(marker);
  function navigate() {
    if (game.selectSector(sector, game.save.mode === 'nebula' ? 'nebula' : 'campaign')) openWorkspace(true);
  }
  control.addEventListener('click', navigate);
  marker.addEventListener('click', navigate);
  return {sector, control, marker, number, status};
});

function refreshNavigation() {
  for (const control of modeButtons) {
    const mode = control.dataset.mode as Mode;
    control.setAttribute('aria-pressed', String(game.save.mode === mode));
    control.disabled = mode === 'nebula' && !game.nebulaUnlocked || mode === 'lab' && !game.labUnlocked;
    if (!control.disabled) control.removeAttribute('title');
    else control.title = mode === 'nebula' ? 'Restore all sectors to unlock Nebula Mode' : 'Restore Boot Bay to unlock Free Lab';
  }
  const restored = game.restored;
  document.querySelectorAll<HTMLButtonElement>('[data-checkpoint]').forEach(control => {
    const index = Number(control.dataset.checkpoint);
    const checkpoint = game.sector.campaign[index];
    if (!checkpoint) return;
    control.textContent = (game.isComplete(checkpoint.id) ? '✓ ' : '') + 'Checkpoint ' + (index + 1);
    control.disabled = !game.checkpointUnlocked(checkpoint);
  });
  get('progress-status').textContent = restored.length + ' / ' + sectors.length + ' systems online';
  for (const [index, room] of rooms.entries()) {
    const online = game.save.mode === 'nebula' ? game.isComplete(room.sector.nebula.id) : restored.includes(room.sector);
    const unlocked = game.sectorUnlocked(room.sector);
    const current = game.save.mode !== 'lab' && room.sector === game.sector;
    const state = online ? 'restored' : !unlocked ? 'locked' : current ? 'active' : 'available';
    const label = {restored: game.save.mode === 'nebula' ? 'Cleared' : 'Online', locked: 'Locked', active: 'In progress', available: 'Available'}[state];
    room.status.textContent = label;
    room.number.textContent = online ? '◆' : String(index + 1).padStart(2, '0');
    for (const control of [room.control, room.marker]) {
      control.disabled = !unlocked;
      control.dataset.state = state;
      if (current) control.setAttribute('aria-current', 'location');
      else control.removeAttribute('aria-current');
    }
    room.marker.setAttribute('aria-label', room.sector.title + ', ' + label);
    room.marker.title = room.sector.title + ' · ' + label;
  }
  ship.update(sectors.indexOf(game.sector), restored.map(sector => sectors.indexOf(sector)), reduced());
  syncStorage();
}

function renderHints() {
  const hints = game.save.mode === 'lab' ? [] : game.checkpoint.hints;
  get('hints').replaceChildren(...hints.slice(0, hintCount).map(text => element('li', text)));
  button('hint-btn').hidden = hintCount >= hints.length;
  button('hint-btn').textContent = hintCount ? 'Reveal next hint' : 'Reveal a hint';
}

function renderCheckpoint() {
  const inLab = game.save.mode === 'lab';
  const current = game.checkpoint;
  const sector = game.sector;
  const index = sectors.indexOf(sector);
  const steps = game.save.mode === 'campaign' ? sector.campaign : [];
  get('mission-location').textContent = inLab ? 'Free Lab' : (game.save.mode === 'nebula' ? 'Nebula · ' : 'Sector ' + String(index + 1).padStart(2, '0') + ' · ') + sector.title;
  get('mission-title').textContent = inLab ? game.lab.title : current.title;
  get('mission-objective').textContent = inLab
    ? 'Run real Python, inspect the results, and try changing the data.'
    : current.objective;
  get('dataset-control').hidden = !inLab;
  get<HTMLSelectElement>('dataset-select').value = game.lab.id;
  details('transmission').hidden = inLab;
  details('transmission').open = !game.save.settings.oriented && !inLab && matchMedia('(min-width: 746px)').matches;
  get('transmission-text').textContent = sector.transmission;
  get('checkpoints').replaceChildren(...steps.map((checkpoint, idx) => {
    const control = element('button', (game.isComplete(checkpoint.id) ? '✓ ' : '') + 'Checkpoint ' + (idx + 1), 'checkpoint');
    control.type = 'button';
    control.title = checkpoint.title;
    control.dataset.checkpoint = String(idx);
    if (checkpoint === current) control.setAttribute('aria-current', 'step');
    control.disabled = !game.checkpointUnlocked(checkpoint);
    control.addEventListener('click', () => {
      if (!game.checkpointUnlocked(checkpoint)) return;
      game.save.campaignId = checkpoint.id;
      game.persist();
      openWorkspace(true);
    });
    return control;
  }));
  details('setup-details').hidden = inLab || !current.setup.trim();
  details('setup-details').open = false;
  get('setup-code').textContent = current.setup;
  details('hint-details').hidden = inLab;
  details('hint-details').open = false;
  const prediction = inLab ? undefined : current.prediction;
  details('prediction').hidden = !prediction;
  details('prediction').open = false;
  get('prediction-feedback').textContent = '';
  if (prediction) {
    get('prediction-question').textContent = prediction.question;
    get('prediction-options').replaceChildren(...prediction.options.map((option, idx) => {
      const label = element('label');
      const radio = element('input');
      radio.type = 'radio';
      radio.name = 'prediction';
      radio.value = String(idx);
      radio.required = true;
      label.append(radio, document.createTextNode(option));
      return label;
    }));
  }
  renderHints();
}

function openWorkspace(focus = false) {
  const active = engine.activeRun;
  if (active) engine.stop('Previous run stopped.');
  revision++;
  last = null;
  latestPreview = null;
  inspectRunId = 0;
  hintCount = 0;
  if (engine.status !== 'failed') engineNote = '';
  if (focus && !game.save.settings.oriented) {
    game.save.settings.oriented = true;
    game.persist();
  }
  editor.show(game.draft, game.save.settings.plain);
  inspector.setOutputs([]);
  renderOutput();
  renderCheckpoint();
  refreshNavigation();
  syncControls();
  if (focus) {
    setMap(false);
    const title = get('mission-title');
    title.focus({preventScroll: true});
    title.scrollIntoView({block: 'start', behavior: 'instant'});
  }
}

function openLog() {
  const log = get('log-entries');
  log.replaceChildren();
  type Entry = {sector: Sector; checkpoint: Checkpoint; time: number; nebula: boolean};
  const entries: Entry[] = [];
  for (const sector of sectors) {
    if (game.completeSector(sector)) {
      const checkpoint = sector.campaign.at(-1)!;
      entries.push({sector, checkpoint, time: game.save.completed[checkpoint.id], nebula: false});
    }
    if (game.isComplete(sector.nebula.id)) {
      entries.push({sector, checkpoint: sector.nebula, time: game.save.completed[sector.nebula.id], nebula: true});
    }
  }
  const skills = sectors.flatMap(sector => sector.campaign)
    .filter(checkpoint => game.isComplete(checkpoint.id)).map(checkpoint => checkpoint.skill);
  if (skills.length) {
    const list = element('ul');
    list.append(...Array.from(new Set(skills)).map(skill => element('li', skill)));
    log.append(element('h3', 'Skills demonstrated'), list);
  }
  if (!entries.length) log.append(element('p', 'Restored systems and cleared challenges will appear here.', 'empty'));
  for (const entry of entries.sort((a, b) => b.time - a.time)) {
    const card = element('article', undefined, 'log-entry');
    const replay = element('button', 'Replay ' + entry.sector.title, 'utility');
    replay.type = 'button';
    replay.addEventListener('click', () => {
      dialog('log-dialog').close();
      if (game.selectSector(entry.sector, entry.nebula ? 'nebula' : 'campaign', true)) openWorkspace(true);
    });
    card.append(element('h3', entry.nebula ? 'Nebula cleared · ' + entry.sector.title : entry.sector.title + ' online'),
      element('p', entry.nebula ? entry.checkpoint.skill : entry.sector.campaign.map(cp => cp.skill).join(' · ')), replay);
    log.append(card);
  }
  dialog('log-dialog').showModal();
}

function openEnding() {
  get('ending-systems').replaceChildren(...game.restored.map(sector => element('li', sector.title + ' online')));
  dialog('ending-dialog').showModal();
}

function confirmAction(title: string, detail: string, action: string, callback: () => void) {
  get('confirm-title').textContent = title;
  get('confirm-copy').textContent = detail;
  button('confirm-action').textContent = action;
  onConfirm = callback;
  dialog('confirm-dialog').showModal();
}

function setMap(open: boolean) {
  get('ship-map').dataset.open = String(open);
  button('map-button').setAttribute('aria-expanded', String(open));
}

get<HTMLSelectElement>('dataset-select').append(...labDatasets.map(dataset => {
  const option = element('option', dataset.title);
  option.value = dataset.id;
  return option;
}));
get<HTMLSelectElement>('dataset-select').addEventListener('change', event => {
  if (game.selectLab((event.target as HTMLSelectElement).value)) openWorkspace();
});
for (const control of modeButtons) control.addEventListener('click', () => {
  const mode = control.dataset.mode as Mode;
  if (mode !== game.save.mode && game.selectMode(mode)) openWorkspace(true);
});

runButton.addEventListener('click', run);
stopButton.addEventListener('click', () => { engine.stop(); runButton.focus(); });
retryButton.addEventListener('click', () => { engineNote = ''; engine.start(); });
button('reset-btn').addEventListener('click', () => {
  confirmAction('Reset this draft?', 'Restore the starter script for this workspace. Earned progress stays saved.',
    'Reset draft', () => { game.resetDraft(); openWorkspace(true); });
});
nextButton.addEventListener('click', () => {
  if (game.advance()) openWorkspace(true);
  else if (game.save.mode === 'campaign' && game.nebulaUnlocked) openEnding();
  else if (game.save.mode === 'nebula') openLog();
});
button('hint-btn').addEventListener('click', () => {
  hintCount++;
  renderHints();
  if (button('hint-btn').hidden) details('hint-details').querySelector('summary')?.focus();
});
get<HTMLFormElement>('prediction-form').addEventListener('submit', event => {
  event.preventDefault();
  const prediction = game.checkpoint.prediction;
  const answer = new FormData(event.currentTarget as HTMLFormElement).get('prediction');
  if (!prediction || answer === null) return;
  get('prediction-feedback').textContent = Number(answer) === prediction.answer
    ? 'Correct. ' + prediction.explanation
    : 'Try another answer. Check the input shape and the operation’s axis.';
});
details('transmission').addEventListener('toggle', () => {
  if (!details('transmission').open && !game.save.settings.oriented) {
    game.save.settings.oriented = true;
    game.persist();
    syncStorage();
  }
});
button('map-button').addEventListener('click', () => {
  const open = button('map-button').getAttribute('aria-expanded') !== 'true';
  setMap(open);
  if (open) {
    get('ship-map').scrollIntoView({block: 'nearest'});
    rooms.find(room => room.sector === game.sector)?.control.focus({preventScroll: true});
  }
});
get('ship-map').addEventListener('keydown', event => {
  if (event.key === 'Escape' && button('map-button').getAttribute('aria-expanded') === 'true') {
    setMap(false);
    button('map-button').focus();
  }
});
button('fullscreen-button').hidden = !document.fullscreenEnabled;
button('fullscreen-button').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await get('ship-canvas').parentElement?.requestFullscreen();
  } catch {
    engineNote = 'Fullscreen is unavailable in this browser.';
    syncControls();
  }
});
document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(control => {
  control.addEventListener('click', () => control.closest('dialog')?.close());
});
button('confirm-action').addEventListener('click', () => {
  const action = onConfirm;
  onConfirm = null;
  dialog('confirm-dialog').close();
  action?.();
});
button('log-button').addEventListener('click', openLog);
button('settings-button').addEventListener('click', () => {
  const {plain, sound, ambience, motion: setting} = game.save.settings;
  get<HTMLInputElement>('plain-setting').checked = plain;
  get<HTMLInputElement>('sound-setting').checked = sound;
  get<HTMLInputElement>('ambience-setting').checked = ambience;
  get<HTMLSelectElement>('motion-setting').value = setting;
  dialog('settings-dialog').showModal();
});
get<HTMLInputElement>('plain-setting').addEventListener('change', event => {
  game.save.settings.plain = (event.target as HTMLInputElement).checked;
  game.persist();
  editor.show(editor.source, game.save.settings.plain);
  if (engine.status === 'ready') editor.enhance();
  syncStorage();
});
get<HTMLInputElement>('sound-setting').addEventListener('change', event => {
  game.save.settings.sound = (event.target as HTMLInputElement).checked;
  repairSound(game.save.settings.sound, false);
  game.persist();
  syncStorage();
});
get<HTMLInputElement>('ambience-setting').addEventListener('change', event => {
  game.save.settings.ambience = (event.target as HTMLInputElement).checked;
  toggleAmbience(game.save.settings.ambience);
  game.persist();
  syncStorage();
});
document.addEventListener('pointerdown', () => {
  if (game.save.settings.ambience) toggleAmbience(true);
}, {once: true});
get<HTMLSelectElement>('motion-setting').addEventListener('change', event => {
  game.save.settings.motion = (event.target as HTMLSelectElement).value as Motion;
  game.persist();
  refreshNavigation();
});
motion.addEventListener('change', refreshNavigation);
button('new-game').addEventListener('click', () => {
  dialog('settings-dialog').close();
  confirmAction('Start over?', 'Erase all local progress, drafts, and Ship Log entries for this game.',
    'Start over', () => { game.startOver(); openWorkspace(true); });
});
document.querySelectorAll<HTMLButtonElement>('[data-ending]').forEach(control => {
  control.addEventListener('click', () => {
    dialog('ending-dialog').close();
    if (control.dataset.ending === 'log') openLog();
    else if (game.selectMode(control.dataset.ending as Mode)) openWorkspace(true);
  });
});

declare global {
  interface Window {
    render_game_to_text: () => string;
    advanceTime: (milliseconds: number) => void;
  }
}

window.render_game_to_text = () => JSON.stringify({
  mode: engine.status === 'failed' ? 'engine-error' : engine.status === 'loading' ? 'loading-engine' : 'ready',
  phase: game.save.mode,
  runStatus: engine.activeRun ? 'running' : get('run-banner').dataset.state,
  lastRunMatchesDraft: last ? last.input.revision === revision : null,
  engineStatus: get('engine-status').textContent,
  briefingDismissed: game.save.settings.oriented,
  coordinates: 'Ship canvas origin is top-left. x increases right, y increases downward.',
  mission: {index: sectors.indexOf(game.sector), id: game.sector.id, sector: game.sector.title,
    title: game.checkpoint.title, focusPrompt: game.checkpoint.objective,
    tasks: game.checkpoint.checks.map(check => check.label),
    complete: game.completeSector(game.sector)},
  checkpoint: {id: game.workspaceId, complete: game.isComplete(game.workspaceId)},
  progress: {completed: game.restored.map(sector => sector.id),
    checkpoints: Object.keys(game.save.completed),
    unlockedCount: sectors.filter(sector => game.sectorUnlocked(sector)).length,
    nebulaUnlocked: game.nebulaUnlocked, labUnlocked: game.labUnlocked,
    checksPassing: last?.result.checks.filter(check => check.passed).length ?? 0,
    totalChecks: last?.result.checks.length ?? 0},
  arrays: last?.result.arrays ?? [],
  activeVariable: inspector.selection?.name ?? null,
  activeValue: inspector.selection
    ? {...last?.result.arrays.find(array => array.name === inspector.selection?.name), preview: latestPreview}
    : null,
  output: {stdout: last?.result.stdout ?? '', error: last?.result.error?.traceback ?? null,
    summary: summary.textContent},
  hintsVisible: hintCount,
  shipDraws: ship.drawCount,
});
window.advanceTime = ms => ship.advance(Number.isFinite(ms) ? ms : 0);

openWorkspace();
engine.start();
