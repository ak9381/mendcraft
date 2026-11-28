import { describe, expect, it } from 'vitest';
import { pointPhotoCaption } from '../../src/canvas/pointPhotoCard';

describe('point photo caption', () => {
  it('says what it was and where the photo went', () => {
    expect(pointPhotoCaption({ label: 'Smart bulb', cloud: false, bytes: 9000 })).toBe('Recognised: Smart bulb · the photo stayed on this iPhone. Only the answer went to the laptop.');
    expect(pointPhotoCaption({ label: 'Smart bulb', cloud: true, bytes: 9216 })).toContain('this crop went to Gemini · 9.0 KB');
    expect(pointPhotoCaption({ label: null, cloud: false, bytes: 0 })).toMatch(/^Not recognised/);
  });
});
