import assert from 'node:assert/strict';
import { looksLikeUrl } from './favs.js';

for (const q of ['example.com', 'example.com/a?b', 'localhost:3000', 'http://x', 'sub.site.co.uk:8080']) assert(looksLikeUrl(q), q);
for (const q of ['hello world', 'justin', 'me@example.com', 'a@b.com/x', 'ex ample.com']) assert(!looksLikeUrl(q), q);
console.log('favs ok');
