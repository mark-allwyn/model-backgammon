# Tabula

An arena where two AI models play backgammon against each other, with their reasoning shown live.
You pick a model for each side, press start, and watch them play out a real game on a realistic board.

![Screenshot of the Tabula backgammon arena](docs/screenshot.png)

## Status

This is an early prototype (v0.1).
It began life as a single-file [Claude artifact](https://claude.ai) and has been wrapped as a runnable Vite + React app so it can be developed further.

What works today:

- A complete, tested backgammon rules engine (legal move generation, bar re-entry, forced moves, bearing off, hitting, win and gammon detection).
- A realistic board rendered in SVG (wood-grain frame, felt texture, lens-shaped ivory and ebony checkers with contact shadows, 3D tumbling dice).
- Checkers that physically slide and arc between points, dice that tumble in 3D, and a per-side reasoning panel that reveals each model's thinking.
- A model dropdown per side, a move history log, and slow / normal / fast pacing controls.

Known limitations:

- There is no doubling cube yet.
- Doubles show two dice even though four checkers move.
- Live model calls now run locally through a small proxy (see "The model layer" below). If the proxy is not running, the app falls back to a built-in heuristic so a game still plays out end to end.

## How it works

The most important design decision is that the engine, not the model, owns the rules.
On each turn the engine rolls the dice and computes every legal play for that roll.
The model is only ever asked to choose an index from that list and give a one sentence reason.
This means a model can never make an illegal move no matter how it formats its reply, which matters in a game as fiddly as backgammon.

The model is prompted to return strict JSON of the form `{ "choice": <index>, "reasoning": "<text>" }`.
If a call fails or the reply cannot be parsed, the app falls back first to a simpler model, then to a heuristic, so the game never stalls.

The board is drawn with a single SVG using filters for the wood and felt textures.
Checker movement uses the Web Animations API for a lifted, arced slide, and the dice are real CSS 3D cubes that tumble and settle on the rolled face.

## Getting started

```bash
npm install
npm run server   # in one terminal: the local model proxy (uses your Claude subscription)
npm run dev      # in another: the Vite dev server
```

Then open the URL Vite prints (usually http://localhost:5173).
The proxy listens on http://localhost:8787 and Vite forwards `/api` to it.
If you skip `npm run server`, the app still runs but uses its built-in heuristic instead of the models.

To build a static production bundle:

```bash
npm run build
npm run preview
```

## The model layer

The browser never talks to Anthropic directly.
Instead the app calls a local proxy at `/api/move` (`server/index.mjs`), which Vite forwards to `http://localhost:8787`.
The proxy uses the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk), which authenticates with the same login Claude Code uses.
So if you are signed in to a Claude Pro or Max subscription, moves are played on that subscription with no separate API billing.

Note: if `ANTHROPIC_API_KEY` is set in the shell that runs the proxy, the Agent SDK uses that API key (separate pay-as-you-go billing) instead of your subscription.
Unset it to force subscription auth.

To keep moves fast, the proxy disables extended thinking (a move is only a pick from a pre-scored list of legal plays) and caps each move at `TABULA_MOVE_TIMEOUT_MS` (default 12000 ms).
If the proxy is unreachable or a move times out, the app falls back to a built-in heuristic so a game still plays out end to end without stalling.

Making this provider-agnostic (Anthropic, OpenAI, Google, OpenRouter, the Vercel AI Gateway on one code path) is still a future step.
See [docs/ROADMAP.md](docs/ROADMAP.md) for the full plan, including the leaderboard and rating design.

## Project structure

```
index.html          Vite entry point
src/main.jsx         Mounts the React app
src/App.jsx          The whole app: engine, board, dice, panels, game loop
server/index.mjs     Local model proxy (Claude Agent SDK, uses your subscription)
docs/ROADMAP.md      Plans for the leaderboard site and multi-provider support
docs/screenshot.png  Current UI
```

Everything currently lives in `src/App.jsx`.
An early refactor worth doing is splitting it into an engine module, a board component, and a model client, which also makes the engine reusable on a server.

## Credits

Inspired by [ed-donner/connect](https://github.com/ed-donner/connect), which pits language models against each other at Connect 4.

## License

Not yet chosen.
Add a license file before making the repository public.
