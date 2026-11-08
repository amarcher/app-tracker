import { loadCrosswordGameplay } from './crossword-gameplay.js';
import type { BusinessSummary } from '../../src/types/business.js';

/** Only dated counts enter the shared snapshot, never registered names. */
export async function loadHouseholdGameplay(now = Date.now()): Promise<NonNullable<BusinessSummary['gameplay']>> {
  try {
    const report = await loadCrosswordGameplay(1, now);
    if (!report.available) return { available: false };
    return { available: true, generatedAt: report.generatedAt, date: report.range.through,
      players: report.segments.all.players, attempts: report.segments.all.attempts };
  } catch {
    return { available: false };
  }
}
