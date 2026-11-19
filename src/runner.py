import contextlib
from copy import deepcopy
import io
from itertools import islice
import json
import math
import traceback
import numpy as np

MAX_STREAM = 32768
MAX_OUTPUTS = 40
MAX_NAME = 128
PAGE = 16
_visible = {}


class BoundedStream(io.TextIOBase):
    def __init__(self):
        self.data = bytearray()
        self.truncated = False

    def write(self, text):
        remaining = MAX_STREAM - len(self.data)
        if remaining > 0:
            # Slice before encoding so a large write does not allocate another
            # full copy of its input.
            chunk = text[:remaining].encode("utf-8", errors="replace")
            self.data.extend(chunk[:remaining])
            self.truncated |= len(chunk) > remaining or len(text) > remaining
        else:
            self.truncated |= bool(text)
        return len(text)

    def text(self):
        return self.data.decode("utf-8", errors="ignore")


def describe_error(exc):
    frames = traceback.extract_tb(exc.__traceback__, limit=-12)
    line = next((frame.lineno for frame in reversed(frames)
                 if frame.filename == "<mission>"), None)
    if isinstance(exc, SyntaxError) and exc.filename == "<mission>":
        line = exc.lineno
    return {
        "name": type(exc).__name__,
        "message": str(exc)[:1500],
        "line": line,
        "traceback": "".join(traceback.format_exception(exc, limit=-8))[-6000:],
    }


def run_case(setup, source, checks):
    scope = {"np": np, "__name__": "__main__"}
    stdout = BoundedStream()
    stderr = BoundedStream()
    error = None
    passed = []
    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
        try:
            exec(compile(setup, "<setup>", "exec"), scope)
            initial = deepcopy({name: value for name, value in scope.items()
                                if not name.startswith("_") and name != "np"}) if checks else {}
            exec(compile(source, "<mission>", "exec"), scope)
            scope["__initial"] = initial
        except BaseException as exc:
            error = describe_error(exc)
        if error is None:
            for check in checks:
                try:
                    passed.append(bool(eval(check["expr"], scope)))
                except Exception:
                    passed.append(False)
    return scope, stdout, stderr, error, passed


def bounded_label(text, limit):
    return text if len(text) <= limit else text[:limit - 1] + "…"


def output_info(name, value):
    if isinstance(value, np.ndarray):
        return {"name": name, "type": "ndarray", "shape": list(value.shape),
                "dtype": bounded_label(str(value.dtype), 160), "ndim": value.ndim, "size": value.size}
    return {"name": name, "type": bounded_label(type(value).__name__, 100), "shape": None}


def run_request(raw):
    global _visible
    payload = json.loads(raw)
    _visible = {}
    checks = payload["checks"]
    scope, stdout, stderr, error, first = run_case(
        payload["setup"], payload["source"], checks)
    visible = ((name, value) for name, value in reversed(scope.items())
               if isinstance(name, str) and len(name) <= MAX_NAME
               and not name.startswith("_") and name != "np")
    _visible = dict(reversed(list(islice(visible, MAX_OUTPUTS))))
    second_error = None
    second = first
    if not error and payload.get("alternate") is not None and all(first):
        _, _, _, second_error, second = run_case(
            payload["alternate"], payload["source"], checks)
    report = [] if error else [
        {"label": check["label"], "hint": check["hint"],
         "samplePassed": first[i], "passed": first[i] and i < len(second) and second[i]}
        for i, check in enumerate(checks)
    ]
    return json.dumps({
        "stdout": stdout.text(), "stderr": stderr.text(),
        "stdoutTruncated": stdout.truncated, "stderrTruncated": stderr.truncated,
        "error": error, "alternateError": second_error, "checks": report,
        "arrays": [output_info(name, value) for name, value in _visible.items()],
    }, ensure_ascii=True)


def safe_text(value, remaining=3):
    if isinstance(value, np.generic):
        item = value.item()
        value = str(item) if isinstance(item, np.generic) else item
    cls = type(value)
    if cls is str:
        return repr(value[:120]) + ("…" if len(value) > 120 else "")
    if cls is int:
        return str(value) if value.bit_length() < 300 else "<large integer>"
    if cls is float:
        if math.isnan(value):
            return "NaN"
        if math.isinf(value):
            return "−∞" if value < 0 else "+∞"
        return format(value, ".8g")
    if cls is complex:
        return str(value)
    if value is None or cls is bool:
        return str(value)
    if remaining > 0 and cls in (list, tuple, dict):
        if cls is dict:
            items = [safe_text(key, remaining - 1) + ": " + safe_text(item, remaining - 1)
                     for key, item in islice(value.items(), 10)]
            left, right = "{", "}"
        else:
            items = [safe_text(item, remaining - 1) for item in value[:10]]
            left, right = ("[", "]") if cls is list else ("(", ")")
        if len(value) > 10:
            items.append("…")
        return (left + ", ".join(items) + right)[:900]
    return "<" + cls.__name__[:100] + ">"


def inspect_request(raw):
    selected = json.loads(raw)
    name = selected["name"]
    if name not in _visible:
        return "null"
    value = _visible[name]
    if not isinstance(value, np.ndarray) or value.ndim == 0:
        text = safe_text(value[()] if isinstance(value, np.ndarray) else value)
        return json.dumps({"selection": selected, "text": text, "cells": [],
                           "rows": 0, "cols": 0})
    if value.size == 0:
        return json.dumps({"selection": selected, "text": "This array is empty.",
                           "cells": [], "rows": 0, "cols": 0})
    axes = [min(max(0, selected["axes"][i] if i < len(selected["axes"]) else 0), n - 1)
            for i, n in enumerate(value.shape[:-2])]
    rows = value.shape[-2] if value.ndim > 1 else 1
    cols = value.shape[-1]
    row = min(max(0, selected["row"]), ((rows - 1) // PAGE) * PAGE)
    col = min(max(0, selected["col"]), ((cols - 1) // PAGE) * PAGE)
    selected.update({"row": row, "col": col, "axes": axes})
    cells = []
    for r in range(row, min(row + PAGE, rows)):
        line = []
        for c in range(col, min(col + PAGE, cols)):
            index = (c,) if value.ndim == 1 else (*axes, r, c)
            item = value[index]
            tone = ""
            if isinstance(item, (bool, np.bool_)):
                tone = "true" if item else "false"
            elif isinstance(item, (float, complex, np.floating, np.complexfloating)) and not np.isfinite(item):
                tone = "special"
            line.append({"index": "[" + ", ".join(map(str, index)) + "]",
                         "value": safe_text(item), "tone": tone})
        cells.append(line)
    return json.dumps({"selection": selected, "cells": cells, "rows": rows, "cols": cols})
