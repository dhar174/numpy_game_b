import assets from '../runtime-assets.json';
import type {EngineStatus, RunInput, Selection, WorkerReply, WorkerRequest} from './protocol';

type Event = WorkerReply | {kind: 'loading'} | {kind: 'stopped'; reason: string};

export class Engine {
  status: EngineStatus = 'loading';
  activeRun: RunInput | null = null;
  #worker: Worker | null = null;
  #deadline: number | undefined;
  #inspectionDeadline: number | undefined;
  #inspectionRequestId = 0;

  constructor(private readonly onEvent: (event: Event) => void) {}

  start() {
    this.#dispose();
    this.status = 'loading';
    this.onEvent({kind: 'loading'});
    try {
      const worker = new Worker(new URL('./python-worker.ts', import.meta.url), {type: 'module'});
      this.#worker = worker;
      this.#deadline = window.setTimeout(() => this.#fail('The NumPy runtime took too long to load.'), 30000);
      worker.onmessage = ({data}: MessageEvent<WorkerReply>) => {
        if (worker !== this.#worker) return;
        if (data.kind === 'failure') {
          this.#fail(data.message);
          return;
        }
        if (data.kind === 'ready') {
          this.status = 'ready';
          window.clearTimeout(this.#deadline);
        } else if (data.kind === 'result') {
          if (this.activeRun?.runId !== data.runId) return;
          this.activeRun = null;
          window.clearTimeout(this.#deadline);
        } else if (data.kind === 'preview' && data.requestId === this.#inspectionRequestId) {
          window.clearTimeout(this.#inspectionDeadline);
        }
        this.onEvent(data);
      };
      worker.onerror = event => {
        event.preventDefault();
        if (worker === this.#worker) this.#fail(event.message || 'The Python worker closed unexpectedly.');
      };
      this.#post({kind: 'init', url: new URL('runtime/' + assets.version + '/', document.baseURI).href});
    } catch (error) {
      this.#fail(error instanceof Error ? error.message : String(error));
    }
  }

  run(input: RunInput) {
    if (this.status !== 'ready' || this.activeRun || !this.#worker) return false;
    this.activeRun = input;
    this.#deadline = window.setTimeout(
      () => this.stop('Time limit reached after 10 seconds. Edit the code and try again.'), 10000,
    );
    this.#post({kind: 'run', input});
    return true;
  }

  inspect(requestId: number, runId: number, selection: Selection) {
    if (this.status !== 'ready' || this.activeRun) return;
    window.clearTimeout(this.#inspectionDeadline);
    this.#inspectionRequestId = requestId;
    this.#inspectionDeadline = window.setTimeout(
      () => this.stop('This value took too long to inspect. Try a smaller output.'), 3000,
    );
    this.#post({kind: 'inspect', requestId, runId, selection});
  }

  stop(reason = 'Run stopped. Your draft is still open.') {
    this.start();
    this.onEvent({kind: 'stopped', reason});
  }

  #post(message: WorkerRequest) {
    this.#worker?.postMessage(message);
  }

  #dispose() {
    window.clearTimeout(this.#deadline);
    window.clearTimeout(this.#inspectionDeadline);
    this.#worker?.terminate();
    this.#worker = null;
    this.activeRun = null;
  }

  #fail(message: string) {
    this.#dispose();
    this.status = 'failed';
    this.onEvent({kind: 'failure', message});
  }
}
