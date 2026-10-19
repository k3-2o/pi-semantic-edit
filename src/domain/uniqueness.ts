import { findOccurrencePositions } from './chain';

export interface OccurrenceReport {
  count: number;
  positions: number[];
  ambiguous: boolean;
}

export function reportOccurrences(content: string, actual: string): OccurrenceReport {
  const positions = findOccurrencePositions(content, actual);
  return { count: positions.length, positions, ambiguous: positions.length > 1 };
}

export function formatLinePositions(positions: number[]): string {
  return positions.map((n) => `line ${n}`).join(', ');
}
