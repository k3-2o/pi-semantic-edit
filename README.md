# pi-semantic-edit

> A drop-in replacement for Pi's built-in `edit` tool that accepts aider-format SEARCH/REPLACE blocks and applies them through a fuzzy matcher that tolerates the drift models actually produce.

## Features

- **Aider-format input** — the model writes SEARCH/REPLACE blocks exactly as it does everywhere else; nothing new to learn.
- **10-pass fuzzy matcher** — exact match first, then progressively tolerant passes for whitespace, indentation, escapes, and Unicode drift (smart quotes, dashes, non-breaking spaces).
- **Never guesses** — ambiguous matches fail with the exact line positions; no silent wrong-location edits.
- **Stale-read protection** — rejects edits to files that changed since the model last read them.
- **Zero runtime dependencies** — Node/Bun built-ins only.

## Quick Start

```bash
# Install
pi install npm:pi-semantic-edit

# Or try it without installing
pi -e npm:pi-semantic-edit
```

Pi packages run with full system access — review the source before using.

Once loaded, the tool replaces Pi's built-in `edit`. The model calls `edit` with a single `patch` field:

```
src/foo.ts
```
```text
<<<<<<< SEARCH
old code as it appears in the file
=======
new code
>>>>>>> REPLACE
```

## Usage

Edit a file by describing the change as a search/replace block:

```
edit: src/foo.ts
<<<<<<< SEARCH
let x = 1;
=======
let x = 2;
>>>>>>> REPLACE
```

The matcher tolerates minor drift between your SEARCH text and the file — trailing whitespace, indentation, line endings, escaped sequences, and typographic quotes all normalize during matching.

Multiple blocks in one patch, each with its own path:

```
src/a.ts
<<<<<<< SEARCH
alpha
=======
ALPHA
>>>>>>> REPLACE
src/b.ts
<<<<<<< SEARCH
beta
=======
BETA
>>>>>>> REPLACE
```

If the SEARCH text matches more than one location, the edit fails with the line positions and asks for more context — the file is left untouched. If nothing matches, the error shows the closest text actually in the file so the correction can target reality.

## Documentation

- [Reference](docs/REFERENCE.md) — input format, matcher passes, error behavior
- [Explanation](docs/EXPLANATION.md) — why the format and the matcher are designed this way

## License

MIT — see [LICENSE](LICENSE).
