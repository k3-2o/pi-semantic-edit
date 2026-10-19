interface Edit {
  path: string;
  oldText: string;
  newText: string;
}

export interface EditRequest extends Edit {
  replaceAll?: boolean;
}

export interface ParsedBlock {
  path: string;
  oldText: string;
  newText: string;
}

export interface MatchResult {
  actual: string;
  passName: string;
}

export interface LineDiffHint {
  lineNumber: number;
  yours: string;
  file: string;
}

export interface ClosestCandidate {
  passName: string;
  similarity: number;
  candidate: string;
  startLine: number;
  endLine: number;
  lineDiffs?: LineDiffHint[];
}

export interface ApplyResult {
  content: string;
  applied: AppliedEdit[];
  failed: FailedEdit[];
}

interface AppliedEdit {
  edit: Edit;
  match: MatchResult;

  start: number;
  end: number;
}

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
  | 'stale-read'
  | 'validation';

export interface EditError {
  kind: EditErrorKind;
  message: string;

  linePositions?: number[];

  closestCandidate?: ClosestCandidate;
}
