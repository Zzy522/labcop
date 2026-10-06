import { describe, expect, it } from 'vitest';
import { renderCaptchaSvg } from '../captcha';

describe('captcha SVG', () => {
  it('renders a self-contained SVG without executable content', () => {
    const svg = renderCaptchaSvg('AB23');
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 130 44"');
    expect(svg).toContain('<path');
    expect(svg).not.toContain('<text');
    expect(svg).not.toContain('AB23');
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('data:');
  });
});
