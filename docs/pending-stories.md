# Pending Stories and Architectural Improvements

This document outlines the recommended improvements and pending stories for the WhatsApp AI conversation pipeline.

## 1. Implement a Message Queue for Asynchronous Processing

**Story:** As a user, I want the system to be resilient to traffic spikes and network issues, so that all my messages are processed reliably.

**Problem:** The current system processes incoming WhatsApp messages synchronously within the webhook endpoint. A high volume of messages could lead to webhook timeouts and potential message loss.

**Proposed Solution:**
- Introduce a message queue (e.g., RabbitMQ, or a simpler in-memory queue like `bullmq` for a Node.js environment).
- The webhook endpoint in `index.ts` should be modified to do two things:
    1.  Validate the incoming payload (as it does now).
    2.  Push the raw message object into the queue.
    3.  Immediately return a `200 OK` response.
- Create a separate "worker" process (or a cluster of workers) that listens to the queue.
- Each worker will pull a message from the queue and pass it to the `handleIncomingMessage` function in `src/assistant/message-router.ts`.

**Acceptance Criteria:**
- Incoming messages are added to a queue.
- The webhook endpoint responds in under 2 seconds.
- A worker process consumes messages from the queue and processes them through the existing pipeline.
- The system can handle a simulated load of 100 messages in 10 seconds without dropping any.

## 2. Add a Deduplication Layer

**Story:** As a user, I should never receive multiple responses for a single message I send, even if there are network issues.

**Problem:** Due to network retries from WhatsApp's servers, the same message might be delivered to the webhook endpoint multiple times. This can lead to the bot processing the same message and sending multiple identical replies.

**Proposed Solution:**
- In `src/assistant/pipeline/input-validator.ts`, implement a deduplication check at the beginning of the `validateAndPrepare` function.
- Use a fast, in-memory cache with a Time-To-Live (TTL), such as Redis or a `node-cache` instance.
- The key for the cache should be the WhatsApp message ID (`msg.id`).
- Before any processing, check if the message ID exists in the cache.
    - If it exists, immediately discard the message and return `{ continue: false }`.
    - If it does not exist, add the message ID to the cache with a TTL of ~5 minutes and proceed with processing.

**Acceptance Criteria:**
- When the same message ID is received twice within a 5-minute window, the second message is discarded.
- The bot sends only one response for a duplicated incoming message.

## 3. Generalize the Flow Execution Engine

**Story:** As a developer, I want to be able to add new types of multi-step conversations (like surveys or registration forms) easily, without duplicating code.

**Problem:** The `src/assistant/pipeline/state-executor.ts` file contains similar but separate logic for handling `activeWorkflow` and `activeBooking` states. This makes the code less DRY (Don't Repeat Yourself) and harder to extend.

**Proposed Solution:**
1.  **Create a generic `Flow` interface:**
    ```typescript
    interface FlowState {
      flowId: string;
      currentStepId: string;
      // ... other common state properties
    }

    interface Flow {
      start(context: any): Promise<{ newState: FlowState, response: string }>;
      executeStep(state: FlowState, userInput: string, context: any): Promise<{ newState: FlowState | null, response: string }>;
      isComplete(state: FlowState): boolean;
    }
    ```
2.  **Refactor `Workflow` and `Booking` to implement the `Flow` interface.**
3.  **Modify the `Conversation` state:** Replace `workflowState` and `bookingState` with a single `activeFlow: FlowState | null`.
4.  **Refactor `state-executor.ts`:**
    - Check for `convo.activeFlow`.
    - If it exists, dynamically load the correct `Flow` implementation based on `activeFlow.flowId`.
    - Call the `executeStep` method.
    - Update or clear the `activeFlow` based on the result.

**Acceptance Criteria:**
- The `state-executor.ts` is refactored to use a single, generic `activeFlow` property.
- The booking and workflow functionalities work exactly as before.
- A new, simple "survey" flow can be added by creating a new class that implements the `Flow` interface, without changing `state-executor.ts`.
