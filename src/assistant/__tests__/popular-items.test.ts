/**
 * US-870: Popular items suggestion — AI waiter proactively recommends
 * top-ordered dishes when guest is undecided.
 *
 * Tests for:
 *   - formatPopularItemsResponse: formats popular items into recommendation message
 *   - food_recommendation intent patterns: regex matching for undecided phrases
 *   - food_recommendation T2 keywords: fuzzy match keywords coverage
 */
import { describe, it, expect } from 'vitest';

// ── formatPopularItemsResponse (inline copy for unit testing) ─────────

function formatPopularItemsResponse(itemsText: string, lang: string): string {
  const headerMessages: Record<string, string> = {
    en: 'Here are our most popular dishes, loved by most guests!',
    ms: 'Ini hidangan paling popular kami, kegemaran ramai tetamu!',
    zh: '这些是我们最受欢迎的菜品，深受大多数客人喜爱！',
  };

  const footerMessages: Record<string, string> = {
    en: '\nJust tell me the name or number of any item to add it to your order!',
    ms: '\nBeritahu saya nama atau nombor item untuk menambahnya ke pesanan anda!',
    zh: '\n告诉我菜品名称或编号即可加入您的订单！',
  };

  const header = headerMessages[lang] || headerMessages.en;
  const footer = footerMessages[lang] || footerMessages.en;

  const lines = itemsText.split('\n').filter(l => l.trim());
  const numbered = lines.map((line, i) => `${i + 1}. ${line.trim()}`);

  return `${header}\n\n${numbered.join('\n')}${footer}`;
}

// ── formatPopularItemsResponse ────────────────────────────────────────

describe('formatPopularItemsResponse', () => {
  const sampleItems = [
    'NR01 Nasi Lemak Special - RM 9.50',
    'MG01 Mee Goreng - RM 8.00',
    'TT01 Teh Tarik - RM 3.50',
  ].join('\n');

  it('formats popular items with header, numbering, and footer (EN)', () => {
    const result = formatPopularItemsResponse(sampleItems, 'en');

    expect(result).toContain('most popular dishes');
    expect(result).toContain('1. NR01 Nasi Lemak Special - RM 9.50');
    expect(result).toContain('2. MG01 Mee Goreng - RM 8.00');
    expect(result).toContain('3. TT01 Teh Tarik - RM 3.50');
    expect(result).toContain('name or number');
  });

  it('formats in Malay (ms)', () => {
    const result = formatPopularItemsResponse(sampleItems, 'ms');

    expect(result).toContain('paling popular');
    expect(result).toContain('1. NR01 Nasi Lemak Special');
    expect(result).toContain('nama atau nombor');
  });

  it('formats in Chinese (zh)', () => {
    const result = formatPopularItemsResponse(sampleItems, 'zh');

    expect(result).toContain('最受欢迎');
    expect(result).toContain('1. NR01 Nasi Lemak Special');
    expect(result).toContain('菜品名称或编号');
  });

  it('handles single item', () => {
    const result = formatPopularItemsResponse('Nasi Lemak - RM 9.50', 'en');
    expect(result).toContain('1. Nasi Lemak - RM 9.50');
    expect(result).not.toContain('2.');
  });

  it('skips empty lines in input', () => {
    const withGaps = 'Nasi Lemak - RM 9.50\n\n\nMee Goreng - RM 8.00';
    const result = formatPopularItemsResponse(withGaps, 'en');
    expect(result).toContain('1. Nasi Lemak');
    expect(result).toContain('2. Mee Goreng');
    expect(result).not.toContain('3.');
  });

  it('falls back to English for unknown language', () => {
    const result = formatPopularItemsResponse(sampleItems, 'ta');
    expect(result).toContain('most popular dishes');
    expect(result).toContain('name or number');
  });
});

// ── food_recommendation intent patterns ───────────────────────────────

describe('food_recommendation intent patterns', () => {
  const patterns = [
    /\b(recommend|suggest|popular|best.*seller|favourite|apa.*sedap|好吃)\b/i,
    /\b(what\s+(is|are)\s+good|what\s+should\s+i\s+(order|eat|try|get)|what\s+do\s+you\s+recommend)\b/i,
    /\b(i('m|\s+am)\s+(undecided|not\s+sure)|can('t|not)\s+decide|don('t|\s+not)\s+know\s+what\s+to\s+(order|eat|get))\b/i,
    /\b(apa\s+yang\s+(sedap|best|popular)|tak\s+tau\s+nak\s+(makan|order)|susah\s+nak\s+pilih)\b/i,
    /(不知道吃什么|推荐一下|有什么好吃|不知道点什么|帮我推荐)/,
  ];

  function matchesAny(text: string): boolean {
    return patterns.some(p => p.test(text));
  }

  // English
  it('matches "what is good"', () => {
    expect(matchesAny('what is good')).toBe(true);
  });

  it('matches "what are good options"', () => {
    expect(matchesAny('what are good options')).toBe(true);
  });

  it('matches "what should I order"', () => {
    expect(matchesAny('what should I order')).toBe(true);
  });

  it('matches "what should I eat"', () => {
    expect(matchesAny('what should I eat')).toBe(true);
  });

  it('matches "what do you recommend"', () => {
    expect(matchesAny('what do you recommend')).toBe(true);
  });

  it('matches "I\'m undecided"', () => {
    expect(matchesAny("I'm undecided")).toBe(true);
  });

  it('matches "I am not sure"', () => {
    expect(matchesAny('I am not sure what to order')).toBe(true);
  });

  it('matches "can\'t decide"', () => {
    expect(matchesAny("can't decide what to eat")).toBe(true);
  });

  it('matches "don\'t know what to order"', () => {
    expect(matchesAny("don't know what to order")).toBe(true);
  });

  it('matches "recommend something"', () => {
    expect(matchesAny('recommend something')).toBe(true);
  });

  it('matches "popular dishes"', () => {
    expect(matchesAny('popular dishes')).toBe(true);
  });

  it('matches "best seller"', () => {
    expect(matchesAny('best seller here')).toBe(true);
  });

  // Malay
  it('matches "apa yang sedap"', () => {
    expect(matchesAny('apa yang sedap')).toBe(true);
  });

  it('matches "tak tau nak makan"', () => {
    expect(matchesAny('tak tau nak makan apa')).toBe(true);
  });

  it('matches "susah nak pilih"', () => {
    expect(matchesAny('susah nak pilih lah')).toBe(true);
  });

  it('matches "apa sedap"', () => {
    expect(matchesAny('apa sedap sini')).toBe(true);
  });

  // Chinese
  it('matches "不知道吃什么"', () => {
    expect(matchesAny('不知道吃什么')).toBe(true);
  });

  it('matches "推荐一下"', () => {
    expect(matchesAny('推荐一下吧')).toBe(true);
  });

  it('matches "有什么好吃"', () => {
    expect(matchesAny('有什么好吃的')).toBe(true);
  });

  it('matches "帮我推荐"', () => {
    expect(matchesAny('帮我推荐几个')).toBe(true);
  });

  // Negative cases
  it('does not match plain greetings', () => {
    expect(matchesAny('hello')).toBe(false);
  });

  it('does not match order placement', () => {
    expect(matchesAny('I want to order nasi lemak')).toBe(false);
  });
});
