export interface Checkpoint {
  id: string;
  sectorId: string;
  title: string;
  objective: string;
  skill: string;
  starter: string;
  setup: string;
  alternate: string;
  hints: string[];
  prediction?: { question: string; options: string[]; answer: number; explanation: string };
  checks: { label: string; expr: string; hint: string }[];
}

export interface Sector {
  id: string;
  title: string;
  transmission: string;
  campaign: Checkpoint[];
  nebula: Checkpoint;
}

const py = (...lines: string[]) => lines.join("\n");
const prediction = (
  question: string,
  options: string[],
  answer: number,
  explanation: string,
) => ({ question, options, answer, explanation });
const check = (label: string, expr: string, hint: string) => ({ label, expr, hint });
const checkpoint = (data: Checkpoint): Checkpoint => data;

const bootBay: Checkpoint[] = [
  checkpoint({
    id: "boot-power-core",
    sectorId: "boot-bay",
    title: "Power Core",
    objective: "Create a zero-filled NumPy array with the shape and dtype requested by the ship.",
    skill: "Array creation, shape, and dtype",
    setup: py(
      "power_shape = (3, 4)",
      "power_dtype = np.float64",
    ),
    alternate: py(
      "power_shape = (2, 5)",
      "power_dtype = np.int32",
    ),
    starter: py(
      "# Build the power core from the supplied shape and dtype.",
      "power_core = None  # TODO: create zeros",
    ),
    hints: [
      "A shape is the list of dimensions in the array, like the rows and columns in a tray of seats.",
      "For a 2 by 3 tray of empty parcels, np.zeros((2, 3)) makes six zeros arranged in two rows.",
      "Pass power_shape to np.zeros and set dtype=power_dtype so the same recipe works for both bays.",
    ],
    prediction: prediction(
      "If power_shape is (2, 5), what will power_core.shape be?",
      ["(5, 2)", "(2, 5)", "(10,)"],
      1,
      "The shape records the two requested axes in order: two rows and five columns.",
    ),
    checks: [
      check("Power core shape matches the request", "power_core.shape == __initial['power_shape']", "Use the supplied shape tuple."),
      check("Power core dtype matches the request", "power_core.dtype == np.dtype(__initial['power_dtype'])", "Pass the requested dtype into the creation function."),
      check("Every power cell starts at zero", "bool(np.all(power_core == 0))", "Choose the zero-filled creation function."),
    ],
  }),
  checkpoint({
    id: "boot-calibration-grid",
    sectorId: "boot-bay",
    title: "Calibration Sweep",
    objective: "Build a line of evenly spaced calibration values, reshape it, and report useful metadata.",
    skill: "arange, linspace, reshape, and array metadata",
    setup: py(
      "low, high, sample_count = 0.0, 1.0, 6",
      "grid_shape = (2, 3)",
      "route_start, route_stop, route_step = 4, 15, 3",
    ),
    alternate: py(
      "low, high, sample_count = -1.5, 1.5, 8",
      "grid_shape = (2, 4)",
      "route_start, route_stop, route_step = 3, 18, 5",
    ),
    starter: py(
      "# Use the supplied calibration range and route settings.",
      "calibration = None  # TODO: evenly spaced values in grid_shape",
      "course_line = None  # TODO: route_start up to route_stop by route_step",
      "report = None  # TODO: shape, ndim, size, and dtype for calibration",
    ),
    hints: [
      "linspace is like marking equal spaces between the two ends of a measuring tape; arange steps by a fixed amount.",
      "For a different example, np.linspace(2, 8, 4).reshape(2, 2) makes a 2 by 2 table from four evenly spaced values.",
      "Use np.linspace(low, high, sample_count).reshape(grid_shape), np.arange(...) for the route, then read the four attributes from calibration.",
    ],
    prediction: prediction(
      "A 2 by 4 calibration grid has which ndim and size?",
      ["ndim 2 and size 8", "ndim 4 and size 2", "ndim 1 and size 8"],
      0,
      "ndim counts axes, while size counts all values: two axes and eight cells.",
    ),
    checks: [
      check("Calibration grid has the requested shape", "calibration.shape == __initial['grid_shape']", "Reshape the evenly spaced values."),
      check("Calibration values span the supplied endpoints evenly", "bool(np.allclose(calibration.ravel(), np.linspace(__initial['low'], __initial['high'], __initial['sample_count'])))", "linspace includes both endpoints by default."),
      check("Course line follows the supplied step", "bool(np.array_equal(course_line, np.arange(__initial['route_start'], __initial['route_stop'], __initial['route_step'])))", "arange stops before route_stop."),
      check("Report contains correct shape, ndim, size, and dtype", "report['shape'] == calibration.shape and report['ndim'] == calibration.ndim and report['size'] == calibration.size and report['dtype'] == calibration.dtype", "Read metadata from calibration after you create it."),
    ],
  }),
];

export const sectors: Sector[] = [
  {
    id: "boot-bay",
    title: "Boot Bay",
    transmission: "The ship is dark. Bring the power core online, then calibrate the first course grid.",
    campaign: bootBay,
    nebula: checkpoint({
      id: "nebula-beacon-broadcast",
      sectorId: "boot-bay",
      title: "Nebula Beacon",
      objective: "Use broadcasting to combine one value per row with one value per lane.",
      skill: "Broadcasting and output shape",
      setup: py("row_seed = np.array([[2], [5], [8]])", "lane_offset = np.array([[1, 10]])"),
      alternate: py("row_seed = np.array([[-3], [4]])", "lane_offset = np.array([[2, 5, 9, 12]])"),
      starter: py("# Combine the row signal and lane offsets without a loop.", "beacon = None  # TODO: broadcast addition"),
      hints: [
        "Broadcasting stretches compatible axes conceptually, like assigning a different postage fee to each column.",
        "If three travelers each have a base of 10, 20, and 30 and two lanes add 1 or 2, their total grid has three rows and two columns.",
        "Add row_seed and lane_offset directly; NumPy matches the length-one axes and produces the combined grid.",
      ],
      prediction: prediction(
        "What shape results from row_seed with shape (2, 1) plus lane_offset with shape (1, 4)?",
        ["(2, 4)", "(1, 4)", "(2, 1)"],
        0,
        "The singleton axes expand to fit, leaving two rows and four lanes.",
      ),
      checks: [
        check("Beacon has the broadcast shape", "beacon.shape == (__initial['row_seed'].shape[0], __initial['lane_offset'].shape[1])", "The rows come from row_seed and columns from lane_offset."),
        check("Beacon combines every row and lane value", "bool(np.array_equal(beacon, __initial['row_seed'] + __initial['lane_offset']))", "Use vectorized addition."),
      ],
    }),
  },
{
    id: "sensor-deck",
    title: "Sensor Deck",
    transmission: "Read the sensor panels carefully, then change one live window while preserving a clean snapshot.",
    campaign: [
      checkpoint({
        id: "sensor-panel-reading",
        sectorId: "sensor-deck",
        title: "Panel Reading",
        objective: "Select a row, a rectangular window, and several paired coordinates from the sensor panel.",
        skill: "Integer indexing, slicing, and fancy indexing",
        setup: py(
          "sensor_grid = np.array([[11, 12, 13, 14, 15], [21, 22, 23, 24, 25], [31, 32, 33, 34, 35], [41, 42, 43, 44, 45]])",
          "priority_rows = np.array([0, 2, 3])",
          "priority_cols = np.array([4, 1, 0])",
        ),
        alternate: py(
          "sensor_grid = np.array([[6, 7, 8, 9], [16, 17, 18, 19], [26, 27, 28, 29], [36, 37, 38, 39], [46, 47, 48, 49]])",
          "priority_rows = np.array([1, 4, 3])",
          "priority_cols = np.array([3, 0, 2])",
        ),
        starter: py("# Read the first row, the center window, and paired priority coordinates.", "first_row = None", "scan_window = None", "priority = None"),
        hints: [
          "A slice selects a continuous rectangle, while fancy indexing is like calling out separate seat coordinates.",
          "On a 4 by 5 seating chart, grid[1:3, 1:4] selects rows 1 and 2 and columns 1, 2, and 3.",
          "Use sensor_grid[0], sensor_grid[1:3, 1:4], and sensor_grid[priority_rows, priority_cols]; paired row and column arrays choose matching coordinates.",
        ],
        prediction: prediction("What shape does sensor_grid[1:3, 1:4] have?", ["(2, 3)", "(3, 2)", "(2, 4)"], 0, "The stop indexes are excluded, so rows 1 and 2 and columns 1 through 3 are selected."),
        checks: [
          check("First row matches the original panel", "bool(np.array_equal(first_row, __initial['sensor_grid'][0]))", "Select row zero from the supplied grid."),
          check("Scan window matches the original panel", "bool(np.array_equal(scan_window, __initial['sensor_grid'][1:3, 1:4]))", "Remember that slice stop values are excluded."),
          check("Priority values use paired original coordinates", "bool(np.array_equal(priority, __initial['sensor_grid'][__initial['priority_rows'], __initial['priority_cols']]))", "Fancy index arrays are paired element by element."),
          check("Sensor input remains unchanged", "bool(np.array_equal(sensor_grid, __initial['sensor_grid']))", "Read from the supplied data without modifying it."),
        ],
      }),
      checkpoint({
        id: "sensor-view-snapshot",
        sectorId: "sensor-deck",
        title: "Live View, Safe Snapshot",
        objective: "Copy the panel, then edit exactly columns 1 and 2 through a view. Verify the parent changes and the snapshot does not.",
        skill: "Views, copies, memory sharing, and mutation",
        setup: py(
          "original_sensor = np.array([[1, 2, 3, 4, 5], [6, 7, 8, 9, 10], [11, 12, 13, 14, 15], [16, 17, 18, 19, 20]])",
          "sensor_grid = original_sensor.copy()",
          "delta = 100",
        ),
        alternate: py(
          "original_sensor = np.array([[30, 31, 32, 33], [40, 41, 42, 43], [50, 51, 52, 53]])",
          "sensor_grid = original_sensor.copy()",
          "delta = -7",
        ),
        starter: py("# Capture the whole panel, then edit columns 1 and 2 through a view.", "snapshot = None", "view_patch = None", "# TODO: increase the view by delta in place"),
        hints: [
          "A view is a window into the same notebook page; a copy is a photocopy that does not change with the original.",
          "If you copy a 2 by 3 table and then change the table's middle column, the photocopy should still show the earlier numbers.",
          "Copy sensor_grid before slicing, set view_patch = sensor_grid[:, 1:3], then use view_patch += delta.",
        ],
        prediction: prediction("After view_patch += delta, which array changes when view_patch is a basic slice?", ["sensor_grid and view_patch", "only view_patch", "only snapshot"], 0, "A basic slice is normally a view, so editing it changes the shared parent storage."),
        checks: [
          check("The view has the shape, strides, and starting address of columns 1:3", "view_patch.shape == sensor_grid[:, 1:3].shape and view_patch.strides == sensor_grid[:, 1:3].strides and view_patch.__array_interface__['data'][0] == sensor_grid[:, 1:3].__array_interface__['data'][0]", "Check the exact slice region, not merely that the view shares any memory with the grid."),
          check("The parent contains exactly the intended column edits", "bool(np.array_equal(sensor_grid, np.concatenate((__initial['original_sensor'][:, :1], __initial['original_sensor'][:, 1:3] + __initial['delta'], __initial['original_sensor'][:, 3:]), axis=1)))", "Check the full parent against the original fixture, including untouched cells."),
          check("Snapshot and source input preserve the original values", "bool(np.array_equal(snapshot, __initial['original_sensor'])) and not np.shares_memory(snapshot, sensor_grid) and bool(np.array_equal(original_sensor, __initial['original_sensor']))", "Take a copy before changing the view and leave source inputs intact."),
        ],
      }),
    ],
    nebula: checkpoint({
      id: "nebula-stride-safe-log",
      sectorId: "sensor-deck",
      title: "Stride-Safe Log",
      objective: "Edit every other sensor row and column through a strided view while archiving the original samples.",
      skill: "Strided slicing, views, copies, and snapshots",
      setup: py(
        "original_grid = np.array([[1, 2, 3, 4, 5], [6, 7, 8, 9, 10], [11, 12, 13, 14, 15], [16, 17, 18, 19, 20], [21, 22, 23, 24, 25]])",
        "sensor_grid = original_grid.copy()",
        "row_step, col_step, offset = 2, 2, 50",
        "expected_grid = original_grid.copy()",
        "expected_grid[::row_step, ::col_step] += offset",
      ),
      alternate: py(
        "original_grid = np.array([[9, 8, 7, 6], [5, 4, 3, 2], [1, 0, -1, -2]])",
        "sensor_grid = original_grid.copy()",
        "row_step, col_step, offset = 1, 2, -3",
        "expected_grid = original_grid.copy()",
        "expected_grid[::row_step, ::col_step] += offset",
      ),
      starter: py("# Archive the sampled pixels before editing their strided view.", "archive = None", "pixel_view = None", "# TODO: add offset through pixel_view"),
      hints: [
        "A stride is like reading every second seat in a row instead of every seat.",
        "For example, board[::2, ::2] selects alternating rows and alternating columns from a checkerboard.",
        "Make archive with .copy(), select pixel_view with both supplied steps, then add offset in place.",
      ],
      prediction: prediction("Will pixel_view = sensor_grid[::2, ::2] share memory with sensor_grid?", ["Yes, it is a slice view", "No, every-other selection always copies", "Only if the grid is square"], 0, "Basic slicing with steps still creates a view, even when the selected cells are spaced apart."),
      checks: [
        check("Pixel view has the shape, strides, and starting address of the requested grid slice", "pixel_view.shape == sensor_grid[::row_step, ::col_step].shape and pixel_view.strides == sensor_grid[::row_step, ::col_step].strides and pixel_view.__array_interface__['data'][0] == sensor_grid[::row_step, ::col_step].__array_interface__['data'][0]", "Confirm the exact strided slice, not just any shared region."),
        check("Parent grid matches the original fixture with only selected pixels changed", "bool(np.array_equal(sensor_grid, __initial['expected_grid']))", "Compare the full grid against its trusted before-edit snapshot."),
        check("Archive preserves original sampled pixels and source data", "bool(np.array_equal(archive, __initial['original_grid'][::__initial['row_step'], ::__initial['col_step']])) and not np.shares_memory(archive, sensor_grid) and bool(np.array_equal(original_grid, __initial['original_grid']))", "Copy the samples before editing and leave fixture inputs intact."),
      ],
    }),
  },
{
    id: "reactor-garden",
    title: "Reactor Garden",
    transmission: "Transform the signed heat readings safely, then tune every lane with a broadcast bias.",
    campaign: [
      checkpoint({
        id: "reactor-safe-roots",
        sectorId: "reactor-garden",
        title: "Safe Roots",
        objective: "Apply absolute value before square root so every signed reactor reading can be transformed.",
        skill: "Vectorized ufuncs with abs and sqrt",
        setup: py("heat = np.array([[1.0, -4.0, 9.0], [-16.0, 25.0, -36.0]])"),
        alternate: py("heat = np.array([[-2.25, 0.0], [6.25, -12.25], [20.25, -30.25]])"),
        starter: py("# Transform whole arrays; do not loop over cells.", "magnitude = None", "root_heat = None"),
        hints: [
          "A ufunc applies the same operation to every reading, like a stencil that covers the whole garden at once.",
          "For a separate reading set [[-9, 16]], absolute values give [[9, 16]], whose square roots are [[3, 4]].",
          "Use np.abs(heat) first, then np.sqrt(magnitude).",
        ],
        prediction: prediction("What shape will np.sqrt(np.abs(heat)) have if heat has shape (3, 2)?", ["(2, 3)", "(3, 2)", "(6,)"], 1, "Elementwise ufuncs preserve the input shape."),
        checks: [
          check("Magnitude is the absolute value of heat", "bool(np.array_equal(magnitude, np.abs(__initial['heat'])))", "Use np.abs elementwise."),
          check("Root heat is the square root of magnitude", "bool(np.allclose(root_heat, np.sqrt(np.abs(__initial['heat']))))", "Take roots after removing negative signs."),
          check("Both transformed arrays preserve the input shape", "magnitude.shape == __initial['heat'].shape and root_heat.shape == __initial['heat'].shape", "Elementwise operations keep every axis."),
        ],
      }),
      checkpoint({
        id: "reactor-broadcast-wave",
        sectorId: "reactor-garden",
        title: "Broadcast Bloom",
        objective: "Broadcast a lane bias across the reactor rows and derive wave, efficiency, log, and danger arrays.",
        skill: "Broadcasting, ufunc chains, and comparisons",
        setup: py(
          "heat = np.array([[1.0, -4.0, 9.0], [16.0, -25.0, 36.0]])",
          "bias = np.array([0.5, 1.0, 1.5])",
          "danger_limit = 4.0",
        ),
        alternate: py(
          "heat = np.array([[-1.0, 4.0, -9.0, 16.0], [25.0, -36.0, 49.0, -64.0], [81.0, 100.0, -121.0, 144.0]])",
          "bias = np.array([0.25, 0.5, 0.75, 1.0])",
          "danger_limit = 8.0",
        ),
        starter: py(
          "# Continue from the supplied heat and bias arrays.",
          "magnitude = None",
          "root_heat = None",
          "wave = None",
          "boosted = None",
          "efficiency = None",
          "log_signal = None",
          "danger = None",
        ),
        hints: [
          "A lane bias is like a row of seasoning amounts that gets added to every tray in the kitchen.",
          "If two rows each have three readings, adding [1, 2, 3] changes matching columns in both rows.",
          "Take abs, then sqrt; apply sin to the roots, add bias, then build exp, log1p, and comparison outputs from boosted.",
        ],
        prediction: prediction("Adding a bias with shape (4,) to root_heat with shape (3, 4) gives what shape?", ["(3, 4)", "(4, 3)", "(3, 1)"], 0, "The vector matches the last axis and is reused across all three rows."),
        checks: [
          check("Wave applies sine to the root readings", "bool(np.allclose(wave, np.sin(np.sqrt(np.abs(__initial['heat'])))))", "Use the sine ufunc on root_heat."),
          check("Bias is broadcast across every reactor row", "bool(np.allclose(boosted, np.sqrt(np.abs(__initial['heat'])) + __initial['bias']))", "The 1D bias matches the last axis."),
          check("Efficiency and log signal use the requested transforms", "bool(np.allclose(efficiency, np.exp(-boosted / 10))) and bool(np.allclose(log_signal, np.log1p(boosted)))", "Build both arrays from boosted."),
          check("Danger mask marks values above danger_limit", "bool(np.array_equal(danger, boosted > __initial['danger_limit']))", "Compare the adjusted values."),
        ],
      }),
    ],
    nebula: checkpoint({
      id: "nebula-column-normalizer",
      sectorId: "reactor-garden",
      title: "Column Normalizer",
      objective: "Center each sensor lane by its column mean and measure the remaining energy.",
      skill: "Axis reductions, keepdims, and broadcasting",
      setup: py("signal = np.array([[2.0, 5.0, 9.0], [4.0, 7.0, 3.0], [6.0, 8.0, 6.0]])"),
      alternate: py("signal = np.array([[10.0, -2.0], [4.0, 6.0], [1.0, 8.0], [5.0, 0.0]])"),
      starter: py("# Find one mean per column, center readings, then sum squared deviation by lane.", "column_mean = None", "centered = None", "column_energy = None"),
      hints: [
        "A column mean is one summary value for each lane, so the reduced result should keep a row axis for broadcasting.",
        "For a 3 by 2 table, mean(axis=0, keepdims=True) returns a 1 by 2 row that can be subtracted from all three rows.",
        "Use signal.mean(axis=0, keepdims=True), subtract it, then sum centered ** 2 along axis 0.",
      ],
      prediction: prediction("For signal.shape == (4, 2), what shape does mean(axis=0, keepdims=True) return?", ["(1, 2)", "(4, 1)", "(2,)"], 0, "keepdims leaves the reduced row axis with length one."),
      checks: [
        check("Column mean keeps a single row axis", "column_mean.shape == (1, __initial['signal'].shape[1]) and bool(np.allclose(column_mean, __initial['signal'].mean(axis=0, keepdims=True)))", "Reduce rows with axis=0 and keep the dimension."),
        check("Centered data has zero mean in each column", "centered.shape == __initial['signal'].shape and bool(np.allclose(centered.mean(axis=0), 0))", "Subtract the broadcast column means."),
        check("Column energy sums squared deviations down each lane", "bool(np.allclose(column_energy, np.sum(centered ** 2, axis=0)))", "The lane totals reduce the row axis."),
      ],
    }),
  },
{
    id: "quarantine-lab",
    title: "Quarantine Lab",
    transmission: "Locate missing cells, replace them safely, and send only readings that pass the biofilter.",
    campaign: [
      checkpoint({
        id: "quarantine-nan-cleanup",
        sectorId: "quarantine-lab",
        title: "Patch the Missing Readings",
        objective: "Find NaN cells and replace them with the supplied safe fill value.",
        skill: "NaN detection, boolean masks, and np.where",
        setup: py(
          "samples = np.array([[1.2, np.nan, 3.5], [0.4, -1.2, np.nan], [2.1, 0.0, 4.4]])",
          "fill_value = 0.0",
        ),
        alternate: py(
          "samples = np.array([[np.nan, 7.0, 2.5, np.nan], [3.0, 4.5, np.nan, -1.0]])",
          "fill_value = -2.0",
        ),
        starter: py("# Mark present readings and create a NaN-free grid.", "finite_mask = None", "clean = None"),
        hints: [
          "NaN means a reading is missing; test for it with np.isnan instead of comparing it to itself.",
          "In a different sensor table, np.where(np.isnan(values), -1, values) replaces gaps with -1 and preserves the rest.",
          "Set finite_mask to ~np.isnan(samples), then use np.where with the missing-cell condition and fill_value.",
        ],
        prediction: prediction("What shape does np.isnan(samples) have?", ["The same shape as samples", "(samples.size,)", "(samples.shape[1],)"], 0, "The test runs element by element and preserves the grid shape."),
        checks: [
          check("Finite mask marks exactly the non-NaN cells", "bool(np.array_equal(finite_mask, ~np.isnan(__initial['samples'])))", "Invert the NaN mask to mark present readings."),
          check("Clean grid replaces only NaN cells", "bool(np.array_equal(clean, np.where(np.isnan(__initial['samples']), __initial['fill_value'], __initial['samples'])))", "Keep original values in the false branch."),
          check("Clean grid has no NaN values", "bool(np.all(~np.isnan(clean)))", "Check the full cleaned array."),
        ],
      }),
      checkpoint({
        id: "quarantine-safe-filter",
        sectorId: "quarantine-lab",
        title: "Filter the Bio Samples",
        objective: "Keep readings above a threshold and summarize whether any breach or out-of-range value remains.",
        skill: "Boolean filtering, where, any, and all",
        setup: py(
          "samples = np.array([[1.2, np.nan, 3.5], [0.4, -1.2, np.nan], [2.1, 0.0, 4.4]])",
          "fill_value, threshold, stability_cap = 0.0, 0.5, 5.0",
        ),
        alternate: py(
          "samples = np.array([[np.nan, 2.5, -0.5, 8.0], [1.0, 4.0, np.nan, 3.0]])",
          "fill_value, threshold, stability_cap = 0.0, 2.0, 6.0",
        ),
        starter: py(
          "# Clean first, then reuse the safe mask for filtering and quarantine.",
          "clean = None",
          "safe_mask = None",
          "filtered = None",
          "has_breach = None",
          "all_stable = None",
          "quarantine = None",
        ),
        hints: [
          "A boolean mask works like a sieve: it keeps only the cells whose condition is true.",
          "For readings [1, 3, 5] and threshold 3, values[values >= 3] keeps [3, 5].",
          "Clean NaNs with np.where, make safe_mask from clean >= threshold, then use np.any, np.all, and another np.where.",
        ],
        prediction: prediction("When safe_mask is 2D, what shape is clean[safe_mask]?", ["A 1D array of selected values", "The original 2D shape", "A boolean array"], 0, "Boolean filtering gathers matching cells into a flat one-dimensional result."),
        checks: [
          check("Clean values replace missing cells", "bool(np.array_equal(clean, np.where(np.isnan(__initial['samples']), __initial['fill_value'], __initial['samples'])))", "Use the supplied fill value."),
          check("Safe mask and filtered readings agree", "bool(np.array_equal(safe_mask, clean >= __initial['threshold'])) and bool(np.array_equal(filtered, clean[safe_mask]))", "Index clean with the boolean mask."),
          check("Breach and stability summaries match the cleaned data", "bool(has_breach) == bool(np.any(clean < 0)) and bool(all_stable) == bool(np.all(clean <= __initial['stability_cap']))", "Use NumPy any and all on array comparisons."),
          check("Quarantine keeps safe cells and zeroes the rest", "bool(np.array_equal(quarantine, np.where(safe_mask, clean, 0)))", "Reuse the same safe mask."),
        ],
      }),
    ],
    nebula: checkpoint({
      id: "nebula-robust-lane-score",
      sectorId: "quarantine-lab",
      title: "Robust Lane Score",
      objective: "Replace missing readings with their lane median, then calculate each lane's range.",
      skill: "NaN-aware aggregation and axis semantics",
      setup: py("samples = np.array([[1.0, np.nan, 7.0], [3.0, 5.0, np.nan], [9.0, 7.0, 11.0]])"),
      alternate: py("samples = np.array([[np.nan, 2.0], [4.0, 8.0], [10.0, np.nan], [6.0, 4.0]])"),
      starter: py("# Find one median per lane, fill gaps from it, and measure each lane range.", "lane_median = None", "filled = None", "lane_range = None"),
      hints: [
        "A median is the middle value after ordering a lane's readings, so one outlier has less pull than it does on the mean.",
        "For columns [1, 3, 9] and [2, 5, 7], np.nanmedian(table, axis=0) gives one typical value per column.",
        "Use np.nanmedian(samples, axis=0), broadcast it through np.where, then subtract the per-column minimum from the maximum.",
      ],
      prediction: prediction("If samples has shape (4, 2), what shape does np.nanmedian(samples, axis=0) have?", ["(2,)", "(4,)", "(1, 2)"], 0, "Reducing axis 0 leaves one result for each of the two columns."),
      checks: [
        check("Lane medians reduce down rows", "lane_median.shape == (__initial['samples'].shape[1],) and bool(np.allclose(lane_median, np.nanmedian(__initial['samples'], axis=0)))", "Use the NaN-aware median on axis zero."),
        check("Missing cells are filled from their lane median", "bool(np.allclose(filled, np.where(np.isnan(__initial['samples']), lane_median, __initial['samples'])))", "The median vector broadcasts across rows."),
        check("Lane range is maximum minus minimum down each column", "bool(np.allclose(lane_range, filled.max(axis=0) - filled.min(axis=0)))", "Reduce the row axis for both extrema."),
      ],
    }),
  },
{
    id: "cargo-forge",
    title: "Cargo Forge",
    transmission: "Repack the hold without losing values, then clone the safety pattern across the deck.",
    campaign: [
      checkpoint({
        id: "cargo-reshape-layers",
        sectorId: "cargo-forge",
        title: "Reshape the Crates",
        objective: "Reorganize the cargo into a new grid, flatten it as a view and a copy, and rotate its axes.",
        skill: "reshape, ravel, flatten, transpose, and memory",
        setup: py("crates = np.arange(1, 13).reshape(3, 4)", "target_shape = (2, 6)"),
        alternate: py("crates = np.arange(10, 22).reshape(2, 6)", "target_shape = (4, 3)"),
        starter: py("# Keep the same values while changing their arrangement.", "reshaped = None", "flat_view = None", "flat_copy = None", "transposed = None"),
        hints: [
          "Reshape changes the packing plan while keeping the order of the cargo.",
          "The same six tokens arranged as 2 by 3 or 3 by 2 still appear in the same row-major sequence when flattened.",
          "Use reshape(target_shape), ravel(), flatten(), and .T; ravel commonly shares memory while flatten makes a copy.",
        ],
        prediction: prediction("If crates is contiguous, which flattening method usually shares memory with it?", ["ravel()", "flatten()", "Both always copy"], 0, "ravel can return a view when the layout allows it; flatten always returns a copy."),
        checks: [
          check("Reshaped cargo has the requested shape and order", "reshaped.shape == __initial['target_shape'] and bool(np.array_equal(reshaped.ravel(), __initial['crates'].ravel()))", "Reshape preserves the element order."),
          check("Ravel and flatten contain the same cargo sequence", "bool(np.array_equal(flat_view, __initial['crates'].ravel())) and bool(np.array_equal(flat_copy, __initial['crates'].ravel()))", "Flatten both outputs in row-major order."),
          check("Ravel shares storage while flatten is independent", "bool(np.shares_memory(flat_view, crates)) and not np.shares_memory(flat_copy, crates)", "Compare memory sharing explicitly."),
          check("Transpose swaps the two cargo axes", "bool(np.array_equal(transposed, __initial['crates'].T))", "Transpose a 2D array with .T."),
        ],
      }),
      checkpoint({
        id: "cargo-join-split",
        sectorId: "cargo-forge",
        title: "Join and Split Modules",
        objective: "Join modules by columns, stack them on a new axis, and split a manifest into equal sections.",
        skill: "concatenate, stack, split, and axis choice",
        setup: py("left = np.array([[1, 2], [3, 4]])", "right = np.array([[5, 6], [7, 8]])", "manifest = np.arange(12)"),
        alternate: py("left = np.array([[10, 11], [12, 13], [14, 15]])", "right = np.array([[20, 21], [22, 23], [24, 25]])", "manifest = np.arange(15, 30)"),
        starter: py("# Combine the modules and divide the manifest into three sections.", "merged = None", "stacked = None", "sections = None"),
        hints: [
          "Concatenate extends an existing direction; stack creates an additional direction.",
          "Two 2 by 2 panels joined across columns make a 2 by 4 panel, while stacking them makes two 2 by 2 layers.",
          "Use np.concatenate((left, right), axis=1), np.stack((left, right)), and np.split(manifest, 3).",
        ],
        prediction: prediction("What shape does np.stack((left, right)) have when both inputs are (3, 2)?", ["(3, 4)", "(2, 3, 2)", "(3, 2)"], 1, "Stack adds a new leading axis for the two input modules."),
        checks: [
          check("Merged modules sit side by side", "bool(np.array_equal(merged, np.concatenate((__initial['left'], __initial['right']), axis=1)))", "Join along the column axis."),
          check("Stacked modules use a new axis", "bool(np.array_equal(stacked, np.stack((__initial['left'], __initial['right'])))) and stacked.shape == (2,) + __initial['left'].shape", "Stack adds an axis."),
          check("Three split sections recombine to the manifest", "len(sections) == 3 and bool(np.array_equal(np.concatenate(sections), __initial['manifest']))", "Split into three equal pieces and preserve order."),
        ],
      }),
      checkpoint({
        id: "cargo-repeat-pattern",
        sectorId: "cargo-forge",
        title: "Repeat the Safety Pattern",
        objective: "Repeat each cargo code and tile a small safety pattern across the full deck.",
        skill: "repeat and tile",
        setup: py("codes = np.array([2, 5, 8])", "repeat_count = 2", "checker = np.array([[1, 0], [0, 1]])", "tile_shape = (2, 3)"),
        alternate: py("codes = np.array([4, 7, 9, 12])", "repeat_count = 3", "checker = np.array([[0, 1, 0], [1, 0, 1]])", "tile_shape = (3, 2)"),
        starter: py("# Repeat individual codes and repeat the checker in both dimensions.", "repeated = None", "tiled = None"),
        hints: [
          "repeat duplicates each value next to itself; tile repeats a whole pattern like copying a stencil.",
          "For example, np.repeat([3, 6], 2) gives [3, 3, 6, 6], while np.tile([[1, 0]], (2, 1)) makes two rows.",
          "Pass repeat_count to np.repeat and tile_shape to np.tile.",
        ],
        prediction: prediction("If codes has four values and repeat_count is 3, how many values are in repeated?", ["7", "12", "4"], 1, "Each of the four inputs appears three times, giving twelve outputs."),
        checks: [
          check("Each code repeats the requested number of times", "bool(np.array_equal(repeated, np.repeat(__initial['codes'], __initial['repeat_count'])))", "np.repeat repeats individual elements."),
          check("Safety pattern tiles to the requested layout", "bool(np.array_equal(tiled, np.tile(__initial['checker'], __initial['tile_shape'])))", "np.tile repeats the whole 2D pattern."),
          check("Tiled output shape multiplies both pattern axes", "tiled.shape == (__initial['checker'].shape[0] * __initial['tile_shape'][0], __initial['checker'].shape[1] * __initial['tile_shape'][1])", "Each tile count scales its matching axis."),
        ],
      }),
    ],
    nebula: checkpoint({
      id: "nebula-axis-stacking",
      sectorId: "cargo-forge",
      title: "Axis Stacking",
      objective: "Stack matching module grids between their row and column axes to create a layered cargo tensor.",
      skill: "Stack axis placement and 3D shape",
      setup: py("module_a = np.array([[1, 2, 3], [4, 5, 6]])", "module_b = np.array([[11, 12, 13], [14, 15, 16]])"),
      alternate: py("module_a = np.array([[2, 4], [6, 8], [10, 12]])", "module_b = np.array([[3, 5], [7, 9], [11, 13]])"),
      starter: py("# Stack the two modules between row and column axes, then join their rows.", "layers = None", "joined_rows = None"),
      hints: [
        "The axis argument chooses where the new module dimension sits in the finished tensor.",
        "Imagine two photo albums, each with 3 pages and 4 pictures per page: stacking at axis 1 gives (3, 2, 4).",
        "Use np.stack((module_a, module_b), axis=1) and concatenate along axis 0 for joined_rows.",
      ],
      prediction: prediction("For two modules shaped (3, 2), what shape does stacking with axis=1 produce?", ["(3, 2, 2)", "(2, 3, 2)", "(3, 2)"], 0, "The size-two module axis is inserted between the three rows and two columns."),
      checks: [
        check("Layer tensor places the new axis between rows and columns", "bool(np.array_equal(layers, np.stack((__initial['module_a'], __initial['module_b']), axis=1))) and layers.shape == (__initial['module_a'].shape[0], 2, __initial['module_a'].shape[1])", "Choose axis 1 for the inserted module axis."),
        check("Joined rows preserve module order", "bool(np.array_equal(joined_rows, np.concatenate((__initial['module_a'], __initial['module_b']), axis=0)))", "Concatenate along the row axis."),
      ],
    }),
  },
{
    id: "drone-bridge",
    title: "Drone Bridge",
    transmission: "Seed the route planner, measure traffic along the right axes, and calculate a safe route.",
    campaign: [
      checkpoint({
        id: "drone-seeded-traffic",
        sectorId: "drone-bridge",
        title: "Seeded Traffic",
        objective: "Generate repeatable traffic and calculate row totals and column averages.",
        skill: "Random Generator and axis reductions",
        setup: py("seed, low, high, traffic_shape = 7, 2, 20, (3, 4)"),
        alternate: py("seed, low, high, traffic_shape = 21, -3, 17, (4, 3)"),
        starter: py("# Build a seeded generator, traffic grid, row totals, and column means.", "rng = None", "traffic = None", "totals = None", "means = None"),
        hints: [
          "A seeded Generator is like a route replay button: the same seed repeats the same traffic.",
          "For a 3 by 4 grid, sum(axis=1) gives three row totals and mean(axis=0) gives four column means.",
          "Use np.random.default_rng(seed), rng.integers(low, high, size=traffic_shape), then reduce along the requested axes.",
        ],
        prediction: prediction("For traffic with shape (4, 3), what shapes do totals=traffic.sum(axis=1) and means=traffic.mean(axis=0) have?", ["(4,) and (3,)", "(3,) and (4,)", "(4, 3) and (4, 3)"], 0, "Reducing axis 1 leaves one result per row; reducing axis 0 leaves one per column."),
        checks: [
          check("rng is a NumPy Generator", "isinstance(rng, np.random.Generator)", "Create the modern Generator with default_rng."),
          check("Traffic is repeatable for the supplied settings", "bool(np.array_equal(traffic, np.random.default_rng(__initial['seed']).integers(__initial['low'], __initial['high'], size=__initial['traffic_shape'])))", "Use the provided seed, range, and shape."),
          check("Totals reduce across columns within each row", "bool(np.array_equal(totals, traffic.sum(axis=1)))", "Use axis=1 for one total per row."),
          check("Means reduce down rows for each column", "bool(np.allclose(means, traffic.mean(axis=0)))", "Use axis=0 for one mean per column."),
        ],
      }),
      checkpoint({
        id: "drone-sort-codes",
        sectorId: "drone-bridge",
        title: "Sort Flight Codes",
        objective: "Find extreme reading positions, sort each row, order the first row, and deduplicate flight codes.",
        skill: "argmin, argmax, sort, argsort, and unique",
        setup: py("readings = np.array([[8, 2, 9, 2], [5, 7, 1, 6]])", "codes = np.array([5, 2, 5, 9, 2, 11])"),
        alternate: py("readings = np.array([[14, 12, 18], [10, 19, 11], [13, 15, 16]])", "codes = np.array([4, 4, 3, 8, 3, 12, 8])"),
        starter: py("# Make position, sorted-row, first-row order, and unique-code reports.", "minimum_index = None", "maximum_index = None", "sorted_rows = None", "first_row_order = None", "unique_codes = None"),
        hints: [
          "argmin and argmax report positions, while min and max report values.",
          "For row [9, 2, 5], argsort returns positions [1, 2, 0], which would put that row in order.",
          "Use argmin and argmax on readings, sort with axis=1, argsort on readings[0], and unique on codes.",
        ],
        prediction: prediction("What does np.argsort([9, 2, 5]) return?", ["[2, 5, 9]", "[1, 2, 0]", "[0, 1, 2]"], 1, "argsort returns indexes in sorted-value order, not the sorted values themselves."),
        checks: [
          check("Extreme indexes point to the first global minimum and maximum", "minimum_index == int(np.argmin(__initial['readings'])) and maximum_index == int(np.argmax(__initial['readings']))", "Use the flattened default ordering for the global positions."),
          check("Rows are sorted independently", "bool(np.array_equal(sorted_rows, np.sort(__initial['readings'], axis=1)))", "Sort along axis 1."),
          check("First-row order contains the correct positions", "bool(np.array_equal(first_row_order, np.argsort(__initial['readings'][0])))", "argsort the first row only."),
          check("Flight codes are sorted and unique", "bool(np.array_equal(unique_codes, np.unique(__initial['codes'])))", "np.unique returns sorted distinct values."),
        ],
      }),
      checkpoint({
        id: "drone-route-math",
        sectorId: "drone-bridge",
        title: "Route Matrix",
        objective: "Calculate a navigation matrix product and a separate vector dot product.",
        skill: "Matrix multiplication and dot products",
        setup: py("route_a = np.array([[2, 1, 0], [1, 3, 2]])", "route_b = np.array([[1, 2], [0, 1], [4, 2]])", "energy_a = np.array([1, 2, 3])", "energy_b = np.array([4, 5, 6])"),
        alternate: py("route_a = np.array([[1, 2], [3, 4], [5, 6]])", "route_b = np.array([[2, 0, 1], [1, 3, 2]])", "energy_a = np.array([2, -1])", "energy_b = np.array([5, 3])"),
        starter: py("# Use matrix multiplication for navigation and np.dot for the energy pair.", "navigation = None", "energy_dot = None"),
        hints: [
          "Matrix multiplication combines rows of the first map with columns of the second.",
          "A 2 by 3 map multiplied by a 3 by 2 map produces a 2 by 2 route table.",
          "Use route_a @ route_b for navigation and np.dot(energy_a, energy_b) for the scalar energy score.",
        ],
        prediction: prediction("What shape results from multiplying route_a (3, 2) by route_b (2, 3)?", ["(3, 3)", "(2, 2)", "(3, 2)"], 0, "The inner dimensions match and the outer dimensions determine the result shape."),
        checks: [
          check("Navigation equals the matrix product", "bool(np.array_equal(navigation, __initial['route_a'] @ __initial['route_b']))", "Use @ or np.matmul."),
          check("Energy score equals the vector dot product", "bool(np.array_equal(energy_dot, np.dot(__initial['energy_a'], __initial['energy_b'])))", "Use np.dot for the two vectors."),
          check("Navigation shape uses the outer dimensions", "navigation.shape == (__initial['route_a'].shape[0], __initial['route_b'].shape[1])", "The product keeps rows from the left and columns from the right."),
        ],
      }),
    ],
    nebula: checkpoint({
      id: "nebula-zero-safe-shares",
      sectorId: "drone-bridge",
      title: "Zero-Safe Traffic Shares",
      objective: "Convert each row into proportions without dividing by zero in an empty traffic lane.",
      skill: "keepdims and guarded vectorized division",
      setup: py("counts = np.array([[2.0, 3.0, 5.0], [0.0, 0.0, 0.0], [4.0, 1.0, 5.0]])"),
      alternate: py("counts = np.array([[8.0, 2.0], [0.0, 0.0], [1.0, 3.0], [5.0, 5.0]])"),
      starter: py("# Keep row totals two-dimensional, then divide only where a row has traffic.", "row_totals = None", "shares = None"),
      hints: [
        "Normalize each row by its own total, but let an empty row stay all zeros.",
        "Keep a 1D list of row totals expanded as a column so it can divide a 2D traffic grid row by row.",
        "Use counts.sum(axis=1, keepdims=True) and np.divide with where=row_totals != 0 plus a zero-filled output.",
      ],
      prediction: prediction("If counts has shape (4, 2), what shape does sum(axis=1, keepdims=True) have?", ["(4, 1)", "(1, 2)", "(4,)"], 0, "The reduced column axis remains as length one for row-wise broadcasting."),
      checks: [
        check("Row totals keep a column dimension", "row_totals.shape == (__initial['counts'].shape[0], 1) and bool(np.array_equal(row_totals, __initial['counts'].sum(axis=1, keepdims=True)))", "Keep the reduced axis."),
        check("Nonempty rows become proportions summing to one", "bool(np.allclose(shares[row_totals[:, 0] != 0].sum(axis=1), 1))", "Normalize each nonzero row by its total."),
        check("Empty rows stay zero and all shares are finite", "bool(np.all(shares[row_totals[:, 0] == 0] == 0)) and bool(np.all(np.isfinite(shares)))", "Guard division where the total is zero."),
      ],
    }),
  },
{
    id: "colony-core",
    title: "Colony Core",
    transmission: "Chain the ship's core array operations into one rescue sequence, then refine the power signal.",
    campaign: [
      checkpoint({
        id: "colony-rescue-sequence",
        sectorId: "colony-core",
        title: "Final Rescue Sequence",
        objective: "Create a grid, keep even cells, broadcast repairs, reduce by row, reshape, and multiply by weights.",
        skill: "Capstone: creation, masks, broadcasting, reductions, and matrix math",
        setup: py(
          "first_value, grid_shape = 1, (4, 4)",
          "repair_bias = np.array([0, 5, 10, 15])",
          "weights = np.array([[1.0, 0.5], [0.0, 1.0], [1.5, -0.5], [0.5, 1.5], [1.0, 1.0], [0.2, 1.3], [1.1, 0.4], [0.3, 1.2]])",
        ),
        alternate: py(
          "first_value, grid_shape = 5, (6, 4)",
          "repair_bias = np.array([2, 0, 4, 1])",
          "weights = np.array([[1.0, 0.0, 0.5], [0.5, 1.0, 0.0], [0.0, 0.5, 1.0], [1.0, 1.0, 0.0], [0.2, 0.8, 0.4], [0.4, 0.2, 0.8], [0.8, 0.4, 0.2], [1.0, 0.0, 1.0]])",
        ),
        starter: py(
          "# Build each stage from the previous NumPy result.",
          "grid = None",
          "safe = None",
          "boosted = None",
          "row_power = None",
          "matrix = None",
          "course = None",
          "rescue_score = None",
        ),
        hints: [
          "Treat the rescue as a pipeline: each named output should come from the array just before it.",
          "For a separate 2 by 2 energy grid, first use a boolean condition to zero unwanted cells, then add one value per column.",
          "Create the integer range and reshape it, use np.where for even cells, add repair_bias, sum axis 1, reshape to half as many rows, multiply by weights, and average.",
        ],
        prediction: prediction("If boosted is (6, 4), what shape will boosted.reshape(3, -1) have?", ["(3, 8)", "(6, 4)", "(2, 12)"], 0, "Reshape groups the same 24 values into three rows, so each row has eight columns."),
        checks: [
          check("Grid matches the trusted start and requested shape", "grid.shape == __initial['grid_shape'] and bool(np.array_equal(grid, np.arange(__initial['first_value'], __initial['first_value'] + np.prod(__initial['grid_shape'])).reshape(__initial['grid_shape'])))", "Use the supplied start and shape with arange before reshape."),
          check("Only even values remain before the repair bias", "bool(np.array_equal(safe, np.where(grid % 2 == 0, grid, 0)))", "Use the even-number mask with np.where."),
          check("Bias is broadcast and row totals reduce axis 1", "bool(np.array_equal(boosted, safe + __initial['repair_bias'])) and bool(np.array_equal(row_power, boosted.sum(axis=1)))", "The repair vector matches columns; axis 1 sums each row."),
          check("Course matrix and score follow the final operations", "bool(np.allclose(matrix, boosted.reshape((__initial['grid_shape'][0] // 2, -1)))) and bool(np.allclose(course, matrix @ __initial['weights'])) and bool(np.isclose(rescue_score, course.mean()))", "Reshape before matrix multiplication with the supplied weights, then average the result."),
        ],
      }),
    ],
    nebula: checkpoint({
      id: "nebula-energy-drift",
      sectorId: "colony-core",
      title: "Energy Drift Report",
      objective: "Measure changes between neighboring columns, accumulate power by row, and clamp the running total.",
      skill: "diff, cumulative sums, axis, and clipping",
      setup: py(
        "energy = np.array([[2.0, 5.0, 4.0, 8.0], [1.0, 3.0, 7.0, 6.0], [4.0, 4.0, 9.0, 10.0]])",
        "lower, upper = 0.0, 20.0",
      ),
      alternate: py(
        "energy = np.array([[10.0, 8.0, 11.0], [5.0, 9.0, 4.0], [2.0, 12.0, 6.0], [7.0, 7.0, 13.0]])",
        "lower, upper = 5.0, 30.0",
      ),
      starter: py("# Compare neighboring columns and clamp accumulated row power.", "step_change = None", "accumulated = None", "clipped = None"),
      hints: [
        "np.diff reports the change between neighboring readings, while cumsum keeps a running total.",
        "For a separate energy row [3, 5, 2], diff gives [2, -3]; cumsum on rows builds a running total down each column.",
        "Use np.diff(energy, axis=1), np.cumsum(energy, axis=0), then np.clip with lower and upper.",
      ],
      prediction: prediction("If energy has shape (4, 3), what shape does np.diff(energy, axis=1) have?", ["(4, 2)", "(3, 3)", "(4, 3)"], 0, "Differences between adjacent values reduce the selected axis length by one."),
      checks: [
        check("Step changes compare neighboring columns", "bool(np.array_equal(step_change, np.diff(__initial['energy'], axis=1)))", "Take differences along axis 1."),
        check("Accumulated power builds down rows", "bool(np.array_equal(accumulated, np.cumsum(__initial['energy'], axis=0)))", "Use cumulative sum on axis 0."),
        check("Clipped power stays inside the supplied limits", "bool(np.array_equal(clipped, np.clip(accumulated, __initial['lower'], __initial['upper']))) and bool(np.all(clipped >= __initial['lower'])) and bool(np.all(clipped <= __initial['upper']))", "Clip the cumulative result."),
      ],
    }),
  }
];


export const labDatasets: { id: string; title: string; starter: string }[] = [
  { id: "blank", title: "Blank Lab", starter: "" },
  {
    id: "comet-signals",
    title: "Comet Signals",
    starter: py(
      "signals = np.array([[2.5, 3.0, 5.5], [1.0, 4.0, 6.5]])",
      "# Try an array transform, reduction, or mask below.",
      "",
    ),
  },
  {
    id: "crate-inventory",
    title: "Crate Inventory",
    starter: py(
      "inventory = np.array([[12, 8, 5], [7, 10, 3], [9, 4, 11]])",
      "# Explore totals, slices, reshapes, or sorted values.",
      "",
    ),
  },
{
    id: "bio-samples",
    title: "Bio Samples",
    starter: py(
      "samples = np.array([[1.2, np.nan, 3.5], [0.4, -1.2, 2.0]])",
      "# Try cleaning the missing reading or filtering the safe values.",
      "",
    ),
  },
];
