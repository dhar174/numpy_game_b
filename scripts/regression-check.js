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
  await page.getByText('NumPy ready', {exact: true}).waitFor();
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
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

async function play(name) {
  assert.ok(browsers[name], 'Unknown NEBULA_BROWSER ' + name);
  const browser = await browsers[name].launch();
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'});
    const errors = listen(page);
    const external = [];
    page.on('request', request => {
      if (request.url().startsWith('http') && new URL(request.url()).origin !== new URL(site.url).origin) external.push(request.url());
    });
    await page.goto(site.url);
    await ready(page);
    const initial = await getState(page);
    assert.equal(initial.checkpoint.id, 'boot-power-core');
    assert.ok(!initial.progress.labUnlocked && !initial.progress.nebulaUnlocked);
    assert.equal(await page.evaluate(() => typeof window.advanceTime), 'function');
    assert.equal(await page.locator('[data-mode="lab"]').isDisabled(), true);
    if (name === 'chromium') {
      for (const [width, height] of [[1440,900],[1240,850],[1024,768],[768,1024],[390,844],[320,640]]) {
        await checkLayout(page, width, height, String(width));
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

    const hardcoded = await run(page,
      '# np.zeros(power_shape, dtype=power_dtype)\npower_core = np.zeros((3, 4), dtype=np.float64)');
    assert.equal(hardcoded.checkpoint.complete, false);
    assert.match(await page.locator('#validation-list').innerText(), /visible sample passed/i);
    if (name === 'chromium') {
      await editor(page).fill('import time\ntime.sleep(0.5)\npower_core = np.zeros(power_shape, dtype=power_dtype)');
      await runButton(page).click();
      await page.getByText('Running Python…', {exact: true}).waitFor();
      await editor(page).fill('# changed while the worker was running');
      await page.getByText('Last run shown. Your draft has changed.', {exact: true}).waitFor();
      assert.equal((await getState(page)).checkpoint.complete, false);
    }
    const equivalent = await run(page, 'power_core = np.full(power_shape, 0, dtype=power_dtype)');
    assert.equal(equivalent.checkpoint.complete, true);
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
    await clear(page, campaign[1]);
    const vector = await inspect(page, 'course_line');
    assert.equal(vector.cells[0][0].index, '[0]');
    assert.equal((await getState(page)).progress.labUnlocked, true);

    await page.locator('[data-mode="lab"]').click();
    const probe = [
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
    await page.getByRole('button', {name: 'Next columns'}).click();
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeValue?.preview?.selection.col === 16);
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
    await runButton(page).click();
    await page.getByText('Running Python…', {exact:true}).waitFor();
    await page.getByRole('button', {name: 'Stop', exact: true}).click();
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
    assert.deepEqual(errors,[]);
    assert.deepEqual(external,[]);

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
      await offline.unroute(block);
      await offline.getByRole('button',{name:'Retry engine'}).tap();
      await ready(offline);
      await clear(offline,campaign[0]);
      assert.equal((await getState(offline)).checkpoint.complete,true);
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
