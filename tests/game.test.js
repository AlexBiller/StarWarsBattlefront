const test = require('node:test');
const assert = require('node:assert');
const G = require('../game.js');

function seeded(seed) {
  return function () { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
}

test('random fleets are always legal: no overlap, nothing off the board', () => {
  for (let i = 0; i < 2000; i++) {
    const fleet = G.randomFleet(seeded(i + 1));
    assert.ok(G.validFleet(fleet));
    const seen = new Set();
    for (const s of fleet) for (const [r, c] of G.shipCells(s.row, s.col, s.length, s.vertical)) {
      assert.ok(G.inBounds(r, c));
      assert.ok(!seen.has(G.key(r, c)));
      seen.add(G.key(r, c));
    }
    assert.strictEqual(seen.size, 17);
  }
});

test('canPlace rejects overlap and overhang', () => {
  const ships = [{ id: 'carrier', length: 5, row: 0, col: 0, vertical: false }];
  assert.ok(!G.canPlace(ships, { id: 'destroyer', length: 2, row: 0, col: 4, vertical: true }));
  assert.ok(!G.canPlace(ships, { id: 'destroyer', length: 2, row: 9, col: 9, vertical: false }));
  assert.ok(!G.canPlace(ships, { id: 'destroyer', length: 2, row: 9, col: 0, vertical: true }));
  assert.ok(G.canPlace(ships, { id: 'destroyer', length: 2, row: 1, col: 0, vertical: false }));
  // moving a ship onto its own old position is fine
  assert.ok(G.canPlace(ships, { id: 'carrier', length: 5, row: 0, col: 1, vertical: false }));
});

test('fire reports hit, miss, repeat, sunk and game over', () => {
  const b = G.newBoard([
    { id: 'carrier', length: 5, row: 0, col: 0, vertical: false },
    { id: 'battleship', length: 4, row: 2, col: 0, vertical: false },
    { id: 'cruiser', length: 3, row: 4, col: 0, vertical: false },
    { id: 'submarine', length: 3, row: 6, col: 0, vertical: false },
    { id: 'destroyer', length: 2, row: 8, col: 0, vertical: false }
  ]);
  assert.strictEqual(G.fire(b, 9, 9).result, 'miss');
  assert.strictEqual(G.fire(b, 9, 9).result, 'repeat');
  assert.strictEqual(G.fire(b, -1, 0).result, 'invalid');
  assert.strictEqual(G.fire(b, 8, 0).result, 'hit');
  const sunk = G.fire(b, 8, 1);
  assert.strictEqual(sunk.sunk.id, 'destroyer');
  assert.ok(!sunk.gameOver);
  let last;
  for (const s of b.ships) for (const [r, c] of G.shipCells(s.row, s.col, s.length, s.vertical)) {
    const o = G.fire(b, r, c);
    if (o.result !== 'repeat') last = o;
  }
  assert.ok(last.gameOver);
});

function playAI(seed) {
  const rng = seeded(seed);
  const board = G.newBoard(G.randomFleet(rng));
  const ai = G.newAI();
  const fired = new Set();
  let shots = 0;
  let hitPending = false, sinceHitShots = [];
  while (!G.allSunk(board)) {
    const modeBefore = G.aiMode(ai);
    const [r, c] = G.aiChooseShot(ai, rng);
    const k = G.key(r, c);
    assert.ok(!fired.has(k), 'AI fired at the same cell twice');
    fired.add(k);
    if (modeBefore === 'target') {
      // In target mode every shot must be orthogonally adjacent to an unresolved hit.
      assert.ok(ai.openHits.some(([hr, hc]) => {
        // adjacent, or in line extending a run of hits
        return (hr === r && Math.abs(hc - c) <= 5) || (hc === c && Math.abs(hr - r) <= 5);
      }));
    }
    const out = G.fire(board, r, c);
    G.aiRecord(ai, r, c, out);
    shots++;
    assert.ok(shots <= 100);
  }
  assert.strictEqual(ai.openHits.length, 0, 'all hits resolved after every ship sinks');
  return shots;
}

test('AI never repeats a cell and always finishes the game', () => {
  let total = 0;
  for (let i = 1; i <= 500; i++) total += playAI(i);
  const avg = total / 500;
  // Pure random fire averages ~96 shots; hunt/target should be far better.
  assert.ok(avg < 70, 'average shots ' + avg);
  console.log('  average AI shots to win:', avg.toFixed(1));
});

test('after a hit the AI targets an adjacent cell, then follows the line', () => {
  const ai = G.newAI();
  const ship = { id: 'battleship', length: 4, row: 5, col: 3, vertical: false };
  const b = G.newBoard([ship]);
  G.aiRecord(ai, 5, 4, G.fire(b, 5, 4));
  assert.strictEqual(G.aiMode(ai), 'target');
  const [r1, c1] = G.aiChooseShot(ai, () => 0);
  assert.strictEqual(Math.abs(r1 - 5) + Math.abs(c1 - 4), 1);
  G.aiRecord(ai, 5, 5, G.fire(b, 5, 5));
  for (let i = 0; i < 20; i++) {
    const [r, c] = G.aiChooseShot(ai, Math.random);
    assert.strictEqual(r, 5);
    assert.ok(c === 3 || c === 6);
  }
});

test('AI returns to hunt mode after sinking', () => {
  const ai = G.newAI();
  const b = G.newBoard([{ id: 'destroyer', length: 2, row: 0, col: 0, vertical: false }]);
  G.aiRecord(ai, 0, 0, G.fire(b, 0, 0));
  G.aiRecord(ai, 0, 1, G.fire(b, 0, 1));
  assert.strictEqual(G.aiMode(ai), 'hunt');
});
