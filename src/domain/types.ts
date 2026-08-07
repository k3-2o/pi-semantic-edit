// --- Shared domain types — pure, no Pi imports ---

interface Edit {
  path: string;
  oldText: string;
  newText: string;
}

// --- Primary contract (SPEC D1): built-in edits[] shape + optional replaceAll escape hatch (OpenDev/OpenCode precedent) ---
export interface EditRequest extends Edit {
  replaceAll?: boolean;
}

// --- Block parsed from an aider-format patch string (deprecated legacy input) ---
export interface ParsedBlock {
  path: string;
  oldText: string;
  newText: string;
}

// --- Fuzzy match; actual is the ORIGINAL substring (never the query), so replacements preserve real formatting ---
export interface MatchResult {
  actual: string;
  passName: string; // --- which pass matched (OpenDev parity) ---
}

// --- Candidate near-miss for closest-candidate-on-failure feedback ---
export interface ClosestCandidate {
  passName: string;
  similarity: number;
  candidate: string;
  startLine: number;
  endLine: number;
}

// --- Outcome of applying all edits to original content ---
export interface ApplyResult {
  content: string; // --- resulting content (success) or original (failure) ---
  applied: AppliedEdit[];
  failed: FailedEdit[];
}

interface AppliedEdit {
  edit: Edit;
  match: MatchResult;
}

// --- Matched edit with its located span in the (LF-normalized) content ---
export interface ResolvedEdit {
  edit: Edit;
  match: MatchResult;
  start: number;
  end: number;
}

type EditFailureKind = 'overlap' | 'no-op' | 'invariant';

export interface FailedEdit {
  edit: Edit;
  reason: string;
  kind: EditFailureKind;
}

type EditErrorKind =
  | 'malformed-patch'
  | 'missing-path'
  | 'file-not-found'
  | 'ambiguous'
  | 'not-found'
  | 'overlapping'
  | 'no-op'
  | 'disproportionate'
  | 'validation';

export interface EditError {
  kind: EditErrorKind;
  message: string;
  // --- 1-indexed line positions for ambiguous matches ---
  linePositions?: number[];
  // --- Best near-miss when nothing matched ---
  closestCandidate?: ClosestCandidate;
}
