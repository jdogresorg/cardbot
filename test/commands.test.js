import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCommandMatcher, fillTemplate, helpText, notFoundText } from '../src/commands.js';

test('matcher accepts bare, upper-case, mentioned, and argument forms', () => {
  const match = buildCommandMatcher(['p'], 'PepeCardBot');
  assert.deepEqual(match('/p'), { command: 'p', argument: '' });
  assert.deepEqual(match('/P'), { command: 'p', argument: '' });
  assert.deepEqual(match('/p@PepeCardBot'), { command: 'p', argument: '' });
  assert.deepEqual(match('/p PEPEBRAIN'), { command: 'p', argument: 'PEPEBRAIN' });
  assert.deepEqual(match('/p@PepeCardBot pepebrain and more'), { command: 'p', argument: 'pepebrain' });
  assert.deepEqual(match('  /p   PEPEBRAIN  '), { command: 'p', argument: 'PEPEBRAIN' });
});

test('matcher rejects other commands, other bots, and prefixes', () => {
  const match = buildCommandMatcher(['p'], 'PepeCardBot');
  assert.equal(match('/pepe'), null);
  assert.equal(match('/p@OtherBot'), null);
  assert.equal(match('/help'), null);
  assert.equal(match('p PEPEBRAIN'), null);
  assert.equal(match(''), null);
});

test('matcher supports aliases', () => {
  const match = buildCommandMatcher(['d', 'doge'], 'RareDogeBot');
  assert.equal(match('/doge LOOTDOGE').command, 'doge');
  assert.equal(match('/D').command, 'd');
  assert.equal(match('/dog'), null);
});

test('helpText defaults mention primary command and aliases', () => {
  const text = helpText({ commands: ['d', 'doge'] });
  assert.match(text, /\/d \[CARD\]/);
  assert.match(text, /\/doge/);
  assert.equal(helpText({ commands: ['p'], help: 'custom' }), 'custom');
});

test('fillTemplate substitutes card fields and blanks unknown ones', () => {
  const card = { name: 'LOOTDOGE', series: '3' };
  assert.equal(fillTemplate('https://x/card/{name} s{series} {missing}', card), 'https://x/card/LOOTDOGE s3 ');
});

test('notFoundText lists suggestions', () => {
  assert.equal(notFoundText([]), 'Card not found.');
  assert.equal(notFoundText(['A', 'B']), 'Card not found. Did you mean A or B?');
});
