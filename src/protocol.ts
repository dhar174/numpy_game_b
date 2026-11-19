export type EngineStatus = 'loading' | 'ready' | 'failed';
export type OutputInfo = {
  name: string;
  type: string;
  shape: number[] | null;
  dtype?: string;
  ndim?: number;
  size?: number;
};

export type RunInput = {
  runId: number;
  checkpointId: string;
  revision: number;
  source: string;
  setup: string;
  alternate?: string;
  checks: {label: string; expr: string; hint: string}[];
};

export type PythonError = {name: string; message: string; line: number | null; traceback: string};
export type RunCheck = {label: string; hint: string; passed: boolean; samplePassed: boolean};
export type RunResult = {
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  error: PythonError | null;
  alternateError: PythonError | null;
  checks: RunCheck[];
  arrays: OutputInfo[];
};

export type Selection = {name: string; row: number; col: number; axes: number[]};
export type Preview = {
  selection: Selection;
  rows: number;
  cols: number;
  cells: {index: string; value: string; tone: string}[][];
  text?: string;
};

export type WorkerRequest =
  | {kind: 'init'; url: string}
  | {kind: 'run'; input: RunInput}
  | {kind: 'inspect'; requestId: number; runId: number; selection: Selection};

export type WorkerReply =
  | {kind: 'ready'}
  | {kind: 'failure'; message: string}
  | {kind: 'result'; runId: number; checkpointId: string; revision: number; result: RunResult}
  | {kind: 'preview'; requestId: number; runId: number; preview: Preview | null};
