// Screens, components and app state talk to the backend only through the Backend interface (services/api.ts):
// none of them may import the demo backend, so the live backend can replace it without touching the UI.
/* global describe, it, expect, __dirname */
const { readdirSync, readFileSync, statSync } = require('fs');
const { join } = require('path');

function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

describe('architecture', () => {
  it('no screen, component or state module imports services/mock', () => {
    const src = join(__dirname, '..');
    const offenders = ['app', 'ui', 'state', 'illustrations']
      .flatMap((d) => files(join(src, d)))
      .filter((f) => /from '[./]*services\/mock\//.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(src.length + 1));
    expect(offenders).toEqual([]);
  });

  it('only services/createBackend.ts builds the demo backend', () => {
    const src = join(__dirname, '..');
    const builders = files(src)
      .filter((f) => !f.includes('__tests__') && !f.includes(join('services', 'mock')))
      .filter((f) => /createMockBackend\(/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(src.length + 1).replace(/\\/g, '/'));
    expect(builders).toEqual(['services/createBackend.ts']);
  });
});
