// Probe-only LSP framing. Not a production provider manager.
export function encodeFrame(message) {
  const body = Buffer.from(JSON.stringify(message));
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
}

export function decodeFrames(buffer) {
  const messages = [];
  while (buffer.length) {
    const end = buffer.indexOf('\r\n\r\n');
    if (end < 0) {
      if (buffer.length > 8192) throw new Error('Oversized LSP header');
      break;
    }
    const header = buffer.subarray(0, end).toString('ascii');
    const match = /^Content-Length: (\d+)$/im.exec(header);
    const length = Number(match?.[1]);
    if (!Number.isSafeInteger(length) || length < 1 || length > 8 * 1024 * 1024) {
      throw new Error('Invalid LSP Content-Length');
    }
    if (buffer.length < end + 4 + length) break;
    messages.push(JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString('utf8')));
    buffer = buffer.subarray(end + 4 + length);
  }
  return { messages, remaining: buffer };
}

export function positionOf(text, needle) {
  const offset = text.indexOf(needle);
  if (offset < 0 || text.indexOf(needle, offset + 1) >= 0) throw new Error(`Non-unique probe: ${needle}`);
  const prefix = text.slice(0, offset);
  return { line: prefix.split('\n').length - 1, character: offset - prefix.lastIndexOf('\n') - 1 };
}
