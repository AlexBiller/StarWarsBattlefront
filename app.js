/* UI layer: placement, turns, persistence, effects. Rules + AI live in game.js. */
(function () {
  'use strict';
  var G = window.BattleshipCore;
  var SIZE = G.SIZE;
  var STORAGE_KEY = 'swb-state-v1';
  var SOUND_KEY = 'swb-sound';
  var AI_DELAY = 750;
  var COLS = 'ABCDEFGHIJ';

  var SHORT = {
    rebel: { carrier: 'Mon Cal', battleship: 'Nebulon-B', cruiser: 'CR90', submarine: 'Falcon', destroyer: 'X-wing' },
    empire: { carrier: 'Star Destroyer', battleship: 'Victory', cruiser: 'Gozanti', submarine: 'Lambda', destroyer: 'TIE' }
  };

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    status: $('status'), playerBoard: $('player-board'), enemyBoard: $('enemy-board'),
    playerFleet: $('player-fleet'), enemyFleet: $('enemy-fleet'),
    placement: $('placement-panel'), enemySide: $('enemy-side'), dock: $('dock'),
    rotateBtn: $('rotate-btn'), randomBtn: $('random-btn'), clearBtn: $('clear-btn'), startBtn: $('start-btn'),
    logWrap: $('log-wrap'), log: $('log'), toast: $('toast'),
    winOverlay: $('win-overlay'), loseOverlay: $('lose-overlay'),
    soundBtn: $('sound-btn'), newGameBtn: $('new-game-btn')
  };

  var S;               // persisted game state
  var aiTimer = null;  // pending AI move
  var lastClick = { k: -1, t: 0 };
  var lastShot = null; // {side, k} for the blast animation
  var justSunk = null; // {side, id}
  var soundOn = localStorage.getItem(SOUND_KEY) !== 'off';

  /* ---------------- state ---------------- */
  function freshState() {
    return {
      version: 1, phase: 'placement',
      placement: G.FLEET.map(function (d) { return { id: d.id, length: d.length, row: null, col: null, vertical: false }; }),
      orientationVertical: false,
      player: null, enemy: null, ai: null,
      turn: 'player', winner: null, log: []
    };
  }

  function validBoard(b) {
    return b && typeof b === 'object' && G.validFleet(b.ships) && b.shots && typeof b.shots === 'object';
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return freshState();
      var s = JSON.parse(raw);
      if (!s || s.version !== 1 || !Array.isArray(s.placement) || s.placement.length !== G.FLEET.length) return freshState();
      if (s.phase === 'placement') {
        // Drop any stored ship that no longer fits (defensive against tampered storage).
        var ok = [];
        s.placement.forEach(function (p) {
          if (p.row != null && !G.canPlace(ok, p)) { p.row = null; p.col = null; }
          if (p.row != null) ok.push(p);
        });
        s.player = s.enemy = s.ai = null;
        return s;
      }
      if (s.phase !== 'playing' && s.phase !== 'over') return freshState();
      if (!validBoard(s.player) || !validBoard(s.enemy) || !s.ai || !s.ai.tried || !Array.isArray(s.ai.openHits)) return freshState();
      if (s.turn !== 'player' && s.turn !== 'ai') s.turn = 'player';
      if (!Array.isArray(s.log)) s.log = [];
      return s;
    } catch (e) {
      return freshState();
    }
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(S)); } catch (e) { /* storage full or disabled: play on without persistence */ }
  }

  function coord(r, c) { return COLS[c] + (r + 1); }
  function rebelName(id) { return G.SHIP_NAMES.rebel[id]; }
  function empireName(id) { return G.SHIP_NAMES.empire[id]; }
  function placementShip(id) { return S.placement.filter(function (s) { return s.id === id; })[0]; }
  function placedShips() { return S.placement.filter(function (s) { return s.row != null; }); }

  /* ---------------- board construction ---------------- */
  function buildLabels() {
    document.querySelectorAll('.labels.cols').forEach(function (el) {
      el.innerHTML = COLS.split('').map(function (l) { return '<span>' + l + '</span>'; }).join('');
    });
    document.querySelectorAll('.labels.rows').forEach(function (el) {
      var h = ''; for (var i = 1; i <= SIZE; i++) h += '<span>' + i + '</span>'; el.innerHTML = h;
    });
  }

  function buildBoard(boardEl, clickable) {
    boardEl.innerHTML = '';
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var cell = document.createElement(clickable ? 'button' : 'div');
        if (clickable) cell.type = 'button';
        cell.className = 'cell';
        cell.dataset.r = r; cell.dataset.c = c;
        cell.style.gridRow = (r + 1); cell.style.gridColumn = (c + 1);
        cell.setAttribute('aria-label', coord(r, c));
        boardEl.appendChild(cell);
      }
    }
  }

  function cellEl(boardEl, r, c) { return boardEl.children[r * SIZE + c]; }

  function shipEl(ship, faction, extra) {
    var el = document.createElement('div');
    el.className = 'ship ' + faction + (ship.vertical ? ' vertical' : '') + (extra ? ' ' + extra : '');
    el.dataset.id = ship.id;
    el.style.gridRow = ship.vertical ? (ship.row + 1) + ' / span ' + ship.length : String(ship.row + 1);
    el.style.gridColumn = ship.vertical ? String(ship.col + 1) : (ship.col + 1) + ' / span ' + ship.length;
    el.textContent = SHORT[faction][ship.id];
    el.title = G.SHIP_NAMES[faction][ship.id];
    return el;
  }

  function clearShips(boardEl) {
    boardEl.querySelectorAll('.ship').forEach(function (n) { n.remove(); });
  }

  /* ---------------- rendering ---------------- */
  function render() {
    var placing = S.phase === 'placement';
    els.placement.classList.toggle('hidden', !placing);
    els.enemySide.classList.toggle('hidden', placing);
    els.logWrap.classList.toggle('hidden', placing);
    renderPlayerBoard();
    if (!placing) renderEnemyBoard();
    renderDock();
    renderFleetStatus();
    renderLog();
    renderStatus();
  }

  function paintShots(boardEl, board, side) {
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var k = G.key(r, c), el = cellEl(boardEl, r, c);
        var shot = board ? board.shots[k] : null;
        el.classList.remove('hit', 'miss', 'shot', 'sunk-cell', 'just-fired', 'preview-ok', 'preview-bad');
        if (shot) el.classList.add(shot, 'shot');
        if (shot === 'hit') {
          var s = G.shipAt(board, r, c);
          if (s && G.isSunk(board, s)) el.classList.add('sunk-cell');
        }
        if (lastShot && lastShot.side === side && lastShot.k === k) el.classList.add('just-fired');
        if (boardEl === els.enemyBoard) {
          el.setAttribute('aria-label', coord(r, c) + (shot ? ' ' + shot : ''));
          el.disabled = false;
        }
      }
    }
  }

  function renderPlayerBoard() {
    var b = els.playerBoard;
    clearShips(b);
    if (S.phase === 'placement') {
      paintShots(b, null, 'player');
      placedShips().forEach(function (s) {
        b.appendChild(shipEl(s, 'rebel', drag && drag.moved && drag.id === s.id ? 'dragging-source' : ''));
      });
    } else {
      paintShots(b, S.player, 'player');
      S.player.ships.forEach(function (s) {
        var sunk = G.isSunk(S.player, s);
        var extra = (sunk ? 'sunk' : '') + (justSunk && justSunk.side === 'player' && justSunk.id === s.id ? ' just-sunk' : '');
        b.appendChild(shipEl(s, 'rebel', extra));
      });
    }
  }

  function renderEnemyBoard() {
    var b = els.enemyBoard;
    clearShips(b);
    paintShots(b, S.enemy, 'enemy');
    S.enemy.ships.forEach(function (s) {
      var sunk = G.isSunk(S.enemy, s);
      if (sunk) {
        b.appendChild(shipEl(s, 'empire', 'sunk' + (justSunk && justSunk.side === 'enemy' && justSunk.id === s.id ? ' just-sunk' : '')));
      } else if (S.phase === 'over') {
        b.appendChild(shipEl(s, 'empire', 'revealed'));
      }
    });
    b.classList.toggle('armed', S.phase === 'playing' && S.turn === 'player');
  }

  function renderDock() {
    if (S.phase !== 'placement') return;
    els.dock.innerHTML = '';
    S.placement.forEach(function (s) {
      var item = document.createElement('div');
      item.className = 'dock-ship' + (s.row != null ? ' placed' : '') + (selectedId === s.id ? ' selected' : '');
      item.dataset.id = s.id;
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      var bar = '';
      for (var i = 0; i < s.length; i++) bar += '<i></i>';
      item.innerHTML = '<span class="bar">' + bar + '</span><span class="meta">' + rebelName(s.id) +
        '<br><small>' + s.length + ' cells' + (s.row != null ? ' &middot; deployed' : '') + '</small></span>';
      els.dock.appendChild(item);
    });
    els.rotateBtn.textContent = 'Orientation: ' + (S.orientationVertical ? 'Vertical' : 'Horizontal');
    els.startBtn.disabled = !G.validFleet(S.placement);
  }

  function renderFleetStatus() {
    function list(el, board, faction) {
      if (!board) { el.innerHTML = ''; return; }
      el.innerHTML = board.ships.map(function (s) {
        var hits = G.shipCells(s.row, s.col, s.length, s.vertical)
          .filter(function (p) { return board.shots[G.key(p[0], p[1])] === 'hit'; }).length;
        var sunk = hits === s.length;
        var pips = faction === 'rebel' ? new Array(s.length - hits + 1).join('\u25A0') + new Array(hits + 1).join('\u25A1')
                                       : (sunk ? 'destroyed' : s.length + ' cells');
        return '<li class="' + (sunk ? 'sunk' : '') + '"><span>' + G.SHIP_NAMES[faction][s.id] + '</span><span class="pips">' + pips + '</span></li>';
      }).join('');
    }
    list(els.playerFleet, S.phase === 'placement' ? null : S.player, 'rebel');
    list(els.enemyFleet, S.phase === 'placement' ? null : S.enemy, 'empire');
  }

  function renderLog() {
    els.log.innerHTML = S.log.slice().reverse().map(function (e) { return '<li class="' + (e.cls || '') + '">' + e.text + '</li>'; }).join('');
  }

  function renderStatus() {
    var st = els.status;
    st.className = 'status';
    if (S.phase === 'placement') {
      var n = placedShips().length;
      st.textContent = n === G.FLEET.length ? 'Fleet ready. Press Start battle!' : 'Deploy your fleet: ' + n + ' of ' + G.FLEET.length + ' ships placed.';
    } else if (S.phase === 'playing') {
      if (S.turn === 'player') { st.textContent = 'Your turn: fire on the Imperial fleet.'; st.classList.add('turn-player'); }
      else {
        st.textContent = G.aiMode(S.ai) === 'target' ? 'The Empire has a target lock and is closing in...' : 'The Empire is scanning for your ships...';
        st.classList.add('turn-ai');
      }
    } else {
      st.textContent = S.winner === 'player' ? 'Victory! The Imperial fleet is destroyed.' : 'Defeat. Your fleet has been destroyed.';
    }
  }

  function addLog(text, cls) {
    S.log.push({ text: text, cls: cls || '' });
    if (S.log.length > 200) S.log.shift();
  }

  var toastTimer = null;
  function toast(msg, big) {
    els.toast.textContent = msg;
    els.toast.classList.toggle('big', !!big);
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.remove('show'); }, big ? 2600 : 1800);
  }

  /* ---------------- placement interaction ---------------- */
  var drag = null;
  var selectedId = null;
  var lastPointer = null;

  function cellFromPoint(boardEl, x, y) {
    var rect = boardEl.getBoundingClientRect();
    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) return null;
    var size = rect.width / SIZE;
    var c = Math.floor((x - rect.left) / size), r = Math.floor((y - rect.top) / size);
    return G.inBounds(r, c) ? { r: r, c: c } : null;
  }

  function startDrag(e, ship, grabIndex, vertical) {
    drag = {
      id: ship.id, length: ship.length, vertical: vertical, grabIndex: grabIndex,
      startX: e.clientX, startY: e.clientY, moved: false, ghost: null, target: null,
      fromBoard: e.currentTarget === els.playerBoard
    };
    lastPointer = { x: e.clientX, y: e.clientY };
  }

  function buildGhost() {
    if (drag.ghost) drag.ghost.remove();
    var g = document.createElement('div');
    g.className = 'drag-ghost';
    g.style.gridTemplateColumns = drag.vertical ? 'auto' : 'repeat(' + drag.length + ', auto)';
    for (var i = 0; i < drag.length; i++) g.appendChild(document.createElement('i'));
    document.body.appendChild(g);
    drag.ghost = g;
  }

  function clearPreview() {
    els.playerBoard.querySelectorAll('.preview-ok, .preview-bad').forEach(function (n) { n.classList.remove('preview-ok', 'preview-bad'); });
  }

  function updateDrag(x, y) {
    var size = els.playerBoard.getBoundingClientRect().width / SIZE;
    var offX = drag.vertical ? 0.5 : drag.grabIndex + 0.5;
    var offY = drag.vertical ? drag.grabIndex + 0.5 : 0.5;
    drag.ghost.style.left = (x - offX * size) + 'px';
    drag.ghost.style.top = (y - offY * size) + 'px';
    clearPreview();
    drag.target = null;
    var cell = cellFromPoint(els.playerBoard, x, y);
    if (!cell) return;
    var cand = {
      id: drag.id, length: drag.length, vertical: drag.vertical,
      row: drag.vertical ? cell.r - drag.grabIndex : cell.r,
      col: drag.vertical ? cell.c : cell.c - drag.grabIndex
    };
    var ok = G.canPlace(S.placement, cand);
    G.shipCells(cand.row, cand.col, cand.length, cand.vertical).forEach(function (p) {
      if (G.inBounds(p[0], p[1])) cellEl(els.playerBoard, p[0], p[1]).classList.add(ok ? 'preview-ok' : 'preview-bad');
    });
    drag.target = ok ? cand : null;
  }

  function onPointerMove(e) {
    if (!drag) return;
    lastPointer = { x: e.clientX, y: e.clientY };
    if (!drag.moved) {
      if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) < 6) return;
      drag.moved = true;
      buildGhost();
      renderPlayerBoard();
    }
    e.preventDefault();
    updateDrag(e.clientX, e.clientY);
  }

  function endDrag(e, cancelled) {
    if (!drag) return;
    var d = drag;
    drag = null;
    if (d.ghost) d.ghost.remove();
    clearPreview();
    var ship = placementShip(d.id);
    if (cancelled) { render(); return; }
    if (d.moved) {
      if (d.target) {
        ship.row = d.target.row; ship.col = d.target.col; ship.vertical = d.target.vertical;
        selectedId = null;
      } else if (els.dock.contains(document.elementFromPoint(e.clientX, e.clientY))) {
        ship.row = ship.col = null; // dragged back to the dock
      } else if (cellFromPoint(els.playerBoard, e.clientX, e.clientY)) {
        toast('That spot is blocked or off the grid.');
      }
    } else if (d.fromBoard) {
      rotateShip(ship);
    } else {
      selectedId = selectedId === d.id ? null : d.id;
    }
    save();
    render();
  }

  function rotateShip(ship) {
    var cand = Object.assign({}, ship, { vertical: !ship.vertical });
    if (G.canPlace(S.placement, cand)) { ship.vertical = cand.vertical; return; }
    // Slide back along the new axis so ships near the edge can still rotate.
    for (var shift = 1; shift < ship.length; shift++) {
      var alt = Object.assign({}, cand);
      if (alt.vertical) alt.row -= shift; else alt.col -= shift;
      if (G.canPlace(S.placement, alt)) { Object.assign(ship, alt); return; }
    }
    toast('No room to rotate the ' + rebelName(ship.id) + ' there.');
  }

  function onPlayerBoardDown(e) {
    if (S.phase !== 'placement' || e.button > 0) {
      if (S.phase === 'playing' && e.button <= 0) toast('Fire at the Imperial grid on the right.');
      return;
    }
    var cell = cellFromPoint(els.playerBoard, e.clientX, e.clientY);
    if (!cell) return;
    var ship = placedShips().filter(function (s) {
      return G.shipCells(s.row, s.col, s.length, s.vertical).some(function (p) { return p[0] === cell.r && p[1] === cell.c; });
    })[0];
    if (ship) {
      e.preventDefault();
      startDrag(e, ship, ship.vertical ? cell.r - ship.row : cell.c - ship.col, ship.vertical);
      return;
    }
    if (selectedId) {
      var sel = placementShip(selectedId);
      var cand = { id: sel.id, length: sel.length, vertical: S.orientationVertical, row: cell.r, col: cell.c };
      if (G.canPlace(S.placement, cand)) {
        Object.assign(sel, cand);
        var next = S.placement.filter(function (s) { return s.row == null; })[0];
        selectedId = next ? next.id : null;
        save(); render();
      } else {
        toast('The ' + rebelName(sel.id) + ' does not fit there.');
      }
    } else if (placedShips().length < G.FLEET.length) {
      toast('Pick a ship from the dock first, or drag one onto the grid.');
    }
  }

  function onDockDown(e) {
    if (S.phase !== 'placement' || e.button > 0) return;
    var item = e.target.closest('.dock-ship');
    if (!item) return;
    e.preventDefault();
    var ship = placementShip(item.dataset.id);
    startDrag(e, ship, 0, S.orientationVertical);
  }

  function toggleOrientation() {
    S.orientationVertical = !S.orientationVertical;
    if (drag) {
      drag.vertical = !drag.vertical;
      drag.grabIndex = 0;
      if (drag.moved) { buildGhost(); updateDrag(lastPointer.x, lastPointer.y); }
    }
    save();
    renderDock();
  }

  /* ---------------- battle ---------------- */
  function startBattle() {
    if (S.phase !== 'placement' || !G.validFleet(S.placement)) { toast('Place all five ships first.'); return; }
    S.player = G.newBoard(S.placement);
    S.enemy = G.newBoard(G.randomFleet());
    S.ai = G.newAI();
    S.turn = 'player';
    S.phase = 'playing';
    S.winner = null;
    S.log = [{ text: 'Battle begins! The Rebel fleet fires first.', cls: '' }];
    selectedId = null;
    save();
    render();
    sfx('start');
  }

  function onEnemyClick(e) {
    var cell = e.target.closest('.cell');
    if (!cell) return;
    playerFire(+cell.dataset.r, +cell.dataset.c);
  }

  function playerFire(r, c) {
    if (S.phase === 'placement') { toast('Deploy your fleet and press Start battle first.'); return; }
    if (S.phase === 'over') { toast('The battle is over. Press Play again.'); return; }
    if (S.turn !== 'player') { toast('Hold your fire: the Empire is taking its shot.'); return; }
    var k = G.key(r, c), now = Date.now();
    if (S.enemy.shots[k]) {
      // A double-click's second click lands on the cell we just fired at; ignore it quietly.
      if (!(lastClick.k === k && now - lastClick.t < 700)) toast('You already fired at ' + coord(r, c) + '.');
      return;
    }
    lastClick = { k: k, t: now };
    var out = G.fire(S.enemy, r, c);
    lastShot = { side: 'enemy', k: k };
    justSunk = null;
    addLog('You fire at ' + coord(r, c) + ': ' + (out.result === 'hit' ? 'HIT!' : 'miss.'));
    sfx(out.result);
    if (out.sunk) {
      justSunk = { side: 'enemy', id: out.sunk.id };
      addLog('You destroyed the ' + empireName(out.sunk.id) + '!', 'sink');
      toast('You destroyed the ' + empireName(out.sunk.id) + '!', true);
    }
    if (out.gameOver) { endGame('player'); return; }
    S.turn = 'ai';
    save();
    render();
    scheduleAI();
  }

  function scheduleAI() {
    if (aiTimer || S.phase !== 'playing' || S.turn !== 'ai') return;
    aiTimer = setTimeout(aiMove, AI_DELAY);
  }

  function aiMove() {
    aiTimer = null;
    if (S.phase !== 'playing' || S.turn !== 'ai') return;
    var shot = G.aiChooseShot(S.ai);
    if (!shot) { S.turn = 'player'; save(); render(); return; }
    var r = shot[0], c = shot[1];
    var out = G.fire(S.player, r, c);
    G.aiRecord(S.ai, r, c, out);
    lastShot = { side: 'player', k: G.key(r, c) };
    justSunk = null;
    addLog('The Empire fires at ' + coord(r, c) + ': ' + (out.result === 'hit' ? 'HIT!' : 'miss.'), 'ai');
    sfx(out.result);
    if (out.sunk) {
      justSunk = { side: 'player', id: out.sunk.id };
      addLog('The Empire destroyed your ' + rebelName(out.sunk.id) + '!', 'sink');
      toast('The Empire destroyed your ' + rebelName(out.sunk.id) + '!', true);
    }
    if (out.gameOver) { endGame('ai'); return; }
    S.turn = 'player';
    save();
    render();
  }

  function endGame(winner) {
    S.phase = 'over';
    S.winner = winner;
    addLog(winner === 'player' ? 'Victory! The Imperial fleet is no more.' : 'Your last ship is gone. Defeat.', 'sink');
    save();
    render();
    setTimeout(function () { showEndScreen(true); }, 900);
  }

  function showEndScreen(withSound) {
    if (S.phase !== 'over') return;
    if (S.winner === 'player') {
      els.winOverlay.classList.remove('hidden');
      if (withSound) sfx('win');
    } else {
      // Restart CSS animations by re-inserting the overlay content.
      els.loseOverlay.classList.remove('hidden');
      var stage = els.loseOverlay.firstElementChild;
      stage.replaceWith(stage.cloneNode(true));
      bindPlayAgain();
      if (withSound) jabbaLaugh();
    }
  }

  function hideEndScreens() {
    els.winOverlay.classList.add('hidden');
    els.loseOverlay.classList.add('hidden');
    clearTimeout(jabbaTimer);
    jabbaTimer = null;
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  function resetGame() {
    clearTimeout(aiTimer); aiTimer = null;
    hideEndScreens();
    var keepVertical = S ? S.orientationVertical : false;
    S = freshState();
    S.orientationVertical = keepVertical;
    lastShot = justSunk = null;
    selectedId = null;
    save();
    render();
    if (soundOn) ctx(); // Play again is a user gesture: the right moment to bring audio back
  }

  function bindPlayAgain() {
    document.querySelectorAll('.play-again').forEach(function (b) { b.onclick = resetGame; });
  }

  /* ---------------- sound ---------------- */
  var audioCtx = null;
  var jabbaTimer = null;
  function ctx() {
    if (!audioCtx || audioCtx.state === 'closed') {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    wakeAudio();
    return audioCtx;
  }

  // Safari/iOS move the context to the non-standard 'interrupted' state when speech synthesis
  // takes over the audio session, so resume on anything other than 'running'.
  function wakeAudio() {
    if (!audioCtx || audioCtx.state === 'running' || audioCtx.state === 'closed') return;
    try {
      var p = audioCtx.resume();
      if (p && p.catch) p.catch(function () {});
    } catch (e) { /* resume needs a user gesture on some browsers; the next gesture retries */ }
  }

  function tone(opts) {
    var a = ctx(); if (!a) return;
    var t = a.currentTime + (opts.delay || 0);
    var osc = a.createOscillator(), gain = a.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(opts.from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(opts.to, 1), t + opts.dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(opts.vol || 0.2, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    var node = osc;
    if (opts.lowpass) {
      var f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opts.lowpass;
      osc.connect(f); node = f;
    }
    node.connect(gain); gain.connect(a.destination);
    osc.start(t); osc.stop(t + opts.dur + 0.05);
  }

  function noise(dur, vol, delay) {
    var a = ctx(); if (!a) return;
    var t = a.currentTime + (delay || 0);
    var buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
    var src = a.createBufferSource(), gain = a.createGain(), f = a.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 900;
    src.buffer = buf; gain.gain.value = vol;
    src.connect(f); f.connect(gain); gain.connect(a.destination);
    src.start(t);
  }

  function sfx(kind) {
    if (!soundOn) return;
    try {
      if (kind === 'hit') { tone({ from: 1400, to: 200, dur: 0.18, type: 'sawtooth', vol: 0.08 }); noise(0.5, 0.5, 0.12); }
      else if (kind === 'miss') { tone({ from: 1400, to: 200, dur: 0.18, type: 'sawtooth', vol: 0.08 }); tone({ from: 300, to: 120, dur: 0.25, vol: 0.08, delay: 0.15 }); }
      else if (kind === 'start') { tone({ from: 220, to: 440, dur: 0.3, type: 'triangle', vol: 0.12 }); tone({ from: 330, to: 660, dur: 0.35, type: 'triangle', vol: 0.12, delay: 0.25 }); }
      else if (kind === 'win') { [392, 523, 659, 784].forEach(function (f, i) { tone({ from: f, to: f, dur: 0.35, type: 'triangle', vol: 0.15, delay: i * 0.18 }); }); }
    } catch (e) { /* audio is optional */ }
  }

  function jabbaLaugh() {
    if (!soundOn) return;
    try {
      // Deep, rumbling "HO HO HO" from filtered sawtooth bursts.
      for (var i = 0; i < 6; i++) {
        tone({ from: 120 - i * 4, to: 70, dur: 0.28, type: 'sawtooth', vol: 0.22, delay: 0.4 + i * 0.34, lowpass: 500 });
      }
    } catch (e) { /* ignore */ }
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
    try {
      window.speechSynthesis.cancel();
      var voices = window.speechSynthesis.getVoices();
      var voice = voices.filter(function (v) { return /en/i.test(v.lang) && /male|david|daniel|fred|alex|google uk english male/i.test(v.name); })[0] ||
                  voices.filter(function (v) { return /en/i.test(v.lang); })[0];
      var laugh = new SpeechSynthesisUtterance('Ho ho ho ho ho!');
      var line = new SpeechSynthesisUtterance('The Force was not with you.');
      [laugh, line].forEach(function (u) { if (voice) u.voice = voice; u.pitch = 0.1; u.rate = 0.75; u.volume = 1; });
      line.onend = line.onerror = wakeAudio;
      clearTimeout(jabbaTimer);
      jabbaTimer = setTimeout(function () {
        jabbaTimer = null;
        window.speechSynthesis.speak(laugh);
        window.speechSynthesis.speak(line);
      }, 2400);
    } catch (e) { /* ignore */ }
  }

  function renderSoundBtn() {
    els.soundBtn.textContent = 'Sound: ' + (soundOn ? 'On' : 'Off');
    els.soundBtn.setAttribute('aria-pressed', String(soundOn));
  }

  /* ---------------- wiring ---------------- */
  function init() {
    S = loadState();
    buildLabels();
    buildBoard(els.playerBoard, false);
    buildBoard(els.enemyBoard, true);

    els.playerBoard.addEventListener('pointerdown', onPlayerBoardDown);
    els.dock.addEventListener('pointerdown', onDockDown);
    els.dock.addEventListener('keydown', function (e) {
      var item = e.target.closest('.dock-ship');
      if (item && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectedId = item.dataset.id; renderDock(); }
    });
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', function (e) { endDrag(e, false); });
    window.addEventListener('pointercancel', function (e) { endDrag(e, true); });
    els.enemyBoard.addEventListener('click', onEnemyClick);
    els.enemyBoard.addEventListener('dblclick', function (e) { e.preventDefault(); });

    els.rotateBtn.addEventListener('click', toggleOrientation);
    els.randomBtn.addEventListener('click', function () {
      if (S.phase !== 'placement') return;
      S.placement = G.randomFleet();
      selectedId = null;
      save(); render();
    });
    els.clearBtn.addEventListener('click', function () {
      if (S.phase !== 'placement') return;
      S.placement.forEach(function (s) { s.row = s.col = null; });
      selectedId = null;
      save(); render();
    });
    els.startBtn.addEventListener('click', startBattle);
    els.newGameBtn.addEventListener('click', function () {
      if (S.phase === 'playing' && !window.confirm('Abandon the current battle and start over?')) return;
      resetGame();
    });
    els.soundBtn.addEventListener('click', function () {
      soundOn = !soundOn;
      localStorage.setItem(SOUND_KEY, soundOn ? 'on' : 'off');
      if (!soundOn) { clearTimeout(jabbaTimer); jabbaTimer = null; if (window.speechSynthesis) window.speechSynthesis.cancel(); }
      renderSoundBtn();
    });
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'r' || e.key === 'R') && S.phase === 'placement' && !e.ctrlKey && !e.metaKey && !e.altKey) toggleOrientation();
      if (e.key === 'Escape' && drag) endDrag(e, true);
    });
    // Another tab changed the game: pick up its state instead of overwriting it.
    window.addEventListener('storage', function (e) {
      if (e.key !== STORAGE_KEY) return;
      clearTimeout(aiTimer); aiTimer = null;
      hideEndScreens();
      S = loadState();
      render();
      if (S.phase === 'over') showEndScreen(false);
      scheduleAI();
    });
    if (window.speechSynthesis) window.speechSynthesis.getVoices(); // warm up the voice list
    // Browsers only let audio resume inside a user gesture, so retry on every click/tap/key.
    ['pointerdown', 'keydown'].forEach(function (t) { document.addEventListener(t, wakeAudio, true); });

    bindPlayAgain();
    renderSoundBtn();
    render();
    if (S.phase === 'over') showEndScreen(false);
    scheduleAI(); // resumes the AI's turn if the page was refreshed mid-move
  }

  init();
})();
