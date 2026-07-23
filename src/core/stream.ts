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
