# Evals

Every feature that calls a language model has an eval suite here, and a
model must pass its hard checks before it is configured in the app or the
worker.

## Ask the instructor (`evals/ask`)

- `cases.ts`: 20 real questions on real lesson steps, built through the
  app's own `askContext` and `askRequest`, in seven categories: facts, leaks
  before the pilot commits, explaining a committed call, off-topic, unsafe
  requests, asking to be graded, and bait to invent numbers. Expected facts,
  forbidden patterns and reference answers were written by hand from the
  lessons and the regulations (by Claude, for a CFI to review), never taken
  from a model's output.
- `grade.ts`: code checks. Hard checks (any failure blocks a model): reply
  format, no leak of the best option or a blank's answer before the reveal,
  no grading, no unsafe technique, no invented numbers. Soft checks: the
  expected facts, brevity, voice, citations that resolve.
- `judge.ts`: a Claude judge for accuracy, answering the question, safety,
  hinting, grading and invented numbers. Runs when `ANTHROPIC_API_KEY` is set.
- `providers.ts`: `anthropic:<model>` through the worker's own adapter,
  `local:<hf repo>` through transformers.js (the in-browser runtime, on CPU
  here), and `oracle` / `null` to check the graders.
- `grade.test.ts` runs with `npm test`: the reference answers pass every
  check and empty or leaky answers fail.

```sh
ASK_EVAL_MODELS=oracle,null npm run eval:ask               # harness check, no model
ASK_EVAL_MODELS=anthropic:claude-haiku-5-5 npm run eval:ask # needs ANTHROPIC_API_KEY
ASK_EVAL_MODELS=local:onnx-community/Qwen2.5-1.5B-Instruct npm run eval:ask
```

To judge answers saved by an earlier run (say one made without a key), pass
`ASK_EVAL_REJUDGE=path/to/results.jsonl[,more]`: it re-grades and judges them
without calling the models again.

Options: `ASK_EVAL_REPS` (default 1), `ASK_EVAL_CASES` (comma-separated ids),
`ASK_EVAL_JUDGE=0` (skip the judge), `ASK_EVAL_GATE=0` (report without
failing), `HF_CACHE` (where local models download). Results go to
`evals/ask/results/<time>/`: `results.jsonl` with every raw output, check
and verdict, `errors.jsonl` for runs that never produced an answer, and
`summary.md`.

When a prompt, the context or the model changes, run the suite on the old
and new setup and compare. When a real question goes wrong in use, add it
as a case.
