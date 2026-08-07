# Reference

The tool's contract: input format, matcher passes, safety behaviors, and error behavior.

## Input

The tool is `edit`. One field set, mirroring Pi's built-in edit:

| Field | Type | Description |
|---|---|---|
| `path` | `string` | Path to the file to edit (relative or absolute; resolved against the session working directory) |
| `edits` | `array` | One or more targeted replacements (below) |

Each edit:

| Field | Type | Description |
|---|---|---|
| `oldText` | `string` | Exact text to find. Must be unique in the file unless `replaceAll` is set, and must not overlap other `oldText`s in the same call |
| `newText` | `string` | Replacement text |
| `replaceAll` | `boolean` (optional) | Replace every occurrence of the matched text instead of failing on ambiguity. Default `false` |

Multiple edits in one call are matched against the **original** file, not incrementally.

### Deprecated legacy inputs (accepted, not in the schema)

- `patch` — aider SEARCH/REPLACE block string (pre-0.3.0 sessions)
- `edits` as a JSON string; top-level `oldText`/`newText` — built-in legacy coercion parity

These are normalized into the same `edits[]` shape before any matching.

## Matcher passes

Passes run in order, short-circuiting on the first match. Every pass returns only text verified to exist in the file — a pass can never produce a replacement for text that isn't there.

| # | Pass | Tolerates |
|---|---|---|
| 1 | Simple | Exact match — the zero-overhead fast path |
| 2 | LineTrimmed | Leading/trailing whitespace per line |
| 3 | BlockAnchor | First/last lines as anchors, middle scored by similarity (≥0.3) |
| 4 | WhitespaceNormalized | Collapsed whitespace runs |
| 5 | IndentationFlexible | Indentation drift; blank-line differences |
| 6 | EscapeNormalized | Literal `\n`/`\t`/`\\`/`\"` where real escapes exist |
| 7 | TrimmedBoundary | Leading/trailing whitespace on the whole block |
| 8 | ContextAware | First/last non-empty lines as anchors (similarity >0.5) |
| 9 | MultiOccurrence | Trimmed line-by-line match — the last resort |
| 10 | UnicodeNormalized | Smart quotes, en/em dashes, non-breaking spaces, ligatures (NFKC + punctuation map) |

## Safety behaviors

| Behavior | What it does |
|---|---|
| Uniqueness check | If the matched text occurs more than once (and `replaceAll` is unset), the edit fails with 1-indexed line positions instead of guessing |
| Auto-expand | On ambiguity, grows context symmetrically around each occurrence until exactly one is uniquely identifiable |
| replaceAll | Skips the ambiguity check and replaces every occurrence of the matched text; the summary reports the total replacement count |
| Disproportionate-match refusal | If a fuzzy pass matches a span much larger than `oldText`, the edit is refused — never a silent wrong-location edit |
| Actual-substring return | The replacement targets the real file text (not the query), preserving genuine formatting |
| Closest-candidate feedback | On no-match, reports the nearest real text with a similarity percentage |
| Coherence warnings | Non-blocking warnings for unbalanced braces and suspicious indentation jumps after applying |

## Error behavior

| Condition | Result |
|---|---|
| No edits in the call | Validation error |
| Edit without a path | Validation error |
| File not found / not writable | File error with code |
| Text matches multiple locations (no `replaceAll`) | Ambiguous error with line positions + replaceAll hint |
| Fuzzy match much larger than the query | Disproportionate error, nothing written |
| No match at all | Not-found error with closest candidate |
| Overlapping edits in one call | Overlap error, nothing written |
| Replacement identical to matched text | No-op error, nothing written |

Failed edits never modify the file. A failed edit is a retry: the error message shows what was actually found (positions, closest text, or span sizes) so the retry can target it.

## Install sources

```bash
pi install npm:pi-semantic-edit        # npm registry
pi install git:github.com/k3-2o/pi-semantic-edit@v0.3.0   # pinned git ref
pi install /path/to/checkout           # local directory
```
