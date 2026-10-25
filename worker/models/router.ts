// Two models behind one: the cheap one answers by default, the strong one
// takes the questions the handler marks `strong` (see needsStrong in
// worker/ask.ts). Which questions those are comes from the eval suite.

import type { AskModel } from './types';

export function routedModel(cheap: AskModel, strong: AskModel): AskModel {
  return {
    id: `route:${cheap.id}/${strong.id}`,
    complete: (p) => (p.strong ? strong : cheap).complete(p),
  };
}
