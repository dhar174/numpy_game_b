# NumPy Nebula live visual playtest — November 20, 2026

## Scope and result

I played the public deployment at https://dhar174.github.io/numpy_game_b/ in the external Google Chrome browser on Windows, using its normal desktop viewport. I completed all 15 campaign checkpoints across seven sectors, launched the ship, and completed all seven unlocked Nebula challenges. I also sampled Free Lab, hints, prediction feedback, the ship log, syntax errors, keyboard execution, settings visibility, and reload persistence. This was an interactive visual playtest, not a complete accessibility, device, performance, or security audit.

**Overall:** The live game is playable from start to finish and has a cohesive interface and useful array inspection. One campaign checkpoint contains an underspecified required formula that could block a learner. Two advanced challenges would benefit from more explicit axis and shape instructions. Fullscreen did not open in this controlled browser session, though the application handled the failure with an explanatory message.

The playthrough used ordinary editor interaction and the in-game grader. For the Reactor Garden formula, after two plausible solutions failed and all hints had been exhausted, I inspected the local project grading source to continue. The live site then accepted the formula found there. Therefore, the entire game was completed, but this one checkpoint was not solved solely from the game's instructions.

## Findings, ordered by impact

### 1. Broadcast Bloom omits the required efficiency formula — high impact to progression

**Where:** Campaign → Reactor Garden → checkpoint 2, “Broadcast Bloom.”

**Steps:** Set `magnitude = np.abs(heat)`, `root_heat = np.sqrt(magnitude)`, `wave = np.sin(root_heat)`, `boosted = root_heat + bias`, `log_signal = np.log1p(boosted)`, and `danger = boosted > danger_limit`. Try `efficiency = np.exp(-boosted)` or `np.exp(boosted)`, then run.

**Observed:** The grader reported 3 of 4 checks passed and said “Efficiency and log signal use the requested transforms” and “Build both arrays from boosted.” The objective asks the player to derive efficiency and log arrays; the final hint mentions `exp` and `log1p` but supplies no scale or precise exponent. Neither the brief, provided inputs, nor exhausted hints identified the required division by 10. Inspecting the local curriculum grader revealed `np.exp(-boosted / 10)`; entering that expression passed on the live site.

**Impact:** A player can understand NumPy and follow the visible hint yet be unable to infer the expected calculation. Because this checkpoint gates later campaign sectors, this is a progression blocker for players without access to the implementation or outside help.

**Recommendation:** State the exact model, including the negative sign and divisor, in the mission brief or an increasingly explicit hint; make the failed check identify which transform is wrong. If the constant is intended as a supplied parameter, provide and name it.

### 2. Energy Drift Report uses ambiguous axis language — medium/low impact

**Where:** Nebula → Colony Core, “Energy Drift Report.”

**Observed:** The objective says “accumulate power by row,” and the editor comment says “clamp accumulated row power.” I reasonably tried `np.cumsum(energy, axis=1)` and received 2 of 3 passes. The failed check clarified “Accumulated power builds down rows” and “Use cumulative sum on axis 0.” Changing to `axis=0` passed.

**Impact:** “By row” can suggest accumulating across each row, while the required behavior accumulates down successive rows. Feedback enables recovery, but the initial wording makes axis learning harder.

**Recommendation:** Say “accumulate down the rows for each column (axis 0)” and use the same wording in the starter comment and feedback.

### 3. Column Normalizer does not initially state the required mean shape — low impact

**Where:** Nebula → Reactor Garden, “Column Normalizer.”

**Observed:** `signal.mean(axis=0)` produced correct column means and supported correct centered values and energies, but the first check failed because the game expected a retained row dimension. The failure said to keep the dimension. `signal.mean(axis=0, keepdims=True)` passed all checks.

**Recommendation:** Specify that `column_mean` should have shape `(1, number_of_columns)` or retain its row axis in the initial objective or starter comment. This makes the shape requirement part of the task rather than something discovered after submission.

### 4. Fullscreen unavailable in this test session — needs confirmation outside automation

**Observed:** Clicking the ship map's fullscreen control did not open fullscreen; the game reported “Fullscreen is unavailable in this browser.” The rest of the game remained usable. This was a Chrome session controlled through browser automation; I did not independently verify a manual click or other browser. The result may reflect browser or automation restrictions, so it is not enough evidence to call this a general product defect.

**Recommendation:** Recheck with a manual click in normal Chrome and another supported browser. If it reproduces, investigate the Fullscreen API request and its user-activation/error handling; retain the current graceful message.

### 5. Nebula map legend uses campaign terminology — minor visual copy issue

In Nebula mode the sector list says “Cleared,” “In progress,” or “Available,” while the map legend still reads “Online” and “Awaiting repair.” The sectors remain understandable, but a mode-specific legend would match the visible state more closely.

## Campaign walkthrough

| Sector | Checkpoints and observed result |
| --- | --- |
| Boot Bay | **Power Core:** deliberately ran the starter code and received three separate shape, dtype, and zero-value checks; `np.zeros` passed. **Calibration Sweep:** `linspace`, reshape, `arange`, and metadata report passed. The sector became online and Free Lab unlocked. |
| Sensor Deck | **Panel Reading:** row, rectangular slice, and paired fancy indexing passed. **Live View, Safe Snapshot:** copied the input and modified columns through a view; storage, parent edits, and preserved snapshot checks passed. |
| Reactor Garden | **Safe Roots:** absolute value and square root passed. **Broadcast Bloom:** wave, broadcasting, transforms, and danger mask passed after consulting the grading source for the missing efficiency formula. |
| Quarantine Lab | **Patch the Missing Readings:** finite mask and NaN replacement passed. **Filter the Bio Samples:** filtering, any/all summaries, and quarantine via `where` passed. |
| Cargo Forge | **Reshape the Crates:** reshape, ravel/flatten storage distinction, and transpose passed. **Join and Split Modules:** concatenate, stack, and split passed. **Repeat the Safety Pattern:** repeat and tile passed. |
| Drone Bridge | **Seeded Traffic:** Generator, repeatable data, and axis reductions passed. **Sort Flight Codes:** extrema, row sorting, argsort, and unique passed. **Route Matrix:** matrix multiplication and vector dot product passed. |
| Colony Core | **Final Rescue Sequence:** array creation, even mask, bias, row totals, reshape, weighted matrix multiplication, and score passed. The display showed 7/7 systems online. “Launch colony ship” opened a “Colony ship restored” dialog listing all seven systems and saying the crew was safe and the ship had made the jump. |

## Nebula walkthrough

All seven challenges displayed “Nebula challenge cleared” and appeared as cleared in the Ship Log:

1. **Nebula Beacon:** row-by-lane broadcasting.
2. **Stride-Safe Log:** strided view, in-place update, and copied archive.
3. **Column Normalizer:** column means with `keepdims`, centered values, and squared deviations; see finding 3.
4. **Robust Lane Score:** NaN-aware medians, replacement, and column ranges.
5. **Axis Stacking:** insertion of the middle axis and concatenation of module rows.
6. **Zero-Safe Traffic Shares:** kept row totals two-dimensional and used guarded division, producing zeros for an empty row.
7. **Energy Drift Report:** column differences, cumulative sums down rows, and clipping; see finding 2. The final action opened Ship Log rather than a separate victory scene.

## Visual and interaction notes

- The dark navy interface, mint status accents, pixel-art ship, and compact technical typography create a consistent ship-repair theme. At the desktop viewport the main areas read as a left map, central exercise, and right telemetry panel.
- The large ship cutaway visually reflects the seven sectors; completed sectors showed illuminated rooms. The mission title, objective, editor, run button, and status were visually distinguishable. The page requires vertical scrolling to see the editor and its associated output at the tested window size.
- The indexed array inspector showed shape, dtype, dimensionality, size, and values, including a three-dimensional result with an axis selector. I observed indexed 1D and 2D results and the 3D selector, but did not systematically test every inspector type or selector interaction.
- The game surfaced a useful first-run checklist rather than only saying an answer failed. The first checkpoint produced distinct feedback for shape, dtype, and zero initialization.
- Hints revealed progressively: I checked all three on several missions. A broadcasting prediction accepted the correct radio answer and displayed an explanatory confirmation. I did not test every prediction, wrong-answer branch, or hint.
- Ctrl+Enter ran code throughout the playthrough. A Free Lab experiment produced an inspectable `(3, 4)` array and, after expanding Python output, printed `[ 6 22 38]`. An intentionally incomplete expression produced a line-numbered `SyntaxError` and a collapsed traceback control.
- Ship Log displayed the campaign skill list and seven Nebula clear entries with replay controls. I inspected the list but did not exercise replay controls.
- Settings displayed plain-text editor, repair sounds, ambient tone, animation options, and Start over. I did not change settings or reset progress.
- Reload restored 7/7 campaign systems, all seven cleared Nebula sectors, the selected mode, and the most recent Nebula draft. The Free Lab draft also survived a reload. Run output itself returned to its pre-run placeholder, which is an observation rather than an assumed defect.

## Limits and remaining checks

This was one desktop Chrome session, not a mobile or multi-browser test. I did not measure initial download or runtime performance, systematically inspect console/network failures, test offline behavior, sound playback, screen-reader speech, full keyboard navigation and focus trapping, color contrast, reduced motion, all datasets, all prediction branches, all replay actions, or cross-tab behavior. I did not validate every grader against independent adversarial or alternative solutions. Fullscreen needs a manual retest as noted above. No source code was changed as part of the playtest.
