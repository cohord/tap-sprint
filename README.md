# Tap Sprint

During the three-second countdown and active round, content below the board is
hidden and touch scrolling is locked. Pause remains available above the board.
Pausing or finishing restores normal scrolling; finished rounds show Play Again,
Hit Breakdown, reaction stats, and performance history.

## Browser checks

With Node.js, Google Chrome, and the `playwright` package installed, run:

```sh
node tests/gameplay.cjs
```

The checks cover six viewport sizes, including small phones and landscape,
countdown timing, touch taps and swipes, keyboard taps, pause/resume, early and
natural finishes, replay, three-round sessions, background interruptions, and
saved history. They use a local HTTP server and a controlled browser clock.
