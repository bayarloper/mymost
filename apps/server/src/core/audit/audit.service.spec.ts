import { uuidV7Floor } from './audit.service';

describe('uuidV7Floor', () => {
  it('orders before any UUIDv7 generated at or after the date', () => {
    const date = new Date('2026-09-29T12:24:25.331Z');
    const floor = uuidV7Floor(date);
    expect(floor).toBe('01a0ed1f-95f3-7000-8000-000000000000');
    // a real id from the same millisecond sorts after the floor
    expect('01a0ed1f-95f3-7abc-9def-0123456789ab' > floor).toBe(true);
    // an id from one ms earlier sorts before it
    expect('01a0ed1f-95f2-7fff-bfff-ffffffffffff' < floor).toBe(true);
  });
});
