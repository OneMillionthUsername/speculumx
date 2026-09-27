import simpleCache from '../utils/simpleCache.js';

describe('simpleCache freezing', () => {
  test('cached object is frozen and cannot be mutated', () => {
    const key = 'test:post';
    const original = { id: 1, title: 'X', content: '<p>Hello</p>' };
    simpleCache.set(key, original, 1000);
    const cached = simpleCache.get(key);
    // Content should be preserved as-is
    expect(cached.content).toBe('<p>Hello</p>');
    // Object should be frozen — mutation throws in strict mode
    expect(Object.isFrozen(cached)).toBe(true);
    expect(() => { cached.title = 'Changed'; }).toThrow();
    // Cache still returns original value
    const cached2 = simpleCache.get(key);
    expect(cached2.title).toBe('X');
    simpleCache.del(key);
  });
});

describe('simpleCache invalidation', () => {
  test('delByPrefix removes only keys with the given prefix', () => {
    simpleCache.set('posts:mostRead', [1], 1000);
    simpleCache.set('posts:archive:years', [2025], 1000);
    simpleCache.set('cards:all', [2], 1000);

    simpleCache.delByPrefix('posts:');

    expect(simpleCache.get('posts:mostRead')).toBeNull();
    expect(simpleCache.get('posts:archive:years')).toBeNull();
    expect(simpleCache.get('cards:all')).toEqual([2]);
    simpleCache.del('cards:all');
  });

  test('clear() also resets the byte counter', () => {
    simpleCache.set('stats:a', { payload: 'x'.repeat(100) }, 1000);
    expect(simpleCache.getStats().totalBytes).toBeGreaterThan(0);

    simpleCache.clear();

    expect(simpleCache.getStats()).toEqual({ entries: 0, totalBytes: 0 });
  });
});
