// Compatibility shim — forwards the legacy `meetsync-message-router` task id
// to the new agentic turn-handler (`runTurn`). Kept so the deployed Worker,
// which still triggers `meetsync-message-router` until phase 06, doesn't
// break during the rollout.
//
// Phase 06 updates the Worker to trigger `meetsync-turn-handler` directly
// and this file is deleted.
//
// NOTE: we preserve the task id `meetsync-message-router` on purpose —
// changing it during phase 05 would require coordinating a Worker deploy
// in the same window. The shim keeps phases 05 and 06 decoupled.

import { schemaTask } from "@trigger.dev/sdk";
import { payloadSchema, runTurn } from "./turn-handler.js";

export const messageRouter = schemaTask({
  id: "meetsync-message-router",
  schema: payloadSchema,
  maxDuration: 120,
  run: async (payload) => runTurn(payload),
});
