# Reference

The tool's contract: input format, matcher passes, safety behaviors, and error behavior.

## Input

The tool is `edit` and uses Pi's built-in field set:

| Field | Type | Description |
|---|---|---|
| `path` | `string` | File to edit (relative or absolute; resolved against the session working directory) |
| `edits` | `array` | One or more targeted replacements (below) |

Each edit:

| Field | Type | Description |
|---|---|---|
| `oldText` | `string` | Exact text to find. Unique in the file unless `replaceAll` is set; no overlap with other `oldText`s in the same call. An empty string seeds an empty file (inserts `newText` at the start) |
| `newText` | `string` | Replacement text |
| `replaceAll` | `boolean` (optional, default `false`) | Replace every occurrence instead of failing on ambiguity |

Multiple edits in one call match against the **original** file, not incrementally.

### Legacy edit shapes

- `patch`: aider SEARCH/REPLACE block string (pre-0.3.0 sessions)
- `edits` as a JSON string or a single edit object; top-level `oldText`/`newText`

The string and single-object forms are part of the schema (a union over `edits`), because Pi validates arguments before `prepareArguments` runs and a strict array schema would reject them first. The `patch` and top-level forms are normalized in `prepareArguments` and are not in the schema. All normalize into `edits[]` before matching.

## Matcher passes

Passes run in order, short-circuiting on the first match. Every pass returns only text verified to exist in the file; it can never produce a replacement for text that is not there.

| # | Pass | Tolerates |
|---|---|---|
| 1 | Simple | Exact match (zero-overhead fast path) |
| 2 | LineTrimmed | Leading/trailing whitespace per line |
| 3 | BlockAnchor | First/last lines as anchors, middle scored by similarity (>=0.3) |
| 4 | WhitespaceNormalized | Collapsed whitespace runs |
| 5 | IndentationFlexible | Indentation drift; blank-line differences |
| 6 | EscapeNormalized | Literal `\n`/`\t`/`\\`/`\"` where real escapes exist |
| 7 | TrimmedBoundary | Leading/trailing whitespace on the whole block |
| 8 | ContextAware | First/last non-empty lines as anchors (similarity >0.5) |
| 9 | MultiOccurrence | Trimmed line-by-line match (last resort) |
| 10 | UnicodeNormalized | Smart quotes, en/em dash characters, non-breaking spaces, ligatures, Cyrillic/Greek homoglyphs (NFKC + punctuation + confusable maps) |

## Safety behaviors

| Behavior | What it does |
|---|---|
| Uniqueness check | Multi-occurrence (without `replaceAll`) fails with 1-indexed line positions instead of guessing |
| Auto-expand | On ambiguity, grows context until exactly one occurrence is uniquely identifiable. Refused if that unique context still contains a sibling occurrence (uniqueness by file boundary, not meaning) |
| replaceAll | Skips the ambiguity check; replaces every occurrence; the summary reports the count |
| Disproportionate-match refusal | A matched span much larger than `oldText` is refused, never a silent wrong-location edit |
| Actual-substring return | Replacement targets the real file text, not the query; original formatting survives |
| Closest-candidate feedback | No-match reports the nearest real text with a similarity percentage and the differing lines |
| Coherence warnings | Non-blocking warnings for unbalanced braces and indentation jumps |
| Stale-read guard | Content-absorbing matches on a file changed since the model saw it are refused with changed lines; verbatim and formatting-class matches never are |

## Staleness handling

The tool tracks the file version the model last saw, refreshed by `read` results, its own successful writes, and the `write` tool. An edit is refused only when **all three** hold:

1. The match absorbed **real content drift**, not formatting: a similarity-based pass (`block_anchor`, `context_aware`), or a simple match that lands mid-token (e.g. `bbb` inside `bbb-x`).
2. The file's content **changed since the model last saw it** (snapshot mismatch; files too large to snapshot fall back to mtime+size).
3. The changed lines **overlap the matched span**. A valid edit whose target region is untouched by an unrelated external change proceeds.

Nothing else refuses. Byte-exact matches, formatting-class drift (whitespace, indentation, escaped sequences, Unicode, line endings), and edits with no snapshot (the model never read the file) always apply. A valid edit is therefore never refused; the refusal quotes the changed lines' current content (bounded), so the model can retry without re-reading.

Rewrite-then-edit stays smooth: this tool's own writes and pi's `write` tool refresh the snapshot, so the next edit compares against what the model just wrote, not an older read.

## Error behavior

| Condition | Result |
|---|---|
| No edits in the call | Validation error |
| Edit without a path | Validation error |
| File not found / not writable | File error with code |
| Text matches multiple locations (no `replaceAll`) | Ambiguous error with line positions + replaceAll hint |
| Fuzzy match much larger than the query | Disproportionate error, nothing written |
| Match absorbed content drift and the file changed since the model last read it | Stale-read error with changed lines, nothing written; re-read and retry |
| No match at all | Not-found error with closest candidate |
| Overlapping edits in one call | Overlap error, nothing written |
| Replacement identical to matched text | No-op error, nothing written |

Failed edits never modify the file. A failed edit is a retry: the error shows what was found (positions, closest text, or span sizes) so the retry can target it.

## Install sources

```bash
pi install npm:pi-semantic-edit        # npm registry
pi install git:github.com/k3-2o/pi-semantic-edit@v0.7.0   # pinned git ref
pi install /path/to/checkout           # local directory
```
