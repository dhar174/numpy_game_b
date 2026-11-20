import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {serveBuild} from './static-server.mjs';

const site = await serveBuild();
const browser = await chromium.launch();
const timings = [];
try {
  for (let trial = 0; trial < 3; trial++) {
    const context = await browser.newContext({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'});
    const page = await context.newPage();
    const client = await context.newCDPSession(page);
    await client.send('Network.enable');
    await client.send('Network.setCacheDisabled', {cacheDisabled: true});
    await client.send('Network.emulateNetworkConditions', {
      offline: false, latency: 50, downloadThroughput: 25_000_000 / 8, uploadThroughput: 25_000_000 / 8,
    });
    await client.send('Emulation.setCPUThrottlingRate', {rate: 4});
    await page.addInitScript(() => {
      const sample = {shell: null, ready: null, longTasks: []};
      window.__testTiming = sample;
      new PerformanceObserver(entries => {
        sample.longTasks.push(...entries.getEntries().map(({startTime, duration}) => ({startTime, duration})));
      }).observe({type: 'longtask', buffered: true});
      function measure() {
        if (sample.shell === null && typeof window.render_game_to_text === 'function'
            && document.querySelector('#code-editor [role="textbox"]')) sample.shell = performance.now();
        if (document.querySelector('#engine-status')?.dataset.state === 'ready') sample.ready = performance.now();
        else requestAnimationFrame(measure);
      }
      requestAnimationFrame(measure);
    });
    await page.goto(site.url);
    await page.waitForFunction(() => window.__testTiming.ready !== null, null, {timeout: 30000});
    const timing = await page.evaluate(() => ({
      shell: Math.round(window.__testTiming.shell), ready: Math.round(window.__testTiming.ready),
    }));
    timings.push(timing);
    if (trial === 0) {
      await client.send('Emulation.setCPUThrottlingRate', {rate: 1});
      await page.getByRole('textbox', {name: 'NumPy mission code editor'})
        .fill("import time\nstart = time.monotonic()\nwhile time.monotonic() - start < 0.55:\n    pass\nprint('computation completed')");
      const began = await page.evaluate(() => performance.now());
      await page.locator('#run-btn').click();
      await page.getByText('Running Python…', {exact: true}).waitFor();
      await page.getByRole('button',{name:'Settings'}).click();
      const inFlight = await page.evaluate(() => ({
        dialog: document.querySelector('#settings-dialog').open,
        running: JSON.parse(window.render_game_to_text()).runStatus === 'running',
      }));
      assert.deepEqual(inFlight, {dialog: true, running: true});
      await page.getByRole('dialog',{name:'Settings'}).getByRole('button',{name:'Close'}).click();
      await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).output.stdout.includes('computation completed'));
      const tasks = await page.evaluate(start => window.__testTiming.longTasks.filter(task => task.startTime >= start), began);
      assert.deepEqual(tasks, [], 'Main-thread long task while running Python');
      console.log('Settings opened during a 550 ms Python calculation with zero main-thread long tasks in that interval.');
    }
    await context.close();
  }
  const median = prop => timings.map(timing => timing[prop]).sort((a,b) => a-b)[1];
  console.log(JSON.stringify({profile: 'cold Chromium, 4× CPU, 25 Mbps, 50 ms', timings,
    shellMedianMs: median('shell'), readyMedianMs: median('ready')}));
  assert.ok(median('shell') <= 1500, 'Interactive shell exceeded 1.5 seconds');
  assert.ok(median('ready') <= 8000, 'NumPy readiness exceeded 8 seconds');
} finally {
  await browser.close();
  await site.close();
}
