'use strict';

/**
 * Category Knowledge Tests
 *
 * Validates all 5 knowledge files for structural completeness,
 * voice property correctness, and compose hook functionality.
 */

const { getKnowledge, allSlugs } = require('../src/knowledge/index');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        → ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

console.log('\nCategory Knowledge Tests\n');

const EXPECTED_SLUGS = ['restaurants', 'dentists', 'salons', 'gyms', 'pharmacies'];

// ── Registry ───────────────────────────────────────────────────────────────

test('allSlugs() returns all 5 categories', () => {
  const slugs = allSlugs();
  assertEqual(slugs.length, 5, `Expected 5 slugs, got ${slugs.length}`);
  for (const s of EXPECTED_SLUGS) {
    assert(slugs.includes(s), `Missing slug: ${s}`);
  }
});

test('unknown slug returns safe default (no crash)', () => {
  const k = getKnowledge('unknown_category_xyz');
  assert(k !== null, 'Should return default object');
  assert(k.voice !== undefined, 'Default should have voice');
  assert(k.triggers !== undefined, 'Default should have triggers');
  assert(Array.isArray(k.offerCatalog), 'Default should have offerCatalog array');
});

test('null slug returns safe default (no crash)', () => {
  const k = getKnowledge(null);
  assert(k !== null, 'Should not crash on null');
});

test('getKnowledge returns cached instance on second call', () => {
  const k1 = getKnowledge('restaurants');
  const k2 = getKnowledge('restaurants');
  assert(k1 === k2, 'Should return the same cached instance');
});

// ── Per-category structural checks ─────────────────────────────────────────

for (const slug of EXPECTED_SLUGS) {
  const k = getKnowledge(slug);

  test(`[${slug}] has correct slug property`, () => {
    assertEqual(k.slug, slug, `slug property should equal "${slug}"`);
  });

  test(`[${slug}] has voice with tone`, () => {
    assert(k.voice, 'Missing voice');
    assert(typeof k.voice.tone === 'string', 'voice.tone should be a string');
  });

  test(`[${slug}] has taboos array`, () => {
    assert(Array.isArray(k.voice.taboos), 'voice.taboos should be an array');
    assert(k.voice.taboos.length > 0, `${slug} should have at least 1 taboo`);
  });

  test(`[${slug}] has peerStats with avgCtr`, () => {
    assert(k.peerStats, 'Missing peerStats');
    assert(typeof k.peerStats.avgCtr === 'number', 'peerStats.avgCtr should be a number');
    assert(k.peerStats.avgCtr > 0 && k.peerStats.avgCtr < 1, 'avgCtr should be between 0 and 1');
  });

  test(`[${slug}] has non-empty offerCatalog`, () => {
    assert(Array.isArray(k.offerCatalog), 'offerCatalog should be an array');
    assert(k.offerCatalog.length > 0, `${slug} should have at least 1 offer template`);
  });

  test(`[${slug}] has seasonalBeats array`, () => {
    assert(Array.isArray(k.seasonalBeats), 'seasonalBeats should be an array');
    assert(k.seasonalBeats.length > 0, `${slug} should have at least 1 seasonal beat`);
  });

  test(`[${slug}] has triggers object`, () => {
    assert(k.triggers, 'Missing triggers');
    assert(typeof k.triggers === 'object', 'triggers should be an object');
  });

  test(`[${slug}] has festival trigger for diwali`, () => {
    assert(k.triggers.festival, 'Missing festival trigger');
    assert(typeof k.triggers.festival.diwali === 'string', 'festival.diwali should be a string');
    assert(k.triggers.festival.diwali.length > 10, 'diwali hook should be meaningful');
  });

  test(`[${slug}] has customerWinback trigger`, () => {
    assert(k.triggers.customerWinback, 'Missing customerWinback trigger');
    assert(typeof k.triggers.customerWinback.hook === 'string', 'winback hook should be a string');
  });

  test(`[${slug}] has growth trigger`, () => {
    assert(k.triggers.growth, 'Missing growth trigger');
    assert(typeof k.triggers.growth.action === 'string', 'growth.action should be a string');
  });

  test(`[${slug}] has composeHooks.offerExpiry function`, () => {
    assert(k.composeHooks, 'Missing composeHooks');
    assert(typeof k.composeHooks.offerExpiry === 'function', 'offerExpiry should be a function');
    const msg = k.composeHooks.offerExpiry('Test Offer', 2, null);
    assert(typeof msg === 'string', 'offerExpiry should return a string');
    assert(msg.includes('Test Offer'), 'offerExpiry should include offer title');
    assert(msg.includes('2 day'), 'offerExpiry should include days');
  });

  test(`[${slug}] has composeHooks.ctrGap function`, () => {
    assert(typeof k.composeHooks.ctrGap === 'function', 'ctrGap should be a function');
    const msg = k.composeHooks.ctrGap('1.2%', '3.0%');
    assert(typeof msg === 'string', 'ctrGap should return a string');
    assert(msg.includes('1.2%'), 'ctrGap should include merchant CTR');
    assert(msg.includes('3.0%'), 'ctrGap should include peer CTR');
  });

  test(`[${slug}] has composeHooks.noOffer function`, () => {
    assert(typeof k.composeHooks.noOffer === 'function', 'noOffer should be a function');
    const msg = k.composeHooks.noOffer();
    assert(typeof msg === 'string', 'noOffer should return a string');
    assert(msg.length > 20, 'noOffer message should be meaningful');
  });
}

// ── Category-specific voice checks ─────────────────────────────────────────

test('[dentists] voice.contractionExpansion is true', () => {
  const k = getKnowledge('dentists');
  assert(k.voice.contractionExpansion === true, 'Dentists should expand contractions');
});

test('[pharmacies] voice.contractionExpansion is true', () => {
  const k = getKnowledge('pharmacies');
  assert(k.voice.contractionExpansion === true, 'Pharmacies should expand contractions');
});

test('[restaurants] voice.hindiEnglishMix is true', () => {
  const k = getKnowledge('restaurants');
  assert(k.voice.hindiEnglishMix === true, 'Restaurants should support Hindi-English mix');
});

test('[salons] voice.hindiEnglishMix is true', () => {
  const k = getKnowledge('salons');
  assert(k.voice.hindiEnglishMix === true, 'Salons should support Hindi-English mix');
});

test('[gyms] voice.hindiEnglishMix is true', () => {
  const k = getKnowledge('gyms');
  assert(k.voice.hindiEnglishMix === true, 'Gyms should support Hindi-English mix');
});

test('[dentists] taboos include "cure"', () => {
  const k = getKnowledge('dentists');
  assert(k.voice.taboos.includes('cure'), 'Dentists must ban "cure"');
});

test('[pharmacies] taboos include "miracle"', () => {
  const k = getKnowledge('pharmacies');
  assert(k.voice.taboos.includes('miracle'), 'Pharmacies must ban "miracle"');
});

test('[gyms] taboos include "guaranteed results"', () => {
  const k = getKnowledge('gyms');
  assert(k.voice.taboos.includes('guaranteed results'), 'Gyms must ban "guaranteed results"');
});

test('[dentists] has digestSources array', () => {
  const k = getKnowledge('dentists');
  assert(Array.isArray(k.digestSources), 'Dentists should have digestSources');
  assert(k.digestSources.some((s) => s.includes('JIDA')), 'Should include JIDA');
});

test('[gyms] has renewalRate in peerStats', () => {
  const k = getKnowledge('gyms');
  assert(typeof k.peerStats.renewalRate === 'number', 'Gyms should have renewalRate');
});

// ── Results ────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed === 0) console.log('All knowledge tests passed.\n');
else { console.log('Some tests FAILED.\n'); process.exit(1); }
