# pi-semantic-edit

The model proposes. The harness disposes.

pi-semantic-edit is a drop-in replacement for Pi's built-in `edit` tool. The model emits old code → new code the way it's seen a billion times in training — GitHub diffs, Stack Overflow answers, merge markers — and the harness does the painstaking work of locating, disambiguating, verifying, and applying. The model is the architect; the harness is the builder and the inspector.

---

## Features

- **Handles ambiguity** — duplicates, whitespace drift, and stale reads are resolved automatically through layered matching, not retries
- **Anchor targeting** — provide a nearby unique snippet to pin the edit to a specific function or block
- **SEARCH/REPLACE blocks** — the model writes old/new blocks in the same natural format it knows from training, no JSON schema required
- **Safety verification** — post-edit coherence checks catch unbalanced braces and suspicious indentation before they reach your codebase
- **Drop-in replacement** — same tool name, same rendering. The model calls `edit` as always; the only difference is the harness.

---

## Quick Start

```bash
# Install from git
pi install git:https://github.com/k3-2o/pi-semantic-edit.git

# Or load directly from a local checkout
pi -e ./index.ts
```

Once loaded, the extension replaces Pi's built-in `edit` tool. The model calls `edit` as always.

---

## Usage

### Basic old/new blocks (JSON)

```json
{
  "path": "src/foo.ts",
  "edits": [
    {
      "oldText": "    console.log('hello');",
      "newText": "    console.log('goodbye');"
    }
  ]
}
```

### With an anchor

When the same `oldText` appears in multiple places, add an `anchor` — a nearby unique snippet like a function signature:

```json
{
  "path": "src/foo.ts",
  "edits": [
    {
      "anchor": "function logMessage() {",
      "oldText": "    console.log('hello');",
      "newText": "    console.log('goodbye');"
    }
  ]
}
```

### SEARCH/REPLACE blocks (patch format)

Instead of JSON, use a natural block format that matches how models already express edits in training:

```
src/foo.ts
<<<<<<< SEARCH
    console.log('hello');
=======
    console.log('goodbye');
>>>>>>> REPLACE
```

Send this as the `patch` field:

```json
{
  "patch": "src/foo.ts\n<<<<<<< SEARCH\n    console.log('hello');\n=======\n    console.log('goodbye');\n>>>>>>> REPLACE"
}
```

Multiple blocks can appear in one patch string. The file path is read from the `[filename]` header before each block.

---

## License

MIT — see [LICENSE](./LICENSE)
