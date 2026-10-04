// @ts-expect-error Bun embeds the dependency-free runtime in live/offline frames.
import runtime from "../public/sequence-walkthrough.js" with { type: "text" };
// @ts-expect-error Bun embeds the same responsive skin in live/offline frames.
import styles from "../public/sequence-walkthrough.css" with { type: "text" };

/** Project existing IR identities; never derive identity from a caption. */
export function sequenceWalkthroughSteps(ir: Record<string, unknown>) {
  if (!Array.isArray(ir.messages) || ir.messages.length > 40) return [];
  const seen = new Set<string>();
  const steps = [];
  for (const message of ir.messages) {
    // A partial list would renumber authored steps. Invalid/ambiguous identity
    // means no synchronized walkthrough; leave the source diagram intact.
    if (!message || typeof message.id !== "string" || !message.id || seen.has(message.id) || typeof message.label !== "string" || typeof message.from !== "string" || typeof message.to !== "string") return [];
    seen.add(message.id);
    steps.push({ id: message.id, label: message.label, from: message.from, to: message.to, variant: message.variant,
      callShaped: /^(?:[\w$]+\.)*([\p{L}_$][\p{L}\p{N}_$]*)\s*\([^\n]*\)\s*$/u.test(message.label) });
  }
  return steps;
}

export function sequenceWalkthroughScript(ir: Record<string, unknown>, offline = false): string {
  const steps = JSON.stringify(sequenceWalkthroughSteps(ir)).replace(/</g, "\\u003c");
  return `<style data-diffcompass-sequence-walkthrough>${styles}</style><script data-diffcompass-sequence-walkthrough>${runtime}\n(function(){function install(){window.DiffCompassSequenceWalkthrough.installArchify(${steps},${offline});}if(document.readyState==='loading')window.addEventListener('load',install,{once:true});else install();}());</script>`;
}
