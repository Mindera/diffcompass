import { expect, test } from "bun:test";
import { validateMapNodeRoles, applyMapNodeRoles, MAP_NODE_ROLE_PROMPT } from "../src/map-node-roles.ts";
import { validateReviewFlow } from "../src/flows.ts";
import { archifyCandidates } from "../src/archify.ts";
import { withArchifyEmbedAdapter } from "../src/archify-embed.ts";
import type { TourOutline } from "../src/types.ts";

test("roles require an explicit supported type, known id and source explanation", () => {
  expect(validateMapNodeRoles(undefined)).toBeUndefined();
  const roles = { A: { type: "Agent skill" as const, evidence: "skills/writing-plans/SKILL.md:1 defines reusable agent instructions." } };
  expect(validateMapNodeRoles(roles, new Set(['A']))).toEqual(roles);
  for (const bad of [{ A: { type: 'Backend', evidence: 'name' } }, { A: { type: 'ViewModel', evidence: '' } }, { Z: roles.A }, JSON.parse('{"__proto__":{"type":"File","evidence":"x"}}')]) {
    expect(() => validateMapNodeRoles(bad, new Set(['A']))).toThrow();
  }
  expect(MAP_NODE_ROLE_PROMPT).toContain('a name suffix alone is not evidence');
});

test("sequence normalization and renderer ids retain role bindings", () => {
  const flow = validateReviewFlow({id:'flow',title:'Run skill',summary:'Example',mermaid:'sequenceDiagram\nparticipant Box as Writing plans\nparticipant Tool as Assembler\nBox->>Tool: invoke',provenance:'partial',affectedFiles:['tools/assemble.py'],nodeRoles:{Box:{type:'Agent skill',evidence:'skills/writing-plans/SKILL.md:1 defines these instructions.'},Tool:{type:'Script',evidence:'tools/assemble.py:1 defines the CLI.'}}});
  expect(flow.nodeRoles?.Box_participant?.type).toBe('Agent skill');
  const candidates = archifyCandidates({title:'Example',summary:'Example',phases:[],callFlows:[],flows:[flow],findings:[]} as TourOutline);
  expect(candidates[0]?.nodeRoles?.['flow-Box_participant']?.type).toBe('Agent skill');
  expect(candidates[0]?.nodeRoles?.['flow-Tool']?.type).toBe('Script');
});

test("role kinds replace only node metadata, not labels, colours or domain identity", () => {
  const html = '<html><body><script id="archify-i18n-data">{"messages":{}}</script><g data-node-id="A" data-node-kind="backend"><rect class="c-backend"/>Writing plans</g><g data-node-id="B" data-node-kind="backend">SomeViewModel</g></body></html>';
  const roles = { A: {type:'Agent skill' as const, evidence:'SKILL.md:1 says </script><script>alert(1)</script>'} };
  const adapted = withArchifyEmbedAdapter(html, 'sequence', undefined, false, roles);
  expect(adapted).toContain('data-node-kind="review-agent-skill"');
  expect(adapted).toContain('data-node-kind="review-unspecified">SomeViewModel');
  expect(adapted).toContain('<rect class="c-backend"/>Writing plans');
  expect(adapted).toContain('"viewer.kind.review-agent-skill":"Agent skill"');
  expect(adapted).toContain('Why this type');
  expect(adapted).not.toContain('<script>alert(1)</script>');
  expect(applyMapNodeRoles(html, undefined, true)).toBe(html);
});
