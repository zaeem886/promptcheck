// Exact supported origins. Shared by content adapters and extension-owned UI.
export const SITES = Object.freeze([
  { id: 'chatgpt', label: 'ChatGPT', origin: 'https://chatgpt.com', startUrl: 'https://chatgpt.com/' },
  { id: 'claude', label: 'Claude', origin: 'https://claude.ai', startUrl: 'https://claude.ai/new' },
  { id: 'gemini', label: 'Gemini', origin: 'https://gemini.google.com', startUrl: 'https://gemini.google.com/app' }
]);
export function siteById(id) { return SITES.find(site => site.id === id) || null; }
export function siteForOrigin(origin) { return SITES.find(site => site.origin === origin) || null; }
