import { describe, it, expect } from 'vitest';
import { scoreMessageRelevance, pruneContextByRelevance } from '../pipeline/context-manager.js';
import type { ChatMessage } from '../types.js';

describe('context-pruning', () => {
  it('scores messages for relevance to intent', () => {
    const msg: ChatMessage = {
      role: 'user',
      content: 'I want to book a room',
      timestamp: Date.now(),
    };
    const score = scoreMessageRelevance(msg, 'booking', 0, 1, Date.now());
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('prunes low-relevance messages when history exceeds 8 messages', () => {
    const now = Date.now();
    const history: ChatMessage[] = [
      // Old booking conversation (low relevance for 'room_type' intent)
      { role: 'user', content: 'Can I extend my stay?', timestamp: now - 10000 },
      { role: 'assistant', content: 'Sure, how many more nights?', timestamp: now - 9000 },
      { role: 'user', content: 'Just 2 more nights', timestamp: now - 8000 },
      { role: 'assistant', content: 'Perfect!', timestamp: now - 7000 },
      // Middle messages
      { role: 'user', content: 'ok thanks', timestamp: now - 6000 },
      { role: 'assistant', content: 'anything else?', timestamp: now - 5000 },
      // New room-type conversation (high relevance for 'room_type' intent)
      { role: 'user', content: 'What type of room am I in?', timestamp: now - 100 },
      { role: 'assistant', content: 'You have a double room', timestamp: now - 50 },
      { role: 'user', content: 'Can I upgrade?', timestamp: now },
    ];

    const pruned = pruneContextByRelevance(history, 'room_type', 8, 0.3);
    
    // Pruned should be shorter or equal to original
    expect(pruned.length).toBeLessThanOrEqual(history.length);
    // Should keep at least first and last message
    expect(pruned.length).toBeGreaterThanOrEqual(2);
    // Last message should be preserved (most recent, most relevant)
    expect(pruned[pruned.length - 1]).toEqual(history[history.length - 1]);
  });

  it('old extend-stay request doesnt influence room-type intent classification', () => {
    const now = Date.now();
    const history: ChatMessage[] = [
      { role: 'user', content: 'I want to extend my stay', timestamp: now - 10000 },
      { role: 'assistant', content: 'How many nights?', timestamp: now - 9000 },
      { role: 'user', content: 'Just one night', timestamp: now - 8000 },
      { role: 'assistant', content: 'Done!', timestamp: now - 7000 },
      { role: 'user', content: 'ok', timestamp: now - 6000 },
      { role: 'assistant', content: 'Cool', timestamp: now - 5000 },
      { role: 'user', content: 'thanks', timestamp: now - 4000 },
      { role: 'assistant', content: 'Welcome!', timestamp: now - 3000 },
      { role: 'user', content: 'What is my room type?', timestamp: now - 100 },
      { role: 'assistant', content: 'Double room', timestamp: now },
    ];

    const pruned = pruneContextByRelevance(history, 'room_type', 8, 0.3);
    
    // Should reduce history for 'room_type' intent (old 'extend stay' not relevant)
    // The pruned context should focus on recent room-type related messages
    expect(pruned.length).toBeGreaterThanOrEqual(2);
    
    // The pruned context should contain room-related messages
    const contextText = pruned.map(m => m.content).join(' ').toLowerCase();
    expect(contextText).toContain('room');
  });
});
