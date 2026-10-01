// Gemini model chain shared by the admin AI endpoint (routes/aiRoutes.js) and the weekly card
// digest (services/llmService.js), so a change of the free-tier models happens in one place.

// All free-tier models. Each has its own daily quota, so the chain multiplies the free requests
// per day; Flash-Lite comes last (weaker, but ~500 requests/day).
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const FALLBACK_GEMINI_MODELS = ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];
