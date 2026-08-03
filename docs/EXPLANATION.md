# Explanation

Why this tool is designed the way it is.

## The contract: the built-in's format, with the harness doing the work

An LLM editing a file doesn't retype it — it describes a change (a location plus a replacement) that separate software applies. Failures come from two sources:

1. **Generation failures** — the model emits a malformed or semantically wrong edit, usually because the expected format doesn't match what it saw most in training.
2. **Application failures** — the instruction is well-formed but doesn't land: drifted whitespace, tabs vs. spaces, a stale view of the file.

A better *format* only fixes the first. A better *matcher* fixes the second — and in practice, the matcher does most of the reliability work.

The tool's input is **Pi's built-in `edits[]` contract**, plus one optional per-edit `replaceAll` field. The reasoning:

- The model is already steered toward `edits[]` by the built-in tool's own prompt guidelines. Adopting it means zero new format to learn — the tool shadows the built-in so completely that the model can't tell the difference until its edit drifts and the tolerance kicks in.
- `replaceAll` is the escape hatch for rename-everywhere edits. It ships in OpenDev (`replace_all`) and OpenCode (`replaceAll`); it's the difference between "our tool, with a rename escape hatch" and "the built-in, with a better matcher."
- The aider SEARCH/REPLACE block format is legacy — designed for an era before standardized tool calls. It's still accepted (deprecated) so sessions that started on earlier versions keep working, but it is not the contract.

This design is the answer to a question the research settled: **should robustness live in the edit protocol itself or in the tool that applies edits?** The surviving edit tools (Pi, OpenDev, OpenCode) all use the same search/replace family and differentiate entirely on what the harness does after the call. No format is perfect; the harness absorbs the imperfection.

## The matcher: a failure-log-evolved chain

The 10-pass chain is a port of [OpenDev](https://github.com/opendev-to/opendev)'s `edit_file` matcher (MIT), described in [arXiv:2603.05344](https://arxiv.org/abs/2603.05344). OpenDev's design evolved from a two-pass matcher (exact + whitespace-stripped) — its single largest source of "content not found" errors — into nine targeted passes after failure-log analysis showed that formatting drift falls into distinct, predictable categories. The paper's Appendix D enumerates all nine passes with their thresholds; the port preserves them exactly.

The port also preserves the safety invariant: **every pass returns only text verified to exist in the file.** A pass that returns text not in the file would be a wrong-location edit — the one failure class this project refuses to accept. A failed edit is a retry; a wrong edit is a bug.

### Our additions

- **Unicode pass (10th)** — OpenDev has no Unicode handling. NFKC covers non-breaking spaces and ligatures, but not typographic quotes or dashes (they have no compatibility decomposition) — a small punctuation map sits on top.
- **Auto-expand** — on ambiguity, grows context symmetrically until exactly one occurrence is uniquely identifiable. Accepts only when exactly one candidate disambiguates; simultaneous uniqueness means the ambiguity is genuine.
- **replaceAll** — replaces every occurrence of the matched text in one edit, skipping the ambiguity error (OpenDev/OpenCode precedent).
- **Disproportionate-match refusal** — a fuzzy pass must never match a span far larger than the query; the tool refuses rather than apply a wrong edit (OpenCode precedent).
- **Coherence warnings** — non-blocking structural checks (brace balance, indentation jumps) that catch a different failure class than matching: an edit that applied but structurally broke the file.

## The failure contract

Every failed edit leaves the file untouched and states **what was found** and **what to do next**:

- Ambiguous → line positions + "or set replaceAll: true"
- Not found → closest candidate + similarity percentage, correct against it
- Stale → re-read the file and retry
- Disproportionate → matched span too large, provide the full exact text
- Overlap / no-op / validation → explicit reason and the fix

The measure of success: the model never reaches for a python script, `awk`, or `sed` to apply an edit out of frustration. The paper's §3.4 doctrine is the north star — *design tools to absorb LLM imprecision as a first-class property* — and its error-classification lesson (targeted recovery hints per failure category) is the ancestor of this error taxonomy.

## What was deliberately rejected

| Approach | Why not |
|---|---|
| Unified-diff format | `@@` line-number headers are the single biggest failure point — models miscount lines |
| Joint scoring (blend all pass signals) | Breaks the chain's traceability: you always know *which pass* matched, which is what makes failures debuggable |
| Token fingerprint (identifier-based disambiguation) | Speculative — no observed failure mode; auto-expand + ambiguity errors cover the narrow case, without the wrong-location risk |
| AST-scoped anchoring | The model already disambiguates by including a function signature line in oldText; per-language parsers add fragility for no measured gain |
| Whole-file rewrite format | A second model-facing format reintroduces the format-choice problem; models already have the `write` tool |
| Incremental multi-edit | Strictly more failure-prone; the built-in promises non-incremental matching |
| LSP diagnostics feedback | Violates the zero-dependency constraint; heavier than coherence warnings |
| Content-snapshot stale guard | Needs permission-layer cooperation the extension architecture doesn't have; mtime + 50ms tolerance is the paper-confirmed reference design |
| Pass 11 `unicode_trimmed` (compose pass 2 + pass 10) | PROPOSAL-11, 2026-08-03. The one analytic construction where the built-in's fused pass wins and all 10 passes fail (query dirtier than file in *both* trailing whitespace and typographic punctuation) is real — verified — but has **zero observed instances** across the torture suite, OpenDev's failure logs, and reviewed benchmarks. A pass entered on reasoning alone sets the precedent that the chain grows by hypothesis instead of by failure data; it is joint scoring in narrow dress (a match that names a blend, not a cause). The miss already costs one cheap round-trip via the closest-candidate fallback. **Re-entry trigger: implement only when a wild failure matching PROPOSAL-11 §2.3 is observed — and then with the fast-path fixed to test normalization identity, not ASCII** (the sketched fast-path fails inside its own gap class) |

## Sources

- Bui, N. D. Q., "Building Effective AI Coding Agents for the Terminal," arXiv:2603.05344 — the paper behind the matcher design (Appendix D pass catalog, §2.4.2 stale-read/locking, §3.4 "absorb LLM imprecision").
- [opendev-to/opendev](https://github.com/opendev-to/opendev) — the Rust reference implementation this tool ports.
- [sst/opencode](https://github.com/sst/opencode) — `replaceAll` and the disproportionate-match refusal precedents.
- Pi's built-in `edit` (`packages/coding-agent/src/core/tools/edit.ts`) — the `edits[]` contract, legacy coercion, and TUI rendering parity.
