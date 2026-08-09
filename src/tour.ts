import type { TourOutline, TourPhase, TourStep } from "./types.ts";

export function tourSteps(outline: TourOutline | undefined): TourStep[] {
  return outline?.phases.flatMap((phase) => phase.steps) ?? [];
}

export function phaseForStep(outline: TourOutline | undefined, stepId: string | undefined): TourPhase | undefined {
  if (!stepId) return undefined;
  return outline?.phases.find((phase) => phase.steps.some((step) => step.id === stepId));
}

export function phaseIndexForStep(outline: TourOutline | undefined, stepId: string | undefined): number {
  if (!outline || !stepId) return -1;
  return outline.phases.findIndex((phase) => phase.steps.some((step) => step.id === stepId));
}
