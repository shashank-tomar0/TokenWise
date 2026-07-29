import { readFileSync, writeFileSync } from 'fs';
const path = 'src/parser/index.ts';
let t = readFileSync(path, 'utf8');
// Direct byte-level replace: \s*<[^>]*>? -> (?:<[^>]*>)?
t = t.split('\\s*<[^>]*>?').join('(?:<[^>]*>)?');
// Also handle \s*<[^>]*>\s*\( patterns in methodDef
t = t.split('\\s*<[^>]*>').join('(?:<[^>]*>)?');
writeFileSync(path, t);
console.log('Done - fixed all generic patterns');
