# WhatsApp AI Conversation Pipeline: Best Practices

This document outlines the best practices and architectural patterns for building a robust and scalable WhatsApp AI conversation pipeline. It covers message processing, intent classification, state management, response generation, and multi-profile routing.

## 1. High-Level Architecture

A modern WhatsApp AI pipeline should be designed as a series of loosely coupled services, each responsible for a specific stage of the conversation. This allows for scalability, maintainability, and the flexibility to upgrade individual components independently.

```
[WhatsApp API] <--> [Message Ingestion] <--> [Preprocessing] <--> [Intent Classification] <--> [State Management] <--> [Business Logic/Tools] <--> [Response Generation] <--> [Message Egress] <--> [WhatsApp API]
```

## 2. Message Processing (Ingestion and Preprocessing)

### Ingestion:
- **Webhook Endpoint:** Expose a secure HTTPS endpoint to receive incoming messages from the WhatsApp Business API (via webhooks).
- **Payload Validation:** Immediately validate the incoming webhook payload to ensure it's a legitimate request from Meta. Check for the presence of a signature in the `X-Hub-Signature` header.
- **Queueing:** For high-volume applications, push incoming messages to a message queue (e.g., RabbitMQ, AWS SQS, or a local in-memory queue for smaller applications) to decouple ingestion from processing and handle backpressure gracefully. This prevents webhook timeouts and allows for retries.

### Preprocessing:
- **Decryption:** Decrypt the message content if end-to-end encryption is used.
- **Normalization:**
    - Convert text to a consistent case (e.g., lowercase).
    - Trim whitespace.
    - Handle emojis: either strip them or convert them to a textual representation (e.g., `:smile:`).
- **Language Detection:** If supporting multiple languages, use a library like `cld3` or a service like Google's Translation API to detect the language of the incoming message. This information should be stored in the conversation state.
- **Deduplication:** Implement a mechanism to handle duplicate messages that can occur due to network retries. A simple approach is to cache message IDs for a short period.

## 3. Intent Classification

The goal of this stage is to understand the user's goal.

- **Hybrid Approach:** For most applications, a hybrid approach combining rule-based and machine learning-based classification is most effective.
    - **Rule-Based (Keyword/Regex):** For simple, well-defined commands (e.g., "help", "menu", "check status"). This is fast and predictable.
    - **ML-Based (NLU/LLM):** For more complex, natural language queries. Use a Natural Language Understanding (NLU) service (like Google's Dialogflow, Rasa NLU, or a custom-trained model) or a Large Language Model (LLM) like GPT-4, Claude, or Gemini.
- **LLM as a Classifier:** Modern LLMs are incredibly effective at zero-shot or few-shot classification. You can provide the user's message and a list of possible intents in a prompt and ask the LLM to choose the most likely one.
- **Confidence Scoring:** The intent classifier should return a confidence score. If the score is below a certain threshold, the bot can ask for clarification or hand over to a human agent.
- **Tool/Function Calling:** For complex actions, the intent classification can identify the appropriate "tool" or "function" to call. The new generation of LLMs (like GPT-4o and Gemini) are excellent at this.

## 4. State Management

State management is crucial for maintaining context and enabling multi-turn conversations.

- **Conversation State:** Store the state of each conversation in a database (e.g., Redis for speed, or a persistent database like PostgreSQL/MySQL for long-term storage).
- **State Object:** The state object for each conversation should include:
    - `conversation_id`: A unique identifier for the conversation (e.g., the user's WhatsApp ID).
    - `user_profile_id`: An identifier for the user's profile/persona (for multi-profile routing).
    - `current_intent`: The last classified intent.
    - `language`: The detected language.
    - `context`: A dictionary to store any relevant information extracted from the conversation (e.g., name, order number).
    - `history`: A list of recent messages (user and bot) to provide context for future turns.
- **Session Management:** Define a session timeout. If a user doesn't respond within a certain period, the session can be considered "expired" and the context can be reset or archived. AWS best practices suggest tracking message counts and total character length per conversation, and resetting the context when necessary to manage costs and prevent resource drainage.

## 5. Response Generation

This stage is responsible for crafting the bot's reply.

- **Template-Based Responses:** For simple, predictable intents, use pre-defined response templates. This is fast, cheap, and ensures brand consistency.
- **LLM-Powered Generation:** For dynamic, conversational responses, use an LLM. The prompt to the LLM should include:
    - The user's message.
    - The conversation history.
    - The classified intent and any extracted entities.
    - A "persona" or "system prompt" that defines the bot's tone and style.
    - The knowledge base or relevant context retrieved from a vector database.
- **Knowledge Retrieval (RAG):** To answer questions based on a specific knowledge base (e.g., product information, FAQs), use a Retrieval-Augmented Generation (RAG) approach:
    1.  Convert your knowledge base into vector embeddings and store them in a vector database (e.g., Pinecone, ChromaDB).
    2.  When a user asks a question, convert the question into an embedding.
    3.  Search the vector database for the most similar documents/chunks.
    4.  Pass the retrieved information as context to the LLM in the response generation prompt.
- **Human Handoff:** Implement a clear escalation path. If the bot cannot fulfill the request or the user explicitly asks to speak to a human, the conversation should be seamlessly transferred to a human agent.

## 6. Multi-Profile Routing

For applications that need to handle different personas or business profiles from a single WhatsApp number.

- **Profile Identification:**
    - **Initial Prompt:** Ask the user to select a profile at the beginning of the conversation.
    - **Keyword Trigger:** Use specific keywords in the initial message to route to a profile (e.g., "booking", "support").
    - **Phone Number Mapping:** If you have pre-existing user data, you can map incoming phone numbers to profiles.
- **Profile-Specific Context:**
    - Each profile should have its own:
        - Knowledge base (e.g., separate `.rainbow-kb` directories).
        - Intent classification model/rules.
        - Response templates and LLM persona.
- **State Management:** The `user_profile_id` in the conversation state is critical for ensuring that the correct context is used for each interaction.

## 7. Implementation Agent Actionable Context

For the implementation agent:

- **Directory Structure:** The existing `.rainbow-kb-*` directories are a good starting point for profile-specific knowledge bases.
- **Technology Stack:**
    - **Node.js/TypeScript:** A solid choice for the backend.
    - **Express.js:** For the webhook server.
    - **Drizzle ORM:** Can be used for database interactions (state management).
    - **LLM Provider:** You are already using an LLM. Ensure you are leveraging its function-calling capabilities.
- **Actionable Steps:**
    1.  **Refactor the `server.ts`:** Create a clear pipeline of functions for each stage (preprocessing, intent classification, etc.).
    2.  **Implement a State Manager:** Create a `StateManager` class that abstracts the reading and writing of conversation state to your database.
    3.  **Develop a Profile Manager:** Create a `ProfileManager` class that can load the correct knowledge base and configuration based on the `user_profile_id`.
    4.  **Enhance Intent Classification:** Move beyond simple keyword matching and use an LLM for more robust intent classification and entity extraction.
    5.  **Build a RAG Pipeline:** For the knowledge base, implement a RAG pipeline using a vector database.

By following these best practices, you can build a WhatsApp AI conversation pipeline that is not only powerful and intelligent but also scalable and easy to maintain.
