/**
 * ElevenLabs credit bands and the Slack messages sent when the band changes.
 * Space Explorer pauses Stella below the same floor (solar-system
 * api/_lib/stellaAvailability.ts), so "out" here means visitors see
 * "Stella is resting right now".
 */

export type CreditBand = 'ok' | 'low' | 'out';

export interface Subscription {
  character_count: number;
  character_limit: number;
  can_extend_character_limit?: boolean;
  allowed_to_extend_character_limit?: boolean;
  next_character_count_reset_unix?: number | null;
}

export const OUT_FLOOR_CREDITS = 2000;
export const DEFAULT_LOW_FRACTION = 0.2;

export function creditBand(sub: Subscription, lowFraction = DEFAULT_LOW_FRACTION): CreditBand {
  const remaining = sub.character_limit - sub.character_count;
  const overage = !!(sub.can_extend_character_limit && sub.allowed_to_extend_character_limit);
  if (remaining < OUT_FLOOR_CREDITS && !overage) return 'out';
  if (remaining < sub.character_limit * lowFraction) return 'low';
  return 'ok';
}

const fmt = (n: number) => Math.max(0, Math.round(n)).toLocaleString('en-US');

/** The Slack text for a band change, or null when nothing should be sent. */
export function creditAlertMessage(previous: CreditBand, current: CreditBand, sub: Subscription): string | null {
  if (previous === current) return null;
  const remaining = sub.character_limit - sub.character_count;
  const percent = sub.character_limit > 0 ? Math.max(0, Math.round((remaining / sub.character_limit) * 100)) : 0;
  const left = `${fmt(remaining)} of ${fmt(sub.character_limit)} credits left (${percent}%)`;
  const reset = sub.next_character_count_reset_unix
    ? ` Resets ${new Date(sub.next_character_count_reset_unix * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}.`
    : '';
  const topUp = 'Top up: https://elevenlabs.io/app/subscription';

  if (current === 'out') {
    return `:red_circle: *ElevenLabs credit is out.* ${left}.${reset} Stella is paused on spaceexplorer.tech (visitors see "Stella is resting right now"), and other voice agents on this account will fail. ${topUp}`;
  }
  if (current === 'low') {
    return previous === 'out'
      ? `:large_yellow_circle: *ElevenLabs credit partly restored.* ${left}.${reset} Stella is back on spaceexplorer.tech, but credit is still low.`
      : `:warning: *ElevenLabs credit is getting low.* ${left}.${reset} Stella pauses itself automatically when it runs out. ${topUp}`;
  }
  return `:white_check_mark: *ElevenLabs credit restored.* ${left}.${reset} Stella is available again.`;
}

/** Posted once, the first time the job runs with Slack configured, to prove the wiring. */
export function creditAlertConnectedMessage(current: CreditBand, sub: Subscription): string {
  const remaining = sub.character_limit - sub.character_count;
  const percent = sub.character_limit > 0 ? Math.max(0, Math.round((remaining / sub.character_limit) * 100)) : 0;
  return `:satellite: *ElevenLabs credit alerts are connected.* ${fmt(remaining)} of ${fmt(sub.character_limit)} credits left (${percent}%, ${current}). This channel will hear when credit gets low, runs out, or is restored.`;
}
