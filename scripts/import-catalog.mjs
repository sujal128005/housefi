// Imports the catalog from the app's src/data/catalog.ts (copied to docs/app-contract/catalog.ts) into
// src/modules/catalog/catalog.data.json, which the seed command loads into the database.
// Usage: npm run catalog:import [path/to/catalog.ts]
//
// The TypeScript file is transpiled and evaluated in an isolated VM context with no `require`, `process` or
// network access: it may only define data. Only CATEGORIES and SERVICES are taken from it.
import { readFileSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = process.argv[2] ?? 'docs/app-contract/catalog.ts';
const out = 'src/modules/catalog/catalog.data.json';

const { outputText } = ts.transpileModule(readFileSync(source, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});

const sandbox = {
  exports: {},
  // Only type imports exist in the app file; anything else is refused.
  require: (name) => {
    throw new Error(`catalog.ts may not import modules at runtime (tried "${name}")`);
  },
};
sandbox.module = { exports: sandbox.exports };
runInNewContext(outputText, sandbox, { timeout: 1000, filename: source });
const { CATEGORIES, SERVICES } = sandbox.module.exports;
if (!Array.isArray(CATEGORIES) || !Array.isArray(SERVICES)) throw new Error(`${source} must export CATEGORIES and SERVICES arrays`);

// Plain JSON copies, keeping only the fields the backend serves (in the app's order).
const loc = (l) => ({ en: l.en, te: l.te });
const data = {
  source: 'app src/data/catalog.ts (docs/app-contract/catalog.ts)',
  categories: CATEGORIES.map((c) => ({ id: c.id, name: loc(c.name), tagline: loc(c.tagline), art: c.art, wash: c.wash })),
  services: SERVICES.map((s) => ({
    id: s.id,
    categoryId: s.categoryId,
    name: loc(s.name),
    description: loc(s.description),
    visitFee: s.visitFee,
    repairFrom: s.repairFrom,
    durationMin: [s.durationMin[0], s.durationMin[1]],
    rating: s.rating,
    reviews: s.reviews,
    popular: s.popular === true,
    issues: s.issues.map((i) => ({ id: i.id, name: loc(i.name) })),
    keywords: [...s.keywords],
  })),
};

writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Wrote ${out}: ${data.categories.length} categories, ${data.services.length} services, ${data.services.reduce((n, s) => n + s.issues.length, 0)} issues`);
