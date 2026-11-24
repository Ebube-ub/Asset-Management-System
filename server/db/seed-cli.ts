import { initDb } from './index.js';
import { seedIfEmpty } from './seed.js';

await initDb();
await seedIfEmpty();
console.log('Seed check complete.');
process.exit(0);
