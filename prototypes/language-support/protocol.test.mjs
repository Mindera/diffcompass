import { expect, test } from 'bun:test';
import { decodeFrames, encodeFrame, positionOf } from './protocol.mjs';

test('LSP framing counts UTF-8 bytes, not JavaScript characters', () => {
  const message = { jsonrpc: '2.0', id: 1, result: 'Kotlin → café 🧭' };
  const encoded = encodeFrame(message);
  const decoded = decodeFrames(encoded);
  expect(decoded.messages).toEqual([message]);
  expect(decoded.remaining.length).toBe(0);
});

test('fragmented and combined frames preserve unconsumed bytes', () => {
  const first = encodeFrame({ id: 1, result: 'á' });
  const second = encodeFrame({ id: 2, result: null });
  const partial = decodeFrames(Buffer.concat([first, second.subarray(0, 12)]));
  expect(partial.messages).toEqual([{ id: 1, result: 'á' }]);
  expect(decodeFrames(Buffer.concat([partial.remaining, second.subarray(12)])).messages)
    .toEqual([{ id: 2, result: null }]);
});

test('rejects invalid or unbounded frames', () => {
  expect(() => decodeFrames(Buffer.from('Content-Length: -1\r\n\r\n'))).toThrow();
  expect(() => decodeFrames(Buffer.from('Content-Length: 999999999\r\n\r\n'))).toThrow();
});

test('probe positions use UTF-16 and fail on ambiguous needles', () => {
  expect(positionOf('// 🧭\nfun call() = target()', 'target')).toEqual({ line: 1, character: 13 });
  expect(() => positionOf('call call', 'call')).toThrow();
  expect(() => positionOf('call', 'missing')).toThrow();
});
