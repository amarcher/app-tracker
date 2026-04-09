// Per-project ElevenLabs Conversational AI agent mappings.
//
// Agent IDs are read from env vars so they can be managed via the Vercel
// dashboard (like GA4 property IDs and Cloudflare zone IDs). Project keys
// must match the keys used in PROPERTIES / ZONES / the frontend PROJECTS
// config in src/App.tsx. Each project maps to an array so it's easy to add
// multiple agents per project later.

const env = (name: string) => (process.env[name] ?? '').trim();

export const ELEVENLABS_AGENTS: Record<string, string[]> = {
  'animal-penpals': [env('ELEVENLABS_AGENT_ID_ANIMAL_PENPALS')].filter(Boolean),
  'space-explorer': [env('ELEVENLABS_AGENT_ID_SPACE_EXPLORER')].filter(Boolean),
  'periodic-table': [env('ELEVENLABS_AGENT_ID_PERIODIC_TABLE')].filter(Boolean),
  'crossword-clash': [env('ELEVENLABS_AGENT_ID_CROSSWORD_CLASH')].filter(Boolean),
  'mark-my-words': [env('ELEVENLABS_AGENT_ID_MARK_MY_WORDS')].filter(Boolean),
};

export function agentsForProject(project: string): string[] {
  return ELEVENLABS_AGENTS[project] ?? [];
}
