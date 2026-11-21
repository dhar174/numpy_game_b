import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium, firefox, webkit} from 'playwright';
import {labDatasets, sectors} from '../src/curriculum.ts';
import {solutions} from './solutions.ts';
import {serveBuild} from './static-server.mjs';

const browsers = {chromium, firefox, webkit};
const target = process.env.NEBULA_BROWSER || 'chromium';
const names = target === 'all' ? Object.keys(browsers) : [target];
const shotDir = process.env.NEBULA_SHOTS;
const campaign = sectors.flatMap(sector => sector.campaign);
const challenges = sectors.map(sector => sector.nebula);
const catalog = [...campaign, ...challenges];
const nearMisses = {
  'cargo-join-split': solutions['cargo-join-split'].replace(
    'sections = np.split(manifest, 3)',
    'sections = [manifest[:1], manifest[1:2], manifest[2:]]',
  ),
  'nebula-column-normalizer': solutions['nebula-column-normalizer'].replace(
    'centered = signal - column_mean',
    'centered = np.zeros_like(signal)',
  ),
  'nebula-zero-safe-shares': [
    'row_totals = counts.sum(axis=1, keepdims=True)',
    'shares = np.where(row_totals != 0, 1.0 / counts.shape[1], 0.0) * np.ones_like(counts)',
  ].join('\n'),
};
assert.deepEqual(sectors.map(sector => sector.campaign.length), [2, 2, 2, 2, 3, 3, 1]);
assert.equal(labDatasets.length, 4);
assert.equal(new Set(catalog.map(entry => entry.id)).size, 22);
assert.deepEqual(Object.keys(solutions).sort(), catalog.map(entry => entry.id).sort());
for (const entry of catalog) {
  assert.ok(entry.setup.trim() && entry.alternate.trim() && entry.setup !== entry.alternate, entry.id);
  assert.ok(entry.starter.trim() && entry.checks.length && entry.hints.length <= 3, entry.id);
}

const site = await serveBuild();

const getState = page => page.evaluate(() => JSON.parse(window.render_game_to_text()));
const editor = page => page.getByRole('textbox', {name: 'NumPy mission code editor'});
const runButton = page => page.locator('#run-btn');
const draftText = page => editor(page).evaluate(node => node instanceof HTMLTextAreaElement ? node.value : node.textContent);

async function capture(page, name) {
  if (!shotDir) return;
  await mkdir(shotDir, {recursive: true});
  const filename = resolve(shotDir, name + '.png');
  const screenshot = await page.screenshot({path: filename});
  assert.ok((await readFile(filename)).equals(screenshot), 'Screenshot readback failed.');
}

async function ready(page) {
  const status = page.locator('#engine-status');
  try {
    await page.locator('#engine-status:is([data-state="ready"], [data-state="failed"])').waitFor({timeout: 35000});
    assert.equal(await status.textContent(), 'NumPy ready');
  } catch (error) {
    throw new Error('Runtime startup: ' + await status.textContent() + ' — ' + await page.locator('#run-summary').textContent(), {cause: error});
  }
}

async function run(page, source, shortcut = false) {
  await editor(page).fill(source);
  if (shortcut) await editor(page).press('Control+Enter');
  else await runButton(page).click();
  await page.waitForFunction(() => {
    const state = JSON.parse(window.render_game_to_text());
    return state.lastRunMatchesDraft === true && state.runStatus !== 'running';
  });
  return getState(page);
}

async function inspect(page, name) {
  await page.locator('#variable-select').selectOption(name);
  await page.waitForFunction(variable => {
    const state = JSON.parse(window.render_game_to_text());
    return state.activeVariable === variable && state.activeValue?.preview != null;
  }, name);
  return (await getState(page)).activeValue.preview;
}

async function clear(page, checkpoint) {
  const before = await getState(page);
  assert.equal(before.checkpoint.id, checkpoint.id);
  if (checkpoint.id === 'reactor-broadcast-wave') {
    assert.match(await page.locator('#mission-objective').innerText(), /np\.exp\(-boosted \/ 10\)/);
    const wrongScale = await run(page, solutions[checkpoint.id].replace('np.exp(-boosted / 10)', 'np.exp(-boosted)'));
    assert.equal(wrongScale.checkpoint.complete, false, 'A missing efficiency scale must not pass');
    assert.match(wrongScale.output.summary, /np\.exp\(-boosted \/ 10\)/);
  }
  if (checkpoint.id === 'nebula-column-normalizer') {
    assert.match(await page.locator('#mission-objective').innerText(), /row axis.*1 by number of columns/);
    const collapsed = await run(page, solutions[checkpoint.id].replace('axis=0, keepdims=True', 'axis=0'));
    assert.equal(collapsed.checkpoint.complete, false, 'The column mean must retain a row axis');
    assert.match(collapsed.output.summary, /keep the dimension/i);
  }
  if (checkpoint.id === 'nebula-energy-drift') {
    assert.match(await page.locator('#mission-objective').innerText(), /down the rows.*axis 0/);
    const wrongAxis = await run(page, solutions[checkpoint.id].replace('np.cumsum(energy, axis=0)', 'np.cumsum(energy, axis=1)'));
    assert.equal(wrongAxis.checkpoint.complete, false, 'Accumulating across columns must not pass');
    assert.match(wrongAxis.output.summary, /axis 0/);
  }
  if (Object.hasOwn(nearMisses, checkpoint.id)) {
    const rejected = await run(page, nearMisses[checkpoint.id]);
    assert.equal(rejected.runStatus, 'stale', checkpoint.id + ': expected review feedback for a wrong result');
    assert.equal(rejected.checkpoint.complete, false, checkpoint.id + ': near miss earned a clear');
    assert.ok(rejected.progress.checksPassing > 0 &&
      rejected.progress.checksPassing < rejected.progress.totalChecks, checkpoint.id + ': near miss should pass some checks');
  }
  if (checkpoint.id === 'cargo-join-split') {
    const base = 'all = np.hstack((left, right))\nmerged = all\nstacked = np.array([left, right])\n';
    assert.equal((await run(page, base + 'sections = manifest.reshape(3, -1)[::-1]')).checkpoint.complete, false);
    assert.equal((await run(page, base + 'sections = manifest.reshape(3, -1)')).runStatus, 'success');
  }
  if (checkpoint.id === 'nebula-column-normalizer') {
    const equivalent = solutions[checkpoint.id].split('\n').slice(0, -1)
      .concat('column_energy = np.einsum("ij,ij->j", centered, centered)').join('\n');
    assert.equal((await run(page, equivalent)).runStatus, 'success');
  }
  if (checkpoint.id === 'nebula-zero-safe-shares') {
    const totals = 'row_totals = counts.sum(axis=1, keepdims=True)\n';
    const eager = await run(page, 'counts = np.asarray(counts)\n' + totals + 'shares = np.where(row_totals != 0, counts / row_totals, 0)');
    assert.equal(eager.checkpoint.complete, false);
    assert.match(eager.output.summary, /Division evaluated a zero row total/);
    const inPlace = await run(page, totals + 'shares = counts.copy()\nshares[:] /= row_totals\nshares = np.nan_to_num(shares)');
    assert.equal(inPlace.checkpoint.complete, false);
    assert.match(inPlace.output.summary, /Division evaluated a zero row total/);
    for (const source of [
      'shares = counts / np.where(row_totals == 0, 1, row_totals)',
      'shares = counts.copy()\nshares[:] /= np.where(row_totals == 0, 1, row_totals)',
      'active = row_totals[:, 0] != 0\nshares = np.zeros_like(counts)\nshares[active] = counts[active] / row_totals[active]',
    ]) assert.equal((await run(page, totals + source)).runStatus, 'success');
  }
  const after = await run(page, solutions[checkpoint.id]);
  assert.equal(after.runStatus, 'success', checkpoint.id + ': ' + after.output.summary);
  assert.ok(after.checkpoint.complete, checkpoint.id + ': no clear recorded');
  assert.equal(after.progress.checksPassing, after.progress.totalChecks, checkpoint.id);
  return after;
}

async function next(page) {
  await page.locator('#next-btn').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'mission-title');
}

async function checkBoundary(page, control) {
  assert.equal(await control.evaluate(node => node === document.activeElement), true);
  assert.equal(await control.getAttribute('aria-disabled'), 'true');
  const before = (await getState(page)).activeValue?.preview?.selection;
  await page.keyboard.press('Enter');
  assert.deepEqual((await getState(page)).activeValue?.preview?.selection, before);
}

async function checkResetRace(browser) {
  const context = await browser.newContext();
  try {
    const owner = await context.newPage();
    await owner.goto(site.url);
    await ready(owner);
    await run(owner, solutions[campaign[0].id]);
    await next(owner);
    await owner.locator('#settings-button').click();
    await owner.locator('#plain-setting').check();
    await owner.locator('#new-game').click();
    await owner.evaluate(() => navigator.locks.request('numpy-nebula-save', () => {}));
    const peer = await context.newPage();
    await peer.goto(site.url);
    await ready(peer);
    assert.equal((await getState(peer)).checkpoint.id, campaign[1].id);
    // Hold the lock so the reset is queued first, then enqueue a stale draft and run.
    await peer.evaluate(() => new Promise(held => {
      window.heldSaveLock = navigator.locks.request('numpy-nebula-save', () => new Promise(release => {
        window.releaseSaveLock = release;
        held();
      }));
    }));
    await owner.bringToFront();
    await owner.locator('#confirm-action').click();
    assert.equal((await getState(owner)).checkpoint.id, campaign[0].id);
    await owner.waitForFunction(async () => (await navigator.locks.query()).pending
      .some(lock => lock.name === 'numpy-nebula-save'), null, {polling: 50});
    await peer.bringToFront();
    await editor(peer).fill('import time\ntime.sleep(1)\n' + solutions[campaign[1].id]);
    await editor(peer).press('Control+Enter');
    await peer.getByText('Running Python…', {exact: true}).waitFor();
    // WebKit may suspend a background tab before its lock request settles.
    // Keep the peer visible until the holder has actually released the lock.
    await peer.evaluate(async () => {
      window.releaseSaveLock();
      await window.heldSaveLock;
    });
    await owner.bringToFront();
    // A resumed WebKit tab can observe the lock becoming available before its
    // queued callback runs. Wait for the reset itself, not only a later lock.
    await owner.waitForFunction(() => {
      const save = JSON.parse(localStorage.getItem('numpy-nebula-save') ?? '{}');
      return save.generation === 1;
    }, null, {polling: 50});
    // Drain writes before checking delivery to the peer.
    await owner.evaluate(() => navigator.locks.request('numpy-nebula-save', () => {}));
    const reset = await owner.evaluate(() => JSON.parse(localStorage.getItem('numpy-nebula-save')));
    assert.equal(reset.generation, 1, 'The owner must commit the reset while a stale draft is queued');
    assert.deepEqual(reset.completed, {});
    await peer.bringToFront();
    await peer.waitForFunction(() => JSON.parse(window.render_game_to_text()).checkpoint.id === 'boot-power-core',
      null, {polling: 50});
    await ready(peer);
    for (const tab of [owner, peer]) {
      await tab.reload();
      await ready(tab);
      const saved = await tab.evaluate(() => JSON.parse(localStorage.getItem('numpy-nebula-save')));
      assert.deepEqual(saved.completed, {});
      assert.deepEqual(saved.drafts, {});
      assert.equal(saved.settings.plain, true);
      assert.equal((await getState(tab)).checkpoint.id, campaign[0].id);
    }
  } finally {
    await context.close();
  }
}

async function checkLayout(page, width, height, label) {
  await page.setViewportSize({width, height});
  const entry = await editor(page).boundingBox();
  const controls = await runButton(page).boundingBox();
  const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.equal(pageWidth, width, label + ' page has horizontal overflow');
  assert.ok(entry?.height > 80 && controls?.height > 30, label + ' editor and Run are visible');
  assert.ok(Math.abs(entry.y - controls.y) < 140, label + ' Run is separated from the editor');
}

function listen(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') {
      const url = message.location().url;
      errors.push(message.text() + (url ? ' (' + url + ')' : ''));
    }
  });
  return errors;
}

async function play(name) {
  assert.ok(browsers[name], 'Unknown NEBULA_BROWSER ' + name);
  const channel = name === 'chromium' ? process.env.NEBULA_CHROMIUM_CHANNEL : undefined;
  const browser = await browsers[name].launch(channel ? {channel} : {});
  try {
    const context = await browser.newContext({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'});
    const page = await context.newPage();
    const errors = listen(page);
    const external = [];
    const loaded = new Set();
    context.on('response', response => {
      if (response.ok()) loaded.add(new URL(response.url()).pathname);
    });
    context.on('request', request => {
      if (request.url().startsWith('http') && !request.url().startsWith(site.url)) external.push(request.url());
    });
    await page.goto(site.url);
    await ready(page);
    assert.equal(new URL(page.url()).pathname, '/numpy_game_b/');
    const initial = await getState(page);
    assert.equal(initial.checkpoint.id, 'boot-power-core');
    assert.ok(!initial.progress.labUnlocked && !initial.progress.nebulaUnlocked);
    assert.equal(await page.locator('#map-key-complete').innerText(), 'Online');
    assert.equal(await page.locator('#map-key-pending').innerText(), 'Awaiting repair');
    assert.equal(await page.locator('.map-key [aria-hidden="true"]').nth(1).innerText(), '01–07');
    assert.equal(await page.evaluate(() => typeof window.advanceTime), 'function');
    assert.equal(await page.locator('[data-mode="lab"]').isDisabled(), true);
    if (name === 'chromium') {
      if (await page.evaluate(() => document.fullscreenEnabled)) {
        await page.locator('#fullscreen-button').click();
        await page.waitForFunction(() => document.fullscreenElement === document.querySelector('.hero'));
        const exitFullscreen = page.getByRole('button', {name: 'Exit fullscreen'});
        await exitFullscreen.waitFor({state: 'visible'});
        await page.waitForFunction(() => document.activeElement.id === 'exit-fullscreen');
        await exitFullscreen.click();
        await page.waitForFunction(() => document.fullscreenElement === null);
        await exitFullscreen.waitFor({state: 'hidden'});
        await page.waitForFunction(() => document.activeElement.id === 'fullscreen-button');
        await page.evaluate(() => {
          const hero = document.querySelector('.hero');
          hero.requestFullscreen = () => Promise.reject(new Error('Fullscreen denied for test'));
        });
        await page.locator('#fullscreen-button').click();
        await page.getByText('Fullscreen is unavailable in this browser.', {exact: true}).waitFor();
        await page.evaluate(() => { delete document.querySelector('.hero').requestFullscreen; });
      } else {
        assert.equal(await page.locator('#fullscreen-button').isHidden(), true);
      }
      for (const [width, height] of [[1440,900],[1240,850],[1024,768],[768,1024],[390,844],[320,640]]) {
        await page.setViewportSize({width, height});
        await page.reload();
        await ready(page);
        await page.evaluate(() => document.fonts.ready);
        await checkLayout(page, width, height, String(width));
        const art = await page.locator('#ship-canvas').boundingBox();
        const copy = await page.locator('.hero-copy').boundingBox();
        assert.ok(art.height > 40 && (copy.y + copy.height <= art.y + 1 || copy.x + copy.width <= art.x + 1), 'Hero overlaps at ' + width);
        if (width === 1024) assert.ok((await editor(page).boundingBox()).y < height - 46, 'First two lines in view');
        assert.equal(await page.getByRole('button', {name:'Fullscreen ship view', includeHidden:true}).locator('svg').count(), 1);
        assert.match(await page.locator('#setup-details summary').innerText(), /power_shape.*power_dtype/);
        await capture(page, 'reflow-' + width);
      }
      // A 1440px desktop at 200% zoom has a 720px CSS layout viewport.
      await checkLayout(page, 720, 450, '200% zoom equivalent layout');
      await capture(page, 'reflow-200-equivalent');
      await page.setViewportSize({width: 1440, height: 900});
      await editor(page).focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.closest('#code-editor') === null), true);
      await page.locator('#hint-details summary').click();
      await page.locator('#hint-btn').click();
      assert.equal((await getState(page)).hintsVisible, 1);
      await page.locator('#prediction summary').click();
      await page.locator('#prediction-options input').nth(1).check();
      await page.getByRole('button',{name:'Check prediction'}).click();
      assert.match(await page.locator('#prediction-feedback').innerText(), /^Correct/);
      await page.locator('#prediction summary').click();
      await page.locator('#hint-details summary').click();
    }

    const invalid = await run(page, 'power_core = np.zeros(', name === 'chromium');
    assert.equal(invalid.runStatus, 'error');
    assert.match(invalid.output.summary, /SyntaxError on line 1/);
    if (name === 'chromium') await capture(page, 'python-error');

    for (const width of name === 'chromium' ? [390, 1024, 1440] : [1440]) {
      const height = width === 390 ? 844 : width === 1024 ? 768 : 900;
      await page.setViewportSize({width, height});
      const wrong = await run(page, 'power_core = np.ones(power_shape, dtype=power_dtype)');
      assert.match(wrong.output.summary, /Every power cell starts at zero.*Choose the zero-filled creation function/s);
      if (name === 'chromium') await capture(page, 'failed-check-' + width);
      if (width < 1121) {
        await page.locator('#map-button').press('Enter');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#map-button').getAttribute('aria-expanded'), 'false');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'map-button');
      }
    }
    const hardcoded = await run(page,
      '# np.zeros(power_shape, dtype=power_dtype)\npower_core = np.zeros((3, 4), dtype=np.float64)');
    assert.equal(hardcoded.checkpoint.complete, false);
    assert.match(hardcoded.output.summary, /visible sample passed/i);
    assert.match(await page.locator('#validation-list').innerText(), /visible sample passed/i);
    if (name === 'chromium') {
      await editor(page).fill('import time\ntime.sleep(0.5)\npower_core = np.zeros(power_shape, dtype=power_dtype)');
      await runButton(page).click();
      await page.getByText('Running Python…', {exact: true}).waitFor();
      await editor(page).fill('# changed while the worker was running');
      await page.getByText('Last run shown. Your draft has changed.', {exact: true}).waitFor();
      assert.equal((await getState(page)).checkpoint.complete, false);
    }
    await checkResetRace(browser);
    const peer = await context.newPage();
    await peer.goto(site.url);
    await ready(peer);
    const equivalent = await run(page, [
      'import warnings',
      'assert np.get_printoptions()["precision"] == 8',
      'warnings.warn("fresh fixture")',
      'warnings.simplefilter("error", UserWarning)',
      'np.set_printoptions(precision=1)',
      'power_core = np.full(power_shape, 0, dtype=power_dtype)',
    ].join('\n'), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'next-btn');
    assert.equal(equivalent.checkpoint.complete, true);
    if (name === 'chromium') {
      for (const [width, height] of [[390, 844], [1024, 768], [1440, 900]]) {
        await page.setViewportSize({width, height});
        await page.evaluate(() => window.scrollTo(0, 0));
        const advance = page.locator('#next-btn');
        const box = await advance.boundingBox();
        const code = await page.locator('#code-editor').boundingBox();
        assert.ok(box.y >= 0 && box.y + box.height <= Math.min(height, code.y), 'Advance is visible above the editor at ' + width);
        assert.equal(await advance.evaluate(node => getComputedStyle(node).fontFamily),
          await runButton(page).evaluate(node => getComputedStyle(node).fontFamily));
        await capture(page, 'advance-' + width);
      }
    }
    const core = await inspect(page, 'power_core');
    assert.deepEqual(core.cells.map(row => row.length), [4,4,4]);
    if (name === 'chromium') await capture(page,'boot-restored');
    await editor(page).fill('# saved edit after a successful run');
    const stale = await getState(page);
    assert.equal(stale.lastRunMatchesDraft, false);
    assert.match(stale.output.summary, /Last run shown/);
    const idle = stale.shipDraws;
    await page.waitForTimeout(160);
    assert.equal((await getState(page)).shipDraws, idle);
    await page.reload();
    await ready(page);
    assert.equal((await getState(page)).checkpoint.complete, true);
    assert.match(await draftText(page), /saved edit/);
    await next(page);
    assert.match(await page.locator('#setup-details summary').innerText(), /low, high, sample_count/);
    await clear(page, campaign[1]);
    const peerDraft = '# edited from a second tab opened before the clear';
    await editor(peer).fill(peerDraft);
    await peer.waitForFunction(draft => {
      const save = JSON.parse(localStorage.getItem('numpy-nebula-save'));
      return save?.drafts['boot-power-core'] === draft;
    }, peerDraft);
    await peer.locator('#reset-btn').click();
    await peer.getByRole('dialog', {name:'Reset this draft?'}).getByRole('button', {name:'Reset draft'}).click();
    await peer.waitForFunction(() => {
      const save = JSON.parse(localStorage.getItem('numpy-nebula-save'));
      return save && !Object.hasOwn(save.drafts, 'boot-power-core');
    });
    await peer.close();
    await page.reload();
    await ready(page);
    const afterPeer = await getState(page);
    assert.equal(afterPeer.checkpoint.id, campaign[1].id, 'Peer draft operations must preserve the active checkpoint');
    assert.equal(afterPeer.progress.labUnlocked, true, 'Peer draft operations must preserve both Boot Bay clears');
    const calibrationDraft = await page.evaluate(id =>
      JSON.parse(localStorage.getItem('numpy-nebula-save')).drafts[id], campaign[1].id);
    assert.equal(calibrationDraft, solutions[campaign[1].id], 'Peer reset must preserve the other workspace draft');
    await run(page, solutions[campaign[1].id]);
    const vector = await inspect(page, 'course_line');
    assert.equal(vector.cells[0][0].index, '[0]');
    assert.equal((await getState(page)).progress.labUnlocked, true);

    await page.locator('[data-mode="lab"]').click();
    const probe = [
      'tall = np.arange(40).reshape(20, 2)',
      'vector = np.arange(40)',
      'wide = np.arange(64).reshape(2, 32)',
      'rank4 = np.arange(24).reshape(2, 2, 2, 3)',
      'empty = np.zeros((0, 2))',
      'complex_values = np.array([1+2j, np.inf, np.nan])',
      'scalar = np.array(2.5)',
      'mask = np.array([True, False])',
      "large_dtype = np.zeros(1, dtype=[('x' * 200000, 'i1')])",
      "globals()['x' * 200000] = np.array([1])",
      "print('é' * 20000)",
    ].join('\n');
    for (const ending of ['', '\nraise ValueError("test cleanup")']) {
      await run(page, 'import warnings\nnp.set_printoptions(precision=1)\nwarnings.simplefilter("error", UserWarning)' + ending);
      const clean = await run(page, 'import warnings\nwarnings.warn("still a warning")\nprint(np.array([1/3]))');
      assert.equal(clean.runStatus, 'success');
      assert.equal(clean.output.stdout.trim(), '[0.33333333]');
      assert.match(await page.locator('#stderr-pane').textContent(), /UserWarning: still a warning/);
    }
    const lab = await run(page, probe);
    assert.equal(lab.phase, 'lab');
    assert.equal(lab.runStatus, 'success');
    assert.ok(lab.arrays.every(output => output.name.length <= 128));
    assert.ok(lab.arrays.find(output => output.name === 'large_dtype').dtype.length <= 160);
    assert.ok(Buffer.byteLength(lab.output.stdout, 'utf8') <= 32768);
    assert.match(await page.locator('#stdout-pane').textContent(), /Output truncated at 32 KiB/);
    await page.setViewportSize({width: 390,height: 844});
    const wide = await inspect(page, 'wide');
    assert.equal(wide.cells[0].length, 16);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    const nextColumn = page.getByRole('button', {name: 'Next columns'});
    await nextColumn.press('Enter');
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeValue?.preview?.selection.col === 16);
    await checkBoundary(page, nextColumn);
    const previousColumn = page.getByRole('button', {name: 'Previous columns'});
    await previousColumn.press('Enter');
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeValue?.preview?.selection.col === 0);
    await checkBoundary(page, previousColumn);
    await inspect(page, 'vector');
    await nextColumn.press('Enter');
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeValue?.preview?.selection.col === 16);
    await nextColumn.press('Enter');
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeValue?.preview?.selection.col === 32);
    await checkBoundary(page, nextColumn);
    await inspect(page, 'tall');
    for (const [label, row] of [['Next rows', 16], ['Previous rows', 0]]) {
      const control = page.getByRole('button', {name: label});
      await control.press('Enter');
      await page.waitForFunction(row => JSON.parse(window.render_game_to_text()).activeValue?.preview?.selection.row === row, row);
      await checkBoundary(page, control);
    }
    const rank4 = await inspect(page, 'rank4');
    assert.equal(rank4.cells[0][0].index, '[0, 0, 0, 0]');
    const axis = page.getByLabel('Axis 0', {exact: true});
    await axis.fill('1');
    await axis.press('Tab');
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeValue?.preview?.selection.axes[0] === 1);
    assert.match((await inspect(page, 'empty')).text, /empty/);
    assert.match((await inspect(page, 'complex_values')).cells[0][0].value, /1\+2j/);
    assert.equal((await inspect(page, 'scalar')).text, '2.5');
    assert.equal((await inspect(page, 'mask')).cells[0][1].value, 'False');
    await page.locator('#dataset-select').selectOption(labDatasets[1].id);
    assert.equal((await getState(page)).checkpoint.id, 'lab:' + labDatasets[1].id);
    await page.locator('#dataset-select').selectOption(labDatasets[0].id);
    assert.match(await draftText(page), /rank4/);

    await editor(page).fill('while True:\n    pass');
    await runButton(page).press('Enter');
    await page.getByText('Running Python…', {exact:true}).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'run-btn');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'stop-btn');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'run-btn');
    assert.match(await page.locator('#run-summary').textContent(), /Run stopped/);
    await ready(page);
    const recovered = await run(page, "output = np.array([4, 5])\nprint('recovered')");
    assert.equal(recovered.output.stdout.trim(), 'recovered');
    if (name === 'chromium') {
      await editor(page).fill('while True:\n    pass');
      await runButton(page).click();
      await page.getByText(/Time limit reached after 10 seconds/).waitFor({timeout: 16000});
      await ready(page);
      await capture(page,'mobile-lab');
    }

    await page.locator('[data-mode="campaign"]').click();
    assert.equal((await getState(page)).checkpoint.id, campaign[1].id);
    await page.setViewportSize({width: 1440,height: 900});
    for (const checkpoint of campaign.slice(2)) {
      await next(page);
      if (checkpoint.id === 'sensor-panel-reading') {
        const original = solutions[checkpoint.id];
        const rewritten = await run(page, 'sensor_grid[:] = 0\n' + original);
        assert.equal(rewritten.checkpoint.complete, false, 'Replacing telemetry cannot complete a read-only lesson');
        const alternative = await run(page, original.replace('sensor_grid[0]', 'sensor_grid[0, :]')
          .replace('sensor_grid[priority_rows, priority_cols]', 'sensor_grid[(priority_rows, priority_cols)]'));
        assert.equal(alternative.checkpoint.complete, true, 'Equivalent paired indexing should pass');
      }
      if (checkpoint.id === 'sensor-view-snapshot') {
        const wrongView = await run(page, [
          'snapshot = sensor_grid.copy()',
          'view_patch = sensor_grid[:, 2:4]',
          'sensor_grid[:, 1:3] += delta',
        ].join('\n'));
        assert.equal(wrongView.checkpoint.complete, false, 'A view of the wrong columns cannot pass');
        const copiedView = await run(page, [
          'snapshot = sensor_grid.copy()',
          'view_patch = sensor_grid[:, 1:3].copy()',
          'sensor_grid[:, 1:3] += delta',
        ].join('\n'));
        assert.equal(copiedView.checkpoint.complete, false, 'A copy cannot pass a view check');
      }
      await clear(page, checkpoint);
    }
    const restored = await getState(page);
    assert.equal(restored.progress.completed.length,7);
    assert.equal(restored.progress.nebulaUnlocked,true);
    await page.locator('#next-btn').click();
    await page.getByRole('dialog', {name:'Colony ship restored'}).waitFor();
    if (name === 'chromium') await capture(page, 'campaign-ending');
    await page.getByRole('button',{name:'Enter Nebula Mode'}).click();
    assert.equal(await page.locator('#map-key-complete').innerText(), 'Cleared');
    assert.equal(await page.locator('#map-key-pending').innerText(), 'Not yet cleared');
    await page.locator('[data-mode="campaign"]').click();
    assert.equal(await page.locator('#map-key-complete').innerText(), 'Online');
    await page.locator('[data-mode="lab"]').click();
    assert.equal(await page.locator('#map-key-pending').innerText(), 'Awaiting repair');
    await page.locator('[data-mode="nebula"]').click();
    assert.equal(await page.locator('#map-key-complete').innerText(), 'Cleared');
    for (const [index, challenge] of challenges.entries()) {
      if (index) await next(page);
      await clear(page, challenge);
    }
    await page.locator('#next-btn').click();
    const log = page.getByRole('dialog',{name:'Ship Log'});
    await log.waitFor();
    assert.equal(await log.locator('article').count(), 14);
    if (name === 'chromium') await capture(page, 'ship-log');
    await log.getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    const settings = page.getByRole('dialog',{name:'Settings'});
    await settings.getByLabel('Plain-text editor').check();
    await settings.getByRole('button',{name:'Close',exact:true}).click();
    assert.equal(await editor(page).evaluate(node => node.tagName), 'TEXTAREA');
    const beforeReset = await getState(page);
    await page.locator('#reset-btn').click();
    await page.getByRole('dialog',{name:'Reset this draft?'}).getByRole('button',{name:'Reset draft'}).click();
    assert.deepEqual((await getState(page)).progress.checkpoints,beforeReset.progress.checkpoints);
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await settings.getByRole('button',{name:'Start over'}).click();
    await page.getByRole('dialog',{name:'Start over?'}).getByRole('button',{name:'Start over'}).click();
    assert.equal((await getState(page)).progress.completed.length,0);
    await editor(page).focus();
    await editor(page).press('Shift');
    assert.equal(await editor(page).evaluate(node => getComputedStyle(node).outlineWidth), '2px');
    assert.equal((await run(page, solutions[campaign[0].id], true)).runStatus, 'success');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'next-btn');
    assert.deepEqual(errors,[]);
    assert.deepEqual(external,[]);
    if (name === 'chromium') {
      for (const pattern of [/python-worker-.*\.js$/, /pyodide\.mjs$/, /\.wasm(?:\.gz)?$/, /numpy-.*\.whl$/,
        /rich-editor-.*\.js$/, /\.woff2$/, /ship-cutaway\.webp$/]) {
        assert.ok([...loaded].some(path => pattern.test(path)), 'Missing production asset ' + pattern);
      }
    }

    if (name === 'chromium') {
      const offline = await browser.newPage({viewport:{width:390,height:844}, hasTouch:true, isMobile:true});
      await offline.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', {get() {throw Error('Storage denied for test');}});
      });
      const block = '**/runtime/0.26.3/pyodide.mjs';
      await offline.route(block, route => route.abort());
      await offline.goto(site.url);
      await offline.getByText('Runtime offline',{exact:true}).waitFor();
      assert.ok(await offline.locator('#storage-notice').isVisible());
      const fallbackEditor = offline.locator('#code-editor textarea');
      await fallbackEditor.focus();
      await fallbackEditor.press('Shift');
      assert.equal(await fallbackEditor.evaluate(node => getComputedStyle(node).outlineWidth), '2px');
      await offline.unroute(block);
      await offline.getByRole('button',{name:'Retry engine'}).tap();
      await ready(offline);
      await clear(offline,campaign[0]);
      assert.equal((await getState(offline)).checkpoint.complete,true);

      // A temporary quota error during Start over must not strand subsequent saves.
      await page.evaluate(() => {
        const write = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
          if (key === 'numpy-nebula-save') throw new DOMException('Full', 'QuotaExceededError');
          return write.call(this, key, value);
        };
        window.restoreStorage = () => { Storage.prototype.setItem = write; };
      });
      await page.locator('#settings-button').click();
      await page.locator('#new-game').click();
      await page.locator('#confirm-action').click();
      await page.locator('#storage-notice').waitFor();
      await page.evaluate(() => window.restoreStorage());
      await editor(page).fill('# draft after recovery');
      await page.locator('#storage-notice').waitFor({state:'hidden'});
      await page.reload();
      await ready(page);
      assert.deepEqual((await getState(page)).progress.checkpoints, []);
      assert.equal(await draftText(page), '# draft after recovery');
    }

    console.log(name + ' passed: production subpath, all 15 campaign checkpoints and seven challenges, Lab, worker stop/recovery, inspector, save/reset, and console/network checks.');
  } finally {
    await browser.close();
  }
}

try {
  for (const name of names) await play(name);
} finally {
  await site.close();
}
