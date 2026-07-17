# AI lab

Offline bot evaluation lives here so tournaments and analysis are not part of
the production server runtime.

- `benchmark.ts`: deterministic self-play and paired policy tournaments
- `benchmark-cli.ts`: command-line entry point used by `npm run ai:benchmark`
- `campaign.ts` / `campaign-cli.ts`: chunked, resumable A/B campaigns with
  faction and seat breakdowns
- `benchmark.test.ts`: determinism, pairing, and non-interference checks
- `policies.ts`: evaluation-only candidate policy configurations

The live server bot remains under `src/server/bot/`. `LIVE_BOT_POLICY` pins
production to `tactical-v3`, the promoted candidate-v5 configuration. Historical
and candidate policies remain available for explicit evaluation and rollback.
`candidate-v8` is the current focused experiment: it scores 调虎离山 by the
change from the current recipient to the forced next recipient, instead of
playing it for a fixed value regardless of who benefits. `candidate-v7` remains
available as the earlier incremental 转移 experiment.

Initial five-player paired run (100 pairs, seeds 1-100): candidate-v8 37.2%
versus tactical-v3 35.4%, paired difference +1.8 percentage points with a 95%
confidence interval of [-3.2, +6.8]. The result is inconclusive; keep
`tactical-v3` live pending a larger campaign.

For a large five-player comparison, save an atomic checkpoint after each chunk:

```powershell
npm run ai:campaign -- 5 5000 1 --candidate candidate-v8 --baseline tactical-v3 --chunk-size 100 --checkpoint .ai-results/v8-v3.json
```

If the process stops, repeat the command with `--resume`. A checkpoint is only
accepted when player count, policies, target pairs, and seed range all match.
