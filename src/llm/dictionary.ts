export interface DefinitionStream {
  tokens: AsyncIterable<string>;
  done: Promise<string>;
  abort(): void;
}

export function streamWordDefinition(word: string): DefinitionStream {
  const placeholder =
    `Definition coming soon — Phase 3 will fetch a real definition for "${word}" from Anthropic.`;
  const parts = placeholder.split(/(\s+)/);

  let aborted = false;
  let resolveDone!: (s: string) => void;
  let rejectDone!: (e: unknown) => void;
  const done = new Promise<string>((res, rej) => {
    resolveDone = res;
    rejectDone = rej;
  });

  async function* tokenGen() {
    let acc = '';
    for (const p of parts) {
      if (aborted) {
        rejectDone(new Error('aborted'));
        return;
      }
      await new Promise((r) => setTimeout(r, 30));
      acc += p;
      yield p;
    }
    resolveDone(acc);
  }

  return {
    tokens: tokenGen(),
    done,
    abort() { aborted = true; },
  };
}
