/**
 * Structured routing decision returned by the routing LLM (challenge CHECK 1).
 *
 * The model is only ever allowed to answer with a single structured value:
 *   {"agentId": "<one of the discovered agent ids>"}  or  {"agentId": null}
 *
 * SECURITY: unknown keys are STRIPPED by this schema, so even if the model
 * outputs a "url" or other fields, they never reach the application. The
 * decision is only a HINT — it is independently enforced against the
 * discovered-agent list in validateRoutingDecision() (src/router/routing.ts).
 */
import { z } from 'zod';

export const RoutingDecisionSchema = z.object({
  agentId: z
    .union([z.string().max(64), z.null()])
    .describe('Exactly one discovered agent id, or null when no agent fits.'),
});

export type RoutingDecision = z.infer<typeof RoutingDecisionSchema>;
