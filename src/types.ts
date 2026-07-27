export interface Edit {
  /** The exact or approximate code to find. */
  oldText: string;
  /** The replacement code. */
  newText: string;
  /**
   * Optional nearby unique snippet that narrows the search region.
   * If provided, the match is constrained to the region containing this anchor.
   */
  anchor?: string;
}

export interface MatchResult {
  /** Character offset where the match starts in the normalized content. */
  start: number;
  /** Character offset where the match ends (exclusive). */
  end: number;
  /** Whether the match required any normalization beyond line endings. */
  usedFuzzy: boolean;
  /** Whether the match required line-ending normalization. */
  usedNormalized: boolean;
  /** Human-readable description of how the match was resolved. */
  description?: string;
}

export interface ApplyResult {
  /** The new file content after applying all edits. */
  newContent: string;
  /** Which edits were successfully applied (in order). */
  matches: (MatchResult & { edit: Edit })[];
  /** Which edits failed to apply and why. */
  failed: { edit: Edit; reason: string }[];
  /** Warnings from post-edit coherence checks. */
  warnings?: string[];
}

export interface ToolInput {
  /** Path to the file to edit (relative or absolute). */
  path: string;
  /** One or more edits to apply. All matched against the original file content. */
  edits: Edit[];
}

export interface ToolOutputContent {
  type: 'text';
  text: string;
}

export interface ToolOutput {
  content: ToolOutputContent[];
  details?: {
    diff?: string;
    patch?: string;
    firstChangedLine?: number;
  };
}

export interface MatcherOptions {
  /** Whether to attempt normalized matching (line endings, trailing whitespace). Default: true. */
  allowNormalized?: boolean;
  /** Whether to attempt auto-expanding context when oldText is not unique. Default: true. */
  allowExpand?: boolean;
  /** Whether to use joint old/new scoring to disambiguate duplicates. Default: true. */
  allowJointScoring?: boolean;
  /** Maximum lines to expand in each direction for auto-expand. Default: 10. */
  maxExpandLines?: number;
}
