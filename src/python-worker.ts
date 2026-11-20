import type { loadPyodide } from 'pyodide';
import assets from '../runtime-assets.json';
import runnerSource from './runner.py?raw';
import type { Preview, RunResult, WorkerReply, WorkerRequest } from './protocol';

let runtime: Awaited<ReturnType<typeof loadPyodide>> | undefined;
let execute: ((input: string) => string) | undefined;
let inspect: ((input: string) => string) | undefined;
let activeRunId = 0;

const send = (message: WorkerReply) => self.postMessage(message);

// Pages can serve this portable gzip asset without special header configuration.
async function bootRuntime(indexURL: string) {
  const moduleUrl = new URL('pyodide.mjs', indexURL).href;
  const wasmUrl = new URL('pyodide.asm.wasm', indexURL).href;
  const wheelUrl = new URL(assets.numpyWheel, indexURL).href;
  const originalFetch = self.fetch;
  const request: typeof fetch = originalFetch.bind(self);
  const preload = (url: string) => request(url).catch(() => null);
  const bigAssets = new Map([[wheelUrl, preload(wheelUrl)]]);
  if (typeof DecompressionStream !== 'undefined') bigAssets.set(wasmUrl, preload(wasmUrl + '.gz'));
  const module: {loadPyodide: typeof loadPyodide} = await import(/* @vite-ignore */ moduleUrl);
  self.fetch = async (input, options) => {
    const url = input instanceof Request ? input.url : new URL(input, self.location.href).href;
    const pending = bigAssets.get(url);
    if (pending) {
      bigAssets.delete(url);
      const cached = await pending;
      if (cached?.ok && cached.body) {
        if (url === wheelUrl) return cached;
        // Vite may mark this file as encoded Wasm, which fetch already decodes.
        const embeddedEncoding = cached.headers.get('content-type')?.split(';')[0] === 'application/wasm'
          && cached.headers.has('content-encoding');
        const wasm = embeddedEncoding ? cached.body : cached.body.pipeThrough(new DecompressionStream('gzip'));
        return new Response(wasm, {headers: {'Content-Type': 'application/wasm'}});
      }
    }
    return request(input, options);
  };
  try {
    return await module.loadPyodide({indexURL, packages: ['numpy']});
  } finally {
    self.fetch = originalFetch;
  }
}

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  try {
    if (message.kind === 'init') {
      runtime = await bootRuntime(message.url);
      runtime.runPython(runnerSource);
      execute = runtime.globals.get('run_request');
      inspect = runtime.globals.get('inspect_request');
      send({kind: 'ready'});
    } else if (message.kind === 'run' && execute) {
      const {input} = message;
      activeRunId = input.runId;
      const result = JSON.parse(execute(JSON.stringify(input))) as RunResult;
      send({kind: 'result', runId: input.runId, revision: input.revision,
        checkpointId: input.checkpointId, result});
    } else if (message.kind === 'inspect' && inspect) {
      const preview = message.runId === activeRunId
        ? JSON.parse(inspect(JSON.stringify(message.selection))) as Preview : null;
      send({kind: 'preview', runId: message.runId, requestId: message.requestId, preview});
    }
  } catch (error) {
    send({kind: 'failure', message: error instanceof Error ? error.message : String(error)});
  }
});
