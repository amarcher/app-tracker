export const PROJECTS: { value: string; label: string; domain: string; cloudflare?: boolean; hasApiRoutes?: boolean; agents?: boolean; posthog?: boolean; appStore?: boolean; amazonAppstore?: boolean; googlePlay?: boolean }[] = [
  { value: 'animal-penpals', label: 'Animal Pen Pals', domain: 'animalpenpals.tech', cloudflare: true, hasApiRoutes: true, agents: true, posthog: true },
  { value: 'space-explorer', label: 'Space Explorer', domain: 'spaceexplorer.tech', cloudflare: true, agents: true, posthog: true },
  { value: 'space-race', label: 'Space Race', domain: 'game.spaceexplorer.tech', appStore: true, amazonAppstore: true, googlePlay: true },
  { value: 'periodic-table', label: 'Periodic Table', domain: 'periodictable.tech', cloudflare: true, agents: true, posthog: true },
  { value: 'crossword-clash', label: 'Crossword Clash', domain: 'crosswordclash.com', hasApiRoutes: true, agents: true, appStore: true, googlePlay: true },
  { value: 'ticket-for-dinner', label: 'Delivery Picker', domain: 'ticketfordinner.com', hasApiRoutes: true },
  { value: 'superbowl-squares', label: 'Superbowl Squares', domain: 'superbowl-squares.com' },
  { value: 'tabbit-rabbit', label: 'Tabbit Rabbit', domain: 'tabbitrabbit.com', hasApiRoutes: true },
  { value: 'mark-my-words', label: 'Mark My Words', domain: 'archer.biz', hasApiRoutes: true, agents: true },
  { value: 'mtg-dash', label: 'MTG Dash', domain: 'mtg.capxun.com', cloudflare: true },
  { value: 'recipe-guide', label: 'Recipe Guide', domain: 'mised.tech', hasApiRoutes: true },
  { value: 'fable-designer', label: 'Fable Designer', domain: 'fabledesigner.com', appStore: true, amazonAppstore: true },
];

