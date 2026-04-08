import type { VercelRequest, VercelResponse } from '@vercel/node';

const API_KEY = process.env.ELEVENLABS_API_KEY?.trim();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const range = (req.query.range as string) || '30d';
    const days = parseInt(range.replace('d', ''), 10) || 30;

    const endMs = Date.now();
    const startMs = endMs - days * 24 * 60 * 60 * 1000;

    const [usageRes, breakdownRes, subRes] = await Promise.all([
      fetch(
        `https://api.elevenlabs.io/v1/usage/character-stats?start_unix=${startMs}&end_unix=${endMs}&aggregation_interval=day`,
        { headers: { 'xi-api-key': API_KEY! } }
      ),
      fetch(
        `https://api.elevenlabs.io/v1/usage/character-stats?start_unix=${startMs}&end_unix=${endMs}&aggregation_interval=day&breakdown_type=product_type`,
        { headers: { 'xi-api-key': API_KEY! } }
      ),
      fetch('https://api.elevenlabs.io/v1/user/subscription', {
        headers: { 'xi-api-key': API_KEY! },
      }),
    ]);

    if (!usageRes.ok) {
      throw new Error(`ElevenLabs usage API error: ${usageRes.status}`);
    }

    const usageData = await usageRes.json();
    const times: number[] = usageData.time || [];
    const usageValues: Record<string, number[]> = usageData.usage || {};

    // Total timeseries (all products)
    let totalCharacters = 0;
    const timeseries = times.map((timestamp, i) => {
      let characters = 0;
      for (const key in usageValues) {
        characters += usageValues[key][i] || 0;
      }
      totalCharacters += characters;
      const d = new Date(timestamp);
      const date = d.toISOString().split('T')[0].replace(/-/g, '');
      return { date, characters };
    });

    // Product breakdown (TTS, Conversational AI, etc.)
    let productBreakdown: Record<string, number> = {};
    if (breakdownRes.ok) {
      const breakdownData = await breakdownRes.json();
      const bUsage: Record<string, number[]> = breakdownData.usage || {};
      for (const product in bUsage) {
        productBreakdown[product] = bUsage[product].reduce((sum: number, v: number) => sum + (v || 0), 0);
      }
    }

    // Subscription info
    let subscription = {
      characterCount: totalCharacters,
      characterLimit: 0,
      tier: 'Unknown',
      nextResetUnix: 0,
    };

    if (subRes.ok) {
      const subData = await subRes.json();
      subscription = {
        characterCount: subData.character_count ?? totalCharacters,
        characterLimit: subData.character_limit ?? 0,
        tier: subData.tier ?? 'Unknown',
        nextResetUnix: subData.next_character_count_reset_unix ?? 0,
      };
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.json({ timeseries, productBreakdown, subscription });
  } catch (error) {
    console.error('ElevenLabs API error:', error);
    res.status(500).json({ error: 'Failed to fetch ElevenLabs data' });
  }
}
