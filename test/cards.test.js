import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CardIndex, extensionOf, normalizeName } from '../src/cards.js';

const cards = [
  { name: 'PEPEBRAIN', file: '/c/PEPEBRAIN.png' },
  { name: 'pepetrash', file: '/c/PEPETRASH.gif' },
  { name: 'RAREPEPE', file: '/c/RAREPEPE.jpg' },
  { name: 'LOOTDOGE', file: '/c/LOOTDOGE.png' },
  { name: 'SECRET', file: '/c/SECRET.png' },
];

test('normalizeName upper-cases and keeps only the first word', () => {
  assert.equal(normalizeName('  pepebrain  extra words '), 'PEPEBRAIN');
  assert.equal(normalizeName(''), '');
  assert.equal(normalizeName(null), '');
});

test('extensionOf handles paths, urls, and query strings', () => {
  assert.equal(extensionOf('/c/PEPETRASH.GIF'), 'gif');
  assert.equal(extensionOf('https://x/y/z.png?cache=1'), 'png');
  assert.equal(extensionOf('/no/extension'), '');
  assert.equal(extensionOf('/dotted.dir/file'), '');
});

test('index is case-insensitive and honours exclusions', () => {
  const index = new CardIndex(cards, { exclude: ['secret'] });
  assert.equal(index.size, 4);
  assert.ok(index.has('pepetrash'));
  assert.equal(index.get('PEPETRASH').name, 'PEPETRASH');
  assert.equal(index.get('SECRET'), null);
});

test('resolve: empty text returns a random card', () => {
  const index = new CardIndex(cards);
  const { card, random } = index.resolve('');
  assert.ok(card);
  assert.equal(random, true);
});

test('resolve: exact match wins even when other names contain it', () => {
  const index = new CardIndex([...cards, { name: 'PEPE', file: '/c/PEPE.png' }]);
  const { card, random, suggestions } = index.resolve('pepe');
  assert.equal(card.name, 'PEPE');
  assert.equal(random, false);
  assert.deepEqual(suggestions, []);
});

test('resolve: a single partial match is accepted', () => {
  const index = new CardIndex(cards);
  const { card } = index.resolve('LOOT');
  assert.equal(card.name, 'LOOTDOGE');
});

test('resolve: several partial matches produce suggestions, alphabetical', () => {
  const index = new CardIndex(cards);
  const { card, suggestions } = index.resolve('PEPE');
  assert.equal(card, null);
  assert.deepEqual(suggestions, ['PEPEBRAIN', 'PEPETRASH', 'RAREPEPE']);
});

test('resolve: suggestions are capped by limit', () => {
  const index = new CardIndex(cards);
  const { suggestions } = index.resolve('PEPE', 2);
  assert.equal(suggestions.length, 2);
});

test('resolve: no match and no suggestions', () => {
  const index = new CardIndex(cards);
  const { card, suggestions } = index.resolve('ZZZ');
  assert.equal(card, null);
  assert.deepEqual(suggestions, []);
});

test('random never returns an excluded card', () => {
  const index = new CardIndex(cards, { exclude: ['PEPEBRAIN', 'PEPETRASH', 'RAREPEPE', 'SECRET'] });
  for (let i = 0; i < 20; i++) assert.equal(index.random().name, 'LOOTDOGE');
});
