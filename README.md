# Star Wars Battleship

Classic Battleship in the browser: your Rebel Alliance fleet vs. an Imperial AI.
Plain HTML/CSS/JavaScript with no build step and no dependencies.

**Play it live:** https://alexbiller.github.io/StarWarsBattlefront/

Deployed with GitHub Pages from the `main` branch (repo root). Every push to `main` redeploys automatically.

## The fleets

| Classic ship | Size | Rebel Alliance (you) | Galactic Empire (AI) |
|---|---|---|---|
| Carrier | 5 | Mon Calamari Star Cruiser | Imperial Star Destroyer |
| Battleship | 4 | Nebulon-B Frigate | Victory-class Star Destroyer |
| Cruiser | 3 | CR90 Corellian Corvette | Gozanti-class Cruiser |
| Submarine | 3 | Millennium Falcon | Lambda-class Shuttle |
| Destroyer | 2 | X-wing Starfighter | TIE Fighter |

## How to play

1. **Deploy your fleet.** You can:
   - drag a ship from the dock onto your grid (green preview means it fits, red means it doesn't),
   - click a ship in the dock, then click a grid cell to place it,
   - click a placed ship to rotate it, or drag it somewhere else (drag it back onto the dock to remove it),
   - press **R** or the *Orientation* button to switch between horizontal and vertical for new placements,
   - press **Random placement** to place everything automatically.

   Ships can't overlap or hang off the 10x10 board.
2. Press **Start battle**. You fire first. Click a cell on the Imperial grid to fire one shot. Then the AI fires one shot at you.
3. Hits are flaming markers with an X, misses are small dots. A sunk ship is announced, written to the battle log, and revealed (enemy) or greyed out (yours).
4. Sink all five enemy ships to win. If you lose, Jabba the Hutt shows up to laugh at you. Press **Play again** to start over.

### Edge cases handled

- **Double-clicking / re-clicking a cell:** a cell can only be fired at once. The second click of a double-click is ignored silently. Clicking a cell you already fired at later shows a short notice.
- **Clicking out of turn:** shots are blocked while the AI is taking its turn, before the battle starts, and after it ends.
- **Refreshing mid-game:** the whole game is saved to `localStorage` after every action (placement, shots, AI memory, battle log). A refresh puts you back exactly where you were, including the AI's turn if you refreshed while it was "thinking". If the saved data is corrupt or was tampered with, the game starts fresh instead of crashing.
- **Several tabs:** if you open the game in a second tab, the tabs stay in sync through the `storage` event instead of overwriting each other.
- **Sound** (blaster "pew" on a miss, "pew" + "bam" on a hit, a bigger "bam" when a ship sinks, and Jabba's laugh, generated with Web Audio and the browser's speech synthesis) can be turned off with the *Sound* button. If the browser doesn't support these APIs, the game runs silently.

## Running locally

You don't need to install anything. Pick one of these:

- **Just open it:** double-click `index.html`. The game uses classic scripts (not ES modules), so it works over `file://`.
- **With a local server** (closer to how it runs when deployed):
  ```bash
  python3 -m http.server 8080
  # or: npx serve .
  ```
  Then open http://localhost:8080.

### Tests

The game rules and the AI live in `game.js` with no DOM code, so they can be unit tested in Node (v18+):

```bash
npm test
```

The tests check that random fleets are always legal, that placement rejects overlap and overhang, that firing reports hit/miss/sunk/game over correctly, and that the AI never repeats a cell. They also play 500 full AI games: hunt/target averages about 61 shots to sink a random fleet, versus about 96 for pure random fire.

## How the AI works

The AI uses the classic **hunt/target** strategy. Its memory has two parts: the set of cells it has already fired at, and a list of **open hits**, meaning hits that don't belong to a sunk ship yet.

- **Hunt mode** (no open hits): it fires at a random cell it hasn't tried yet.
- **Target mode** (at least one open hit):
  1. If two or more open hits are next to each other in a row or column, it has found the ship's direction. It fires at the next untried cell past either end of that line.
  2. Otherwise (a single hit, or both ends of the line are blocked), it fires at an untried cell directly above, below, left, or right of an open hit.
- **On a sink:** the sunk ship's cells are removed from the open hits. If any hits are left over (because two ships were touching), it keeps targeting them. Once no open hits remain, it goes back to random hunting.

It never fires at the same cell twice: every candidate cell is checked against its set of tried cells, and this is enforced in the tests. The AI only knows what a real opponent would know: where its shots landed and which ship was announced as sunk.

## Project layout

```
index.html   page markup, including the Jabba SVG
style.css    styling and animations
game.js      rules + AI (works in the browser and in Node)
app.js       UI: placement drag/drop, turns, persistence, sound, overlays
tests/       Node unit tests for game.js
```

Star Wars and all related names are trademarks of Lucasfilm Ltd. This is a non-commercial fan project.
