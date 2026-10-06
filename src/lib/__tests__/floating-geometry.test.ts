import { describe, expect, it } from 'vitest';
import { clampFloating, snapFloating } from '@/lib/floating-geometry';
describe('floating assistant viewport geometry', () => {
  it('keeps the whole panel in a narrow or resized viewport', () => {
    expect(clampFloating({x:1000,y:1000},{x:375,y:667},{x:359,y:567})).toEqual({x:8,y:92});
    expect(clampFloating({x:-50,y:-50},{x:1280,y:800},{x:420,y:600})).toEqual({x:8,y:8});
  });
  it('snaps both sides based on the visible element edge, leaving the center free', () => {
    expect(snapFloating({x:30,y:100},{x:1280,y:800},{x:420,y:600}).edge).toBe('left');
    expect(snapFloating({x:840,y:100},{x:1280,y:800},{x:420,y:600})).toEqual({edge:'right',position:{x:852,y:100}});
    expect(snapFloating({x:300,y:100},{x:1280,y:800},{x:56,y:56}).edge).toBeNull();
  });
});
