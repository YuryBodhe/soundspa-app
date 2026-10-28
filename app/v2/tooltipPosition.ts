export function tooltipViewportPosition(
  pointer: { x: number; y: number },
  bubble: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 14,
  margin = 8,
) {
  let left = pointer.x + gap;
  if (left + bubble.width > viewport.width - margin) left = pointer.x - bubble.width - gap;
  left = Math.max(margin, Math.min(left, viewport.width - bubble.width - margin));

  let top = pointer.y + gap;
  if (top + bubble.height > viewport.height - margin) top = pointer.y - bubble.height - gap;
  top = Math.max(margin, Math.min(top, viewport.height - bubble.height - margin));

  return { left, top };
}
