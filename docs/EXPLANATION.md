# Explanation

Why this tool is designed the way it is.

## The contract: format familiarity over format cleverness

An LLM editing a file doesn't retype it — it describes a change (a location plus a replacement) that separate software applies. Failures come from two sources:

1. **Generation failures** — the model emits a malformed or semantically wrong edit, usually because the expected format doesn't match what it saw most in training.
2. **Application failures** — the instruction is well-formed but doesn't land: drifted whitespace, tabs vs. spaces, a stale view of the file.

A better *format* only fixes the first. A better *matcher* fixes the second — and in practice, the matcher does most of the reliability work.

The format decision follows from the research: no single format is universally best, and strong general-purpose models are *bad* at choosing between formats when prompted. So the tool offers exactly one format — the aider SEARCH/REPLACE block — the most widely-represented search/replace shape in model pretraining. No line numbers to miscount, nothing new to learn. All the reliability engineering goes into the matcher underneath.

## The matcher: a failure-log-evolved chain

The 10-pass chain is a port of [OpenDev](https://github.com/opendev-to/opendev)'s `edit_file` matcher (MIT), described in [arXiv:2603.05344](https://arxiv.org/abs/2603.05344). OpenDev's design evolved from a two-pass matcher (exact + whitespace-stripped) — which was its single largest source of "content not found" errors — into nine targeted passes after failure-log analysis showed that formatting drift falls into distinct, predictable categories.

The port preserves OpenDev's semantics exactly, including the safety invariant: **every pass returns only text verified to exist in the file.** A pass that returns text not in the file would be a wrong-location edit — the one failure class this project refuses to accept. A failed edit is a retry; a wrong edit is a bug.

### Our additions

- **Unicode pass (10th)** — OpenDev has no Unicode handling. NFKC covers non-breaking spaces and ligatures, but not typographic quotes or dashes (they have no compatibility decomposition) — so a small punctuation map sits on top.
- **Auto-expand** — on ambiguity, grows context symmetrically until exactly one occurrence is uniquely identifiable. Accepts only when exactly one candidate disambiguates; simultaneous uniqueness means the ambiguity is genuine.
- **Coherence warnings** — non-blocking structural checks (brace balance, indentation jumps) that catch a different failure class than matching: an edit that applied but structurally broke the file.

## What was deliberately rejected

| Approach | Why not |
|---|---|
| Unified-diff format | `@@` line-number headers are the single biggest failure point — models miscount lines |
| Joint scoring (blend all pass signals) | Breaks the chain's traceability: you always know *which pass* matched, which is what makes failures debuggable |
| Token fingerprint (identifier-based disambiguation) | Speculative — no observed failure mode; auto-expand + ambiguity errors cover the narrow case, without the wrong-location risk |
| AST-scoped anchoring | The model already disambiguates by including a function signature line in SEARCH; per-language parsers add fragility for no measured gain |
| Whole-file rewrite format | A second model-facing format reintroduces the format-choice problem; models already have the `write` tool |

## Sources

- Bui, N. D. Q., "Building Effective AI Coding Agents for the Terminal," arXiv:2603.05344 — the paper behind the matcher design.
- [opendev-to/opendev](https://github.com/opendev-to/opendev) — the Rust reference implementation this tool ports.
