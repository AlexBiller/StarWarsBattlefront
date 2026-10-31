# Changelog

## Unreleased

### Fixed
- **No sound in the second game after "Play again"** ([#1](https://github.com/AlexBiller/StarWarsBattlefront/issues/1)).
  The Jabba screen's speech synthesis moves the shared Web Audio context into a non-running state. On Safari/iOS that state is `"interrupted"`, and the old code only resumed it when the state was `"suspended"`. The audio context is now resumed whenever it isn't `"running"`. It's also re-woken when Jabba finishes speaking, when you press Play again, and on any click, tap, or key press, and it's recreated if it was closed. Play again also cancels Jabba's queued speech so he can't laugh during the next game.
