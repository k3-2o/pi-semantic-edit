// Shared domain types — pure, no Pi imports.

/** One parsed or constructed edit: find oldText in path, replace with newText. */
export interface Edit {
  path: string;
  oldText: string;
  newText: string;
}

/** A block parsed from an aider-format patch string. */
export interface ParsedBlock {
  path: string;
  oldText: string;
  newText: string;
}

/**
 * Result of a successful fuzzy match.
 * `actual` is the substring found in the ORIGINAL content (never the query text),
 * so replacements preserve real formatting. `passName` identifies which pass
 * matched (OpenDev parity: "simple", "line_trimmed", ..., "multi_occurrence").
 */
export interface MatchResult {
  actual: string;
  passName: string;
}

/** A candidate near-miss for closest-candidate-on-failure feedback. */
export interface ClosestCandidate {
  passName: string;
  similarity: number; // 0..1
  candidate: string; // real file text that was closest
  startLine: number; // 1-indexed
  endLine: number; // 1-indexed
}

/** Outcome of applying all edits to original content. */
export interface ApplyResult {
  content: string; // resulting content (success) or original (failure)
  applied: AppliedEdit[];
  failed: FailedEdit[];
}

export interface AppliedEdit {
  edit: Edit;
  match: MatchResult;
}

/** A matched edit with its located span in the (LF-normalized) content. */
export interface ResolvedEdit {
  edit: Edit;
  match: MatchResult;
  start: number;
  end: number;
}

export type EditFailureKind = 'overlap' | 'no-op' | 'invariant';

export interface FailedEdit {
  edit: Edit;
  reason: string;
  kind: EditFailureKind;
}

/** Error kinds surfaced to the tool layer. */
export type EditErrorKind =
  | 'malformed-patch'
  | 'missing-path'
  | 'file-not-found'
  | 'stale-read'
  | 'ambiguous'
  | 'not-found'
  | 'overlapping'
  | 'no-op'
  | 'validation';

export interface EditError {
  kind: EditErrorKind;
  message: string;
  /** 1-indexed line positions for ambiguous matches. */
  linePositions?: number[];
  /** Best near-miss when nothing matched. */
  closestCandidate?: ClosestCandidate;
}
