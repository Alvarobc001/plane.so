// Siembra del espacio de ejemplo "Acme" (solo local): npx playwright test -c seed.config.mjs
import base from './playwright.config.mjs';

export default { ...base, testDir: './seed', timeout: 600_000, reporter: 'list', use: { ...base.use, actionTimeout: 20_000 } };
