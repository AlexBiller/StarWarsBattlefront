/* Core Battleship rules + AI. No DOM access, so it runs in the browser and in Node tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BattleshipCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SIZE = 10;

  // Classic fleet sizes, re-skinned per faction.
  var FLEET = [
    { id: 'carrier', length: 5 },
    { id: 'battleship', length: 4 },
    { id: 'cruiser', length: 3 },
    { id: 'submarine', length: 3 },
    { id: 'destroyer', length: 2 }
  ];

  var SHIP_NAMES = {
    rebel: {
      carrier: 'Mon Calamari Star Cruiser',
      battleship: 'Nebulon-B Frigate',
      cruiser: 'CR90 Corellian Corvette',
      submarine: 'Millennium Falcon',
      destroyer: 'X-wing Starfighter'
    },
    empire: {
      carrier: 'Imperial Star Destroyer',
      battleship: 'Victory-class Star Destroyer',
      cruiser: 'Gozanti-class Cruiser',
      submarine: 'Lambda-class Shuttle',
      destroyer: 'TIE Fighter'
    }
  };

  function key(r, c) { return r * SIZE + c; }
  function inBounds(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }

  function shipCells(row, col, length, vertical) {
    var cells = [];
    for (var i = 0; i < length; i++) {
      cells.push(vertical ? [row + i, col] : [row, col + i]);
    }
    return cells;
  }

  // ships: [{id, length, row, col, vertical}] -- returns true if `candidate` fits without overlap or overhang.
  function canPlace(ships, candidate) {
    var cells = shipCells(candidate.row, candidate.col, candidate.length, candidate.vertical);
    var occupied = {};
    ships.forEach(function (s) {
      if (s.id === candidate.id || s.row == null) return;
      shipCells(s.row, s.col, s.length, s.vertical).forEach(function (p) { occupied[key(p[0], p[1])] = true; });
    });
    return cells.every(function (p) { return inBounds(p[0], p[1]) && !occupied[key(p[0], p[1])]; });
  }

  function randomFleet(rng) {
    rng = rng || Math.random;
    var ships = [];
    FLEET.forEach(function (def) {
      for (var attempt = 0; attempt < 1000; attempt++) {
        var cand = {
          id: def.id, length: def.length,
          vertical: rng() < 0.5,
          row: Math.floor(rng() * SIZE), col: Math.floor(rng() * SIZE)
        };
        if (canPlace(ships, cand)) { ships.push(cand); return; }
      }
      throw new Error('Could not place ' + def.id);
    });
    return ships;
  }

  function validFleet(ships) {
    if (!Array.isArray(ships) || ships.length !== FLEET.length) return false;
    var placed = [];
    for (var i = 0; i < FLEET.length; i++) {
      var s = ships.filter(function (x) { return x.id === FLEET[i].id; })[0];
      if (!s || s.length !== FLEET[i].length || s.row == null || !canPlace(placed, s)) return false;
      placed.push(s);
    }
    return true;
  }

  function newBoard(ships) {
    return { ships: ships.map(function (s) { return Object.assign({}, s); }), shots: {} };
  }

  function shipAt(board, r, c) {
    for (var i = 0; i < board.ships.length; i++) {
      var s = board.ships[i];
      var cells = shipCells(s.row, s.col, s.length, s.vertical);
      for (var j = 0; j < cells.length; j++) if (cells[j][0] === r && cells[j][1] === c) return s;
    }
    return null;
  }

  function isSunk(board, ship) {
    return shipCells(ship.row, ship.col, ship.length, ship.vertical)
      .every(function (p) { return board.shots[key(p[0], p[1])] === 'hit'; });
  }

  function allSunk(board) {
    return board.ships.every(function (s) { return isSunk(board, s); });
  }

  // Returns {result: 'invalid'|'repeat'|'miss'|'hit', sunk: ship|null, gameOver: bool}
  function fire(board, r, c) {
    if (!inBounds(r, c)) return { result: 'invalid', sunk: null, gameOver: false };
    var k = key(r, c);
    if (board.shots[k]) return { result: 'repeat', sunk: null, gameOver: false };
    var ship = shipAt(board, r, c);
    board.shots[k] = ship ? 'hit' : 'miss';
    var sunk = ship && isSunk(board, ship) ? ship : null;
    return { result: board.shots[k], sunk: sunk, gameOver: !!sunk && allSunk(board) };
  }

  /* ---------- AI: hunt / target ----------
   * Memory: `tried` (every cell fired at) and `openHits` (hits not yet attributed to a sunk ship).
   * Hunt: no open hits -> pick a uniformly random untried cell.
   * Target: open hits exist -> if two or more open hits share a row/column and are contiguous,
   *   extend that line from either end; otherwise try the orthogonal neighbours of open hits.
   * When a ship sinks, its cells are removed from openHits; leftover hits (adjacent ships) keep it targeting.
   */
  function newAI() { return { tried: {}, openHits: [] }; }

  var DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  function untried(ai, r, c) { return inBounds(r, c) && !ai.tried[key(r, c)]; }

  function pick(list, rng) { return list[Math.floor((rng || Math.random)() * list.length)]; }

  function lineTargets(ai) {
    var hits = ai.openHits;
    var targets = [];
    for (var i = 0; i < hits.length; i++) {
      for (var j = i + 1; j < hits.length; j++) {
        var a = hits[i], b = hits[j];
        var vertical;
        if (a[0] === b[0] && Math.abs(a[1] - b[1]) === 1) vertical = false;
        else if (a[1] === b[1] && Math.abs(a[0] - b[0]) === 1) vertical = true;
        else continue;
        // Walk outward from this adjacent pair along the line until we reach a non-hit cell.
        var dr = vertical ? 1 : 0, dc = vertical ? 0 : 1;
        var isHit = function (r, c) { return hits.some(function (h) { return h[0] === r && h[1] === c; }); };
        var r = a[0], c = a[1];
        while (isHit(r - dr, c - dc)) { r -= dr; c -= dc; }
        if (untried(ai, r - dr, c - dc)) targets.push([r - dr, c - dc]);
        r = a[0]; c = a[1];
        while (isHit(r + dr, c + dc)) { r += dr; c += dc; }
        if (untried(ai, r + dr, c + dc)) targets.push([r + dr, c + dc]);
      }
    }
    return targets;
  }

  function neighbourTargets(ai) {
    var targets = [];
    ai.openHits.forEach(function (h) {
      DIRS.forEach(function (d) {
        var r = h[0] + d[0], c = h[1] + d[1];
        if (untried(ai, r, c) && !targets.some(function (t) { return t[0] === r && t[1] === c; })) targets.push([r, c]);
      });
    });
    return targets;
  }

  function aiMode(ai) { return ai.openHits.length ? 'target' : 'hunt'; }

  function aiChooseShot(ai, rng) {
    if (ai.openHits.length) {
      var line = lineTargets(ai);
      if (line.length) return pick(line, rng);
      var near = neighbourTargets(ai);
      if (near.length) return pick(near, rng);
    }
    var open = [];
    for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) if (!ai.tried[key(r, c)]) open.push([r, c]);
    if (!open.length) return null;
    return pick(open, rng);
  }

  function aiRecord(ai, r, c, outcome) {
    ai.tried[key(r, c)] = true;
    if (outcome.result === 'hit') ai.openHits.push([r, c]);
    if (outcome.sunk) {
      var s = outcome.sunk;
      var cells = shipCells(s.row, s.col, s.length, s.vertical);
      ai.openHits = ai.openHits.filter(function (h) {
        return !cells.some(function (p) { return p[0] === h[0] && p[1] === h[1]; });
      });
    }
  }

  return {
    SIZE: SIZE, FLEET: FLEET, SHIP_NAMES: SHIP_NAMES,
    key: key, inBounds: inBounds, shipCells: shipCells, canPlace: canPlace,
    randomFleet: randomFleet, validFleet: validFleet,
    newBoard: newBoard, shipAt: shipAt, isSunk: isSunk, allSunk: allSunk, fire: fire,
    newAI: newAI, aiMode: aiMode, aiChooseShot: aiChooseShot, aiRecord: aiRecord
  };
});
