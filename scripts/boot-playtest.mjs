import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {serveBuild} from './static-server.mjs';

const site = await serveBuild();
const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const editor = page.getByRole('textbox', {name: 'NumPy mission code editor'});
const summary = page.locator('#run-summary');
async function capture(name) {
  if (!process.env.NEBULA_SHOTS) return;
  await mkdir(process.env.NEBULA_SHOTS, {recursive: true});
  const path = resolve(process.env.NEBULA_SHOTS, name + '.png');
  const image = await page.screenshot({path});
  assert.ok((await readFile(path)).equals(image));
}
try {
  await page.goto(site.url);
  await page.getByText('NumPy ready', {exact: true}).waitFor();
  const pyodideBoot = await page.evaluate(() => JSON.parse(window.render_game_to_text()).checkpoint.id);
  assert.equal(pyodideBoot, 'boot-power-core');
  assert.ok((await editor.boundingBox()).y < 844);
  assert.ok((await page.locator('#run-btn').boundingBox()).y < 844);
  await capture('touch-opening');
  await editor.fill('power_core = np.zeros(');
  await editor.press('Control+Enter');
  await page.getByText(/SyntaxError on line 1/).waitFor();
  assert.ok((await summary.boundingBox()).y < 844);
  await editor.fill('power_core = np.ones(power_shape, dtype=power_dtype)');
  await page.locator('#run-btn').tap();
  await page.getByText(/checks passed/).waitFor();
  assert.ok((await summary.textContent()).startsWith('2 of 3'));
  await editor.fill('power_core = np.zeros(power_shape, dtype=power_dtype)');
  await page.locator('#run-btn').tap();
  await page.getByText('Checkpoint complete.', {exact: true}).waitFor();
  assert.ok((await page.locator('#next-btn').boundingBox()).y < 844);
  await capture('touch-repair');
  await page.locator('.array-table').waitFor();
  assert.ok((await page.locator('.meta').textContent()).includes('float64'));
  await page.reload();
  await page.getByText('NumPy ready', {exact: true}).waitFor();
  const current = await editor.evaluate(node => node instanceof HTMLTextAreaElement ? node.value : node.textContent);
  assert.ok(current.includes('np.zeros(power_shape'));
  assert.deepEqual(errors, []);
  console.log('Boot Bay slice passed: touch layout, syntax error, failed check, successful repair, inspector, draft and checkpoint reload.');
} finally {
  await browser.close();
  await site.close();
}
