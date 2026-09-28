import { describe, expect, it } from 'vitest';
import { creditAlertConnectedMessage, creditAlertMessage, creditBand } from '../_shared/credit-alert';

const sub = (used: number, limit = 100_000, extend = false) => ({
  character_count: used,
  character_limit: limit,
  can_extend_character_limit: extend,
  allowed_to_extend_character_limit: extend,
  next_character_count_reset_unix: Date.UTC(2026, 9, 12) / 1000,
});

describe('creditBand', () => {
  it('bands by remaining credit, matching Stella\'s pause floor', () => {
    expect(creditBand(sub(10_000))).toBe('ok');
    expect(creditBand(sub(85_000))).toBe('low');
    expect(creditBand(sub(99_000))).toBe('out');
  });

  it('never reports out while usage-based overage is allowed', () => {
    expect(creditBand(sub(100_000, 100_000, true))).toBe('low');
  });
});

describe('creditAlertMessage', () => {
  it('stays quiet when the band has not changed', () => {
    expect(creditAlertMessage('low', 'low', sub(85_000))).toBeNull();
  });

  it('announces low, out, partial and full recovery with numbers and reset date', () => {
    expect(creditAlertMessage('ok', 'low', sub(85_000))).toMatch(/getting low.*15,000 of 100,000 credits left \(15%\).*Resets Oct 12/);
    expect(creditAlertMessage('low', 'out', sub(99_000))).toMatch(/credit is out.*Stella is paused/);
    expect(creditAlertMessage('out', 'low', sub(85_000))).toMatch(/partly restored.*Stella is back/);
    expect(creditAlertMessage('low', 'ok', sub(10_000))).toMatch(/restored.*90%.*Stella is available again/);
  });
});

it('announces the connection once with the current state', () => {
  expect(creditAlertConnectedMessage('ok', sub(10_000))).toMatch(/connected.*90,000 of 100,000 credits left \(90%, ok\)/);
});
