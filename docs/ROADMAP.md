# Roadmap

This document captures the plan for turning Tabula from a single-page arena into a leaderboard site that ranks models and supports many providers.
It is a design record, not a commitment, so future work can start from context rather than a blank page.

## Goal

A website that lets many models play backgammon against each other, tracks results over time, and ranks them into a "best model" leaderboard.
Models come from foundation providers directly (Anthropic, OpenAI, Google) and from aggregators (OpenRouter, Vercel AI Gateway), and adding a new model should be configuration, not a code change.

## Why the current artifact cannot do this

The artifact is browser-only, calls one provider directly, and has no memory between sessions.
A leaderboard needs three things it lacks:

- A server, because provider API keys must never live in the browser.
- A database, to remember matches, results, and ratings.
- Volume, because dice make single games noisy, so rankings only mean something after many games.

## Proposed stack

- Next.js on Vercel, which pairs naturally with the Vercel AI Gateway.
- Postgres for storage of matches, per-move reasoning (for replay), and ratings.
- The Vercel AI SDK as the model layer, because it is provider-agnostic and treats OpenRouter and the Vercel AI Gateway as ordinary providers.

The tested engine from `src/App.jsx` moves to the server and becomes the match referee.
It computes legal moves and validates everything, so no provider can produce an illegal move.

## The model layer

Go gateway-first.
A single OpenRouter or Vercel AI Gateway key exposes hundreds of models through one unified, OpenAI-shaped API, with one bill and one rate-limit story, which is the simplest way to satisfy "plug in other models".
Direct provider keys for Anthropic, OpenAI, and Google can sit alongside for cost or higher limits.

Adding a model becomes a database row: provider, model string, display name.
The AI SDK's structured-output mode handles the `{ choice, reasoning }` JSON across models, with a heuristic fallback so a match never breaks.

## Ranking

Raw win and loss counts are not enough, because backgammon has luck.

- Use Glicko-2, which tracks a rating and a confidence interval, so a model with few games shows as provisional rather than falsely first.
- Weight results by backgammon scoring: a gammon counts double and a backgammon triple, which extracts more signal per game.
- Surface win rate, gammon rate, and head-to-head records next to the rating.
- Optional luck-cancelling refinement for later: play each pairing twice with the same dice sequence and the sides swapped.

## Open decisions

These are the forks that change the shape of the build.

1. Ownership.
   Single-owner curated leaderboard where the owner holds the keys and sets the roster, versus an open platform where visitors sign in and bring their own keys.
   Recommendation: start single-owner, open up later.

2. How rankings are earned.
   Only from games watched live, versus automated background tournaments that run many headless games for statistically real ratings.
   Recommendation: build the batch tournament runner as the core, with live watching as a spectator layer on top, and a hard budget cap.

3. Provider strategy.
   Gateway-first via the AI SDK, direct keys, or both.
   Recommendation: gateway-first for breadth, with optional direct keys for the big three.

## The main risk

Cost.
A single game is dozens to hundreds of model calls, multiplied by two models, multiplied by many games for meaningful ratings.
Put a hard spending cap in from day one.

## Suggested first steps

1. Refactor `src/App.jsx` into an engine module, a board component, and a model client.
2. Stand up a server route that runs one full model-vs-model game headlessly and returns the result.
3. Add Postgres and record match results.
4. Add the AI SDK with one gateway provider and two configurable models.
5. Add Glicko-2 ratings and a simple leaderboard page.
6. Layer the existing board UI back on as a live spectator view.
