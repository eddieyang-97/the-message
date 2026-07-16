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
production to `tactical-v2`; candidate policies are evaluation-only until
benchmark evidence and gameplay review justify an explicit promotion.

For a large five-player comparison, save an atomic checkpoint after each chunk:

```powershell
npm run ai:campaign -- 5 5000 1 --candidate candidate-v5 --baseline tactical-v2 --chunk-size 100 --checkpoint .ai-results/v5-v2.json
```

If the process stops, repeat the command with `--resume`. A checkpoint is only
accepted when player count, policies, target pairs, and seed range all match.
