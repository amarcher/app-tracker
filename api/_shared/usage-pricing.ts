// Standard text-token list prices, USD per million tokens; checked 2026-10-26.
// https://developers.openai.com/api/docs/pricing
// https://platform.claude.com/docs/en/about-claude/pricing
// These estimates exclude cache/batch discounts, tools, media, tax and contracts.
const PRICING: Record<string, Record<string, { input: number; output: number }>> = {
  anthropic: {
    'claude-sonnet-4-20250514': { input: 3, output: 15 },
    'claude-sonnet-4-6': { input: 3, output: 15 },
    'claude-haiku-4-5-20251001': { input: 1, output: 5 },
    'claude-opus-4-7': { input: 5, output: 25 },
  },
  openai: {
    'gpt-4o': { input: 2.5, output: 10 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
    'gpt-4.1': { input: 2, output: 8 },
    'gpt-4.1-mini': { input: 0.4, output: 1.6 },
    'gpt-4.1-nano': { input: 0.1, output: 0.4 },
    'o3-mini': { input: 1.1, output: 4.4 },
  },
};

export const COST_SCOPE = 'Logged API usage only. Standard text-token estimates exclude unlogged activity, cache/batch adjustments, tools, media, subscriptions and tax. ElevenLabs usage is account-wide and plan-dependent; it is not priced here.';

export function estimateCost(service: string, model: string | null, tokensIn: number, tokensOut: number): number | null {
  const models = Object.hasOwn(PRICING, service) ? PRICING[service] : undefined;
  const rate = models && model && Object.hasOwn(models, model) ? models[model] : undefined;
  if (!rate || ![tokensIn, tokensOut].every(n => Number.isFinite(n) && n >= 0)) return null;
  return (tokensIn * rate.input + tokensOut * rate.output) / 1_000_000;
}
