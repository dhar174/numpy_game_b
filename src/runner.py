import ast
import contextlib
from copy import deepcopy
import io
from itertools import islice
import json
import math
import operator
import traceback
import warnings
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


def checked_division(operation):
    """Observe executed divisions on the hidden traffic fixture, including on plain copies."""
    def divide(left, right, *args, **kwargs):
        # Pyodide can return NaN for 0/0 without a floating-point warning.
        active = kwargs.get("where", True)
        if np.ma.isMaskedArray(left) or np.ma.isMaskedArray(right):
            active = active & ~np.ma.getmaskarray(left) & ~np.ma.getmaskarray(right)
        _, divisor, mask = np.broadcast_arrays(left, right, active)
        if np.any((divisor == 0) & mask):
            raise FloatingPointError("Division evaluated a zero row total. Mask the division or use a safe denominator.")
        return operation(left, right, *args, **kwargs)
    return divide


class DivisionProbe(ast.NodeTransformer):
    """Keep normal NumPy arrays, broadcasting, and out= semantics in the grading case."""
    def visit_BinOp(self, node):
        self.generic_visit(node)
        if isinstance(node.op, ast.Div):
            call = ast.Call(ast.Name("__divide", ast.Load()), [node.left, node.right], [])
            return ast.copy_location(call, node)
        return node

    def visit_AugAssign(self, node):
        self.generic_visit(node)
        if not isinstance(node.op, ast.Div):
            return node
        target = node.target
        if isinstance(target, ast.Name):
            call = ast.Call(ast.Name("__idivide", ast.Load()), [ast.Name(target.id, ast.Load()), node.value], [])
            return ast.copy_location(ast.Assign([target], call), node)
        # Load the target once, before evaluating the right-hand side, just as /= does.
        if isinstance(target, ast.Subscript):
            receiver, key, helper = target.value, target.slice, "__divide_item"
        else:
            receiver, key, helper = target.value, ast.Constant(target.attr), "__divide_attr"
        setter = ast.Call(ast.Name(helper, ast.Load()), [receiver, key], [])
        return ast.copy_location(ast.Expr(ast.Call(setter, [node.value], [])), node)

    def visit_Call(self, node):
        self.generic_visit(node)
        # Resolve the actual callable so aliases of np.divide work as usual.
        node.func = ast.copy_location(ast.Call(ast.Name("__probe_callable", ast.Load()), [node.func], []), node.func)
        return node


def compile_traffic_case(source, scope):
    guarded_ufunc = checked_division(np.divide)
    inplace = checked_division(operator.itruediv)

    def assign_division(receiver, key, get, put):
        original = get(receiver, key)
        return lambda denominator: put(receiver, key, inplace(original, denominator))

    scope.update(
        __divide=checked_division(operator.truediv), __idivide=inplace,
        __divide_item=lambda obj, key: assign_division(obj, key, operator.getitem, operator.setitem),
        __divide_attr=lambda obj, key: assign_division(obj, key, getattr, setattr),
        __probe_callable=lambda function: guarded_ufunc if function is np.divide else function,
    )
    tree = DivisionProbe().visit(ast.parse(source, "<mission>"))
    return compile(ast.fix_missing_locations(tree), "<mission>", "exec")


def run_case(setup, source, checks, guard_division=False):
    scope = {"np": np, "__name__": "__main__"}
    stdout = BoundedStream()
    stderr = BoundedStream()
    error = None
    passed = []
    with (warnings.catch_warnings(), np.printoptions(),
          contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr)):
        try:
            exec(compile(setup, "<setup>", "exec"), scope)
            initial = deepcopy({name: value for name, value in scope.items()
                                if not name.startswith("_") and name != "np"}) if checks else {}
            code = compile_traffic_case(source, scope) if guard_division else compile(source, "<mission>", "exec")
            exec(code, scope)
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
            payload["alternate"], payload["source"], checks, payload.get("guardDivision", False))
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
