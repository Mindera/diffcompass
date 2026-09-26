/** Local compatibility patches against the checksum-pinned upstream source. */
export function patchSequenceRenderer(source: string): string {
  const replace = (before: string, after: string) => {
    if (source.split(before).length !== 2) throw new Error("Archify sequence patch no longer matches the pinned source");
    source = source.replace(before, after);
  };
  replace("Math.min(190,", "Math.min(480,");
  replace("  const direction = to.cx > from.cx ? 1 : -1;", `  if (message.from === message.to) {
    const direction = from.index === participantCount - 1 ? -1 : 1;
    const loopX = from.cx + direction * Math.min(100, layout.colGap / 2);
    const halfLabel = (textUnits(message.label) * 5.2 + 12) / 2;
    const center = Math.max(halfLabel + 16, Math.min(viewBox[0] - halfLabel - 16, (from.cx + loopX) / 2));
    return { start: from.cx, end: from.cx, center, loopX };
  }
  const direction = to.cx > from.cx ? 1 : -1;`);
  replace("function messagePath(message) {\n  return {", `function messagePath(message) {
  const geometry = messageGeometry(message);
  if (geometry && message.from === message.to) return {
    points: [[geometry.start, message.y], [geometry.loopX, message.y], [geometry.loopX, message.y + 24], [geometry.end, message.y + 24]]
  };
  return {`);
  replace("if (distance < 60)", "if (message.from !== message.to && distance < 60)");
  replace("    if (typeof message.y !== 'number')", "    if (message.from === message.to && message.y + 24 > layout.lifelineBottom - 18) problems.push('Self-call extends beyond the timeline.');\n    if (typeof message.y !== 'number')");
  replace("  const { start, end } = messageGeometry(message);", `  const { start, end, center } = messageGeometry(message);
  const points = message.from === message.to ? messagePath(message).points : [[start, message.y], [end, message.y]];
  const path = points.map(([x, y], i) => (i ? 'L ' : 'M ') + x + ' ' + y).join(' ');`);
  replace("routePointsValue([[start, message.y], [end, message.y]])", "routePointsValue(points)");
  replace('d="M ${start} ${message.y} L ${end} ${message.y}"', 'd="${path}"');
  replace("messageLabel(message, start, end)", "messageLabel(message, center, center)");
  replace("    x: Math.min(geometry.start, geometry.end),", "    x: Math.min(geometry.start, geometry.loopX ?? geometry.end),");
  replace("    width: Math.abs(geometry.end - geometry.start),\n    height: 4,", "    width: Math.abs((geometry.loopX ?? geometry.end) - geometry.start),\n    height: message.from === message.to ? 28 : 4,");
  return source;
}
