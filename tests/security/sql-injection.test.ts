/**
 * BUG: SQL injection via un-parameterized LIMIT/OFFSET and ORDER BY
 *
 * FOUND:
 *   src/server/routes/marketplace.ts lines 73-74
 *     ORDER BY ${orderBy}        ← orderBy built from raw user input without whitelist
 *     LIMIT ${limit} OFFSET ${offset}  ← values interpolated directly into SQL
 *
 *   src/db/queries.ts lines 675-676
 *     LIMIT ${limit} OFFSET ${offset}  ← same pattern in audit log query
 *
 * FIX:
 *  - Build orderBy from a strict whitelist map.
 *  - Push limit/offset into the params array and reference via $N placeholder.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const marketplaceSource = readFileSync(
  join(__dirname, '../../src/server/routes/marketplace.ts'),
  'utf8'
);
const queriesSource = readFileSync(
  join(__dirname, '../../src/db/queries.ts'),
  'utf8'
);

describe('SQL injection prevention — marketplace ORDER BY whitelist', () => {
  it('does not interpolate the raw sort param directly into ORDER BY', () => {
    // Before the fix: ORDER BY ${orderBy} where orderBy = user-controlled `sort` value
    // After the fix: orderBy is derived from a safe whitelist map
    expect(marketplaceSource).not.toMatch(/ORDER BY \$\{sort\}/);
  });

  it('uses a whitelist map for allowed ORDER BY values', () => {
    // Should have a map object or if/else mapping sort values to safe SQL fragments
    expect(marketplaceSource).toMatch(/ORDER_BY_MAP|recent.*last_crawled|stars.*star_count/is);
  });
});

describe('SQL injection prevention — LIMIT/OFFSET parameterization', () => {
  it('marketplace does NOT use ${limit} template interpolation', () => {
    expect(marketplaceSource).not.toMatch(/LIMIT\s+\$\{limit\}/);
  });

  it('marketplace does NOT use ${offset} template interpolation', () => {
    expect(marketplaceSource).not.toMatch(/OFFSET\s+\$\{offset\}/);
  });

  it('marketplace passes limit and offset through params array', () => {
    // After the fix, limit and offset are pushed to the params array
    expect(marketplaceSource).toMatch(/params\.push\(limit\)/);
    expect(marketplaceSource).toMatch(/params\.push\(offset\)/);
  });

  it('marketplace uses $$ template syntax for parameterized LIMIT/OFFSET placeholder', () => {
    // The fix uses $${limitIdx} and $${offsetIdx} in the template literal
    expect(marketplaceSource).toMatch(/LIMIT\s+\$\$\{limitIdx\}/);
    expect(marketplaceSource).toMatch(/OFFSET\s+\$\$\{offsetIdx\}/);
  });

  it('audit log does NOT use ${limit} template interpolation', () => {
    expect(queriesSource).not.toMatch(/LIMIT\s+\$\{limit\}/);
  });

  it('audit log does NOT use ${offset} template interpolation', () => {
    expect(queriesSource).not.toMatch(/OFFSET\s+\$\{offset\}/);
  });

  it('audit log passes limit and offset through params array', () => {
    expect(queriesSource).toMatch(/params\.push\(limit\)/);
    expect(queriesSource).toMatch(/params\.push\(offset\)/);
  });
});
