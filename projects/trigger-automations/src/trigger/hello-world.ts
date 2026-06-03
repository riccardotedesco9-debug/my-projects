import { task } from "@trigger.dev/sdk";

// Simple test task to verify Trigger.dev setup works
export const helloWorld = task({
  id: "hello-world",
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10_000,
  },
  run: async (payload: { name?: string }) => {
    const name = payload.name ?? "World";
    console.log(`Hello, ${name}! Trigger.dev is working.`);
    return { message: `Hello, ${name}!`, timestamp: new Date().toISOString() };
  },
});
