# Changelog

## Unreleased

### Fixed
- **Firing sounds go silent** ([#3](https://github.com/AlexBiller/StarWarsBattlefront/issues/3)).
  Shot sounds use Web Audio, but Jabba's voice uses speech synthesis, which is why only the shot sounds failed. The page now asks iOS for the `playback` audio session, so Web Audio plays even when the ring/silent switch is set to silent, the same as speech. If a Safari/iOS audio context is stuck in `interrupted` and `resume()` doesn't succeed, the next click or tap replaces it with a fresh one. Audio is unlocked on the first tap, and sounds triggered while audio is still waking up are queued until it's running instead of being lost.

- **No sound in the second game after "Play again"** ([#1](https://github.com/AlexBiller/StarWarsBattlefront/issues/1)).
  The Jabba screen's speech synthesis moves the shared Web Audio context into a non-running state. On Safari/iOS that state is `"interrupted"`, and the old code only resumed it when the state was `"suspended"`. The audio context is now resumed whenever it isn't `"running"`. It's also re-woken when Jabba finishes speaking, when you press Play again, and on any click, tap, or key press, and it's recreated if it was closed. Play again also cancels Jabba's queued speech so he can't laugh during the next game.

### Changed
- Shots now sound like blasters: a **"pew"** on a miss, and a "pew" plus a **"bam"** on a hit. Sinking a ship makes a bigger "bam".
