import { expect, test } from "bun:test";
import { archifyCandidates, ArchifyRenderer } from "../src/archify.ts";
import { layoutArchitecture } from "../src/architecture-layout.ts";
import type { TourOutline } from "../src/types.ts";
import fixture from "./fixtures/branched-maps.json";

const outline = fixture as unknown as TourOutline;

test("branched maps preserve all three sequences, including long names and self-calls", () => {
  const candidates = archifyCandidates(outline);
  expect(candidates).toHaveLength(5);
  for (const flow of outline.flows) {
    const sequence = candidates.find((candidate) => candidate.id === `sequence-${flow.id}`)!;
    expect(sequence).toBeDefined();
    const messages = sequence.ir.messages as Array<{ from: string; to: string; label: string; y: number }>;
    const sourceMessages = flow.mermaid.split("\n").filter((line) => /->>|-->>/.test(line));
    expect(messages.map((message) => message.label)).toEqual(sourceMessages.map((line) => line.slice(line.indexOf(":") + 1).trim()));
    expect(messages.map((message) => message.y)).toEqual([...messages.map((message) => message.y)].sort((a, b) => a - b));
  }
});

test("architecture union layout sizes labels and preserves positions across Before/Delta/After", async () => {
  for (const candidate of archifyCandidates(outline).filter((candidate) => candidate.type === "architecture")) {
    const documents = [candidate.ir, candidate.comparison!.before!, candidate.comparison!.delta!];
    await layoutArchitecture(documents);
    const positions = new Map<string, number[]>();
    for (const document of documents) {
      for (const node of document.components as Array<{ id: string; label: string; pos: number[]; size: number[] }>) {
        expect(node.size[0]).toBeGreaterThan(node.label.length * 6.8);
        if (positions.has(node.id)) expect(node.pos).toEqual(positions.get(node.id)!);
        positions.set(node.id, node.pos);
      }
      for (const edge of document.connections as Array<{ via: number[][]; labelAt: number[] }>) {
        expect(edge.labelAt.every(Number.isFinite)).toBe(true);
        for (let i = 1; i < edge.via.length; i++) {
          expect(edge.via[i]![0] === edge.via[i - 1]![0] || edge.via[i]![1] === edge.via[i - 1]![1]).toBe(true);
        }
      }
    }
  }
});

test("packaged renderer validates the real branched review and all comparison views", async () => {
  const directory = process.env.ARCHIFY_PACKAGED_DIR;
  if (!directory) return; // Mandatory in installed-package smoke tests.
  const result = await new ArchifyRenderer(directory).render(outline);
  expect(result.failures).toEqual([]);
  expect(result.artifacts).toHaveLength(5);
  for (const map of result.artifacts.filter((map) => map.type === "architecture")) {
    expect(map.view).toBe("before-delta-after");
  }
  const selfCalls = result.artifacts.find((map) => map.id === "sequence-flow-gate-text")!;
  expect(selfCalls.html).toContain("one line per card, assertion paired with command");
}, 30_000);
