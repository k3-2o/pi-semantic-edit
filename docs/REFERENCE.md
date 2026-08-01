# Reference

The tool's contract: input format, matcher passes, and error behavior.

## Input

The tool is `edit`, one field:

| Field | Type | Description |
|---|---|---|
| `patch` | string | Aider-format SEARCH/REPLACE blocks (below) |

### Block format

Each block: the file path on its own line, then a block (fenced or bare) containing `<<<<<<< SEARCH`, the text to find, `=======`, the replacement, `>>>>>>> REPLACE`.

```
src/foo.ts
```
```text
<<<<<<< SEARCH
old code
=======
new code
>>>>>>> REPLACE
```

- Fences are optional; a language hint after the fence (e.g. `python` or `diff`) is ignored.
- Multiple blocks per patch; each block's path comes from the line preceding its SEARCH marker. A block without a path header reuses the previous block's path.
- Blocks are matched against the **original** file content, not incrementally.

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
| Uniqueness check | If the matched text occurs more than once, the edit fails with 1-indexed line positions instead of guessing |
| Auto-expand | On ambiguity, grows context symmetrically around each occurrence until exactly one is uniquely identifiable |
| Actual-substring return | The replacement targets the real file text (not the query), preserving genuine formatting |
| Stale-read detection | Rejects edits when the file's mtime is newer than the model's last read (50ms tolerance) |
| Closest-candidate feedback | On no-match, reports the nearest real text with a similarity percentage |
| Coherence warnings | Non-blocking warnings for unbalanced braces and suspicious indentation jumps after applying |

## Error behavior

| Condition | Result |
|---|---|
| Malformed patch (no blocks) | Validation error |
| Block without a path header | Missing-path error |
| File not found / not writable | File error |
| File changed since last read | Stale-read error with re-read guidance |
| SEARCH matches multiple locations | Ambiguous error with line positions |
| No match at all | Not-found error with closest candidate |
| Overlapping edits in one patch | Overlap error, nothing written |
| SEARCH and REPLACE identical | No-op error |

Failed edits never modify the file. A failed edit is a retry; the error message shows what was actually found so the retry can target it.

## Install sources

```bash
pi install npm:pi-semantic-edit        # npm registry
pi install git:github.com/k3-2o/pi-semantic-edit@v0.2.1   # pinned git ref
pi install /path/to/checkout           # local directory
```
