import path from 'path';
import {fileURLToPath} from 'url';
import {readFileSync} from 'fs';
import { intentKeywordsDataSchema } from '../src/assistant/schemas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const f = path.join(rootDir, 'src/assistant/data-makan/intent-keywords.json');
console.log('Reading:', f);
const raw = readFileSync(f, 'utf-8');
const parsed = JSON.parse(raw);
const data = intentKeywordsDataSchema.parse(parsed);
const dirs = data.intents.find(e => e.intent === 'directions');
console.log('ms:', dirs?.keywords?.ms);
console.log('zh:', dirs?.keywords?.zh);
console.log('Total intents:', data.intents.length);
