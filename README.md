# pi-robust-edit

The model proposes. The harness disposes.

A drop-in replacement for Pi's built-in `edit` tool, built around the **aider SEARCH/REPLACE block format** and a **10-pass fuzzy matcher chain** ported from [OpenDev](https://github.com/opendev-to/opendev) (MIT). The model emits a patch in the exact format it saw a billion times in training — no new syntax to learn — and the harness does the painstaking work of locating, disambiguating, verifying, and applying.

## Quick Start

```bash
# From a checkout
cd pi-robust-edit
pi -e ./index.ts
```

The extension registers a tool named `edit`, shadowing Pi's built-in. The model calls it exactly as it always has — but the input is a single `patch` field in aider block format:

```
src/foo.ts
```
```text
<<<<<<< SEARCH
old code (as it appears in the file)
=======
new code
>>>>>>> REPLACE
```

Multiple blocks per patch, each with its own path. Fences optional, language hints tolerated.

## Why this format

Models are stochastic and context-limited. The harness is deterministic and has full file access. The right contract: the model describes the change in the format it is most fluent in (aider blocks — the most widely-seen search/replace shape in pretraining), and the harness does the locating. A system that demands exact correctness from the model spends most of its time in error-recovery loops. Design tools that absorb LLM imprecision as a first-class property.

## How the matcher works

The 9-pass chain from OpenDev (a shipped, failure-log-evolved system), plus one addition — each pass tried in order, short-circuiting on the first match, every pass gated on a safety invariant: **a pass can only return text that literally exists in the file**.

| # | Pass | Catches |
|---|------|---------|
| 1 | Simple | Exact match — zero overhead |
| 2 | LineTrimmed | Trailing/leading whitespace per line |
| 3 | BlockAnchor | First/last lines anchor, middle scored by similarity (≥0.3) |
| 4 | WhitespaceNormalized | Collapsed whitespace runs |
| 5 | IndentationFlexible | Indentation drift, blank-line differences |
| 6 | EscapeNormalized | Literal `\n`/`\t`/`\\` where real escapes exist |
| 7 | TrimmedBoundary | Leading/trailing whitespace on the block |
| 8 | ContextAware | First/last non-empty lines as anchors (≥0.5 similarity) |
| 9 | MultiOccurrence | Trimmed line-by-line match, last resort |
| 10 | UnicodeNormalized | Smart quotes, non-breaking spaces, dashes, ligatures |

### Safety net around the chain

- **Uniqueness check** — if a match is ambiguous, the edit fails with 1-indexed line positions. Never guesses.
- **Auto-expand** — when a match is ambiguous, the matcher grows context symmetrically until exactly one occurrence is uniquely identifiable.
- **Actual-substring return** — replacements operate on the real file text, preserving genuine formatting.
- **Stale-read detection** — edits are rejected if the file changed since the model's last `read` (50ms tolerance, per the OpenDev paper).
- **Closest-candidate feedback** — when nothing matches, the error shows the nearest real text so the model corrects against reality, not blindness.
- **Coherence warnings** — non-blocking brace-balance / indentation checks after applying.

## Guarantees

- **Zero runtime dependencies** — only Node/Bun built-ins. `just audit` enforces it.
- **Atomic writes** — temp-file + rename inside Pi's mutation queue.
- **CRLF and BOM preserved** — matching happens on normalized content; the file keeps its own line endings and BOM.
- **Deterministic tests** — 186 tests including the full OpenDev parity suite (33 cases ported verbatim from the Rust reference).

## Development

```bash
just fmt      # prettier
just check    # eslint + tsc + zero-dependency audit
just test     # bun test
just ci       # everything
```

## License

MIT
