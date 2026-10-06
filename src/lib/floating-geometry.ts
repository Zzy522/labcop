export interface Position { x: number; y: number }
export function clampFloating(position: Position, viewport: Position, size: Position, margin = 8): Position {
  return { x: Math.max(margin, Math.min(position.x, Math.max(margin, viewport.x - size.x - margin))), y: Math.max(margin, Math.min(position.y, Math.max(margin, viewport.y - size.y - margin))) };
}
export function snapFloating(position: Position, viewport: Position, size: Position, threshold = 48) {
  const point = clampFloating(position, viewport, size);
  const right = Math.max(8, viewport.x - size.x - 8);
  const edge: 'left' | 'right' | null = point.x - 8 <= threshold ? 'left' : right - point.x <= threshold ? 'right' : null;
  return { position: { ...point, x: edge === 'left' ? 8 : edge === 'right' ? right : point.x }, edge };
}
