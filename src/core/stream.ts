/** @portableIntrinsic stream-map */
export function mapStream<Input, Output>(
  source: AsyncIterable<Input>,
  transform: (value: Input) => Output | PromiseLike<Output>,
): AsyncIterable<Output> {
  return {
    async *[Symbol.asyncIterator]() {
      for await (const value of source) yield transform(value);
    },
  };
}

/** @portableIntrinsic stream-distinct */
export function distinctStream<Value>(
  source: AsyncIterable<Value>,
  select: (value: Value) => unknown,
): AsyncIterable<Value> {
  return {
    async *[Symbol.asyncIterator]() {
      let previous: string | undefined;
      for await (const value of source) {
        const selected = JSON.stringify(select(value));
        if (selected === previous) continue;
        previous = selected;
        yield value;
      }
    },
  };
}
