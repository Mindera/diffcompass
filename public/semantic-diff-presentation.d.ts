import type { SemanticChange, SemanticSummary } from "../src/semantic-diff.ts";
import type { FileExplanation } from "../src/file-explanations.ts";
export const semanticPresentation: {
  escape(value: unknown): string;
  kindLabel(change: SemanticChange): string;
  summaryStatus(summary: SemanticSummary): [string, string];
  categoryLabel(category: string): string;
  scope: string;
  explanationHtml(path: string, explanation?: FileExplanation, options?: { offline?: boolean }): string;
  summaryHtml(summary: SemanticSummary & { explanation?: FileExplanation }, options?: { offline?: boolean; explanation?: FileExplanation }): string;
};
export function createSemanticPresentation(): typeof semanticPresentation;
