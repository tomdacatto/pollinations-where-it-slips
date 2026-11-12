// What a visitor's key may spend and for how long. Pollen is per visitor.
// All seven programs on the six default models, one step per request, cost about 0.12 Pollen by the page's own estimate.
export const BUDGET = 0.5;
export const EXPIRY_DAYS = 1;

// The app's publishable App Key (pk_...), sent as client_id so the consent screen names the app and usage is
// attributed. Its redirect URI must be this page's address exactly. Empty until the key exists.
export const APP_KEY = "";

// How many requests are in flight at once.
export const CONCURRENCY = 6;

// Models ticked at the start, when the live list has them. All free for every visitor (paid_only is false).
export const DEFAULT_MODELS = [
    "openai/gpt-5.4-nano",
    "deepseek/deepseek-v4.1-flash",
    "z-ai/glm-5.3-flash",
    "meta/llama-3.3-70b-instruct",
    "minimax/minimax-m3.1-flash",
    "x-ai/grok-4.3",
];

// Programs ticked at the start.
export const DEFAULT_PROGRAMS = ["countdown", "sum", "multiply", "fibonacci", "doubling", "memory", "wrap"];
