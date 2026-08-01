import { useRef, useState } from "react";

interface TooltipState<T> {
  x: number;
  y: number;
  data: T;
}

/**
 * Tooltip positioning for chart marks. Two ways to position it:
 * - `showTooltipAt(x, y, data)` — explicit coordinates, container-relative (SVG marks,
 *   where the mark's own geometry is already known and more precise than its DOM rect).
 * - `showTooltipFromEvent(e, data)` — derives position from the hovered/focused
 *   element's own bounding box (HTML cells, where there's no pre-computed geometry).
 */
export function useChartTooltip<T>() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState<T> | null>(null);

  function showTooltipAt(x: number, y: number, data: T) {
    setTooltip({ x, y, data });
  }

  function showTooltipFromEvent(e: React.MouseEvent | React.FocusEvent, data: T) {
    const containerRect = containerRef.current?.getBoundingClientRect();
    const targetRect = e.currentTarget.getBoundingClientRect();
    if (!containerRect) return;
    setTooltip({
      x: targetRect.left + targetRect.width / 2 - containerRect.left,
      y: targetRect.top - containerRect.top,
      data,
    });
  }

  function hideTooltip() {
    setTooltip(null);
  }

  return { containerRef, tooltip, showTooltipAt, showTooltipFromEvent, hideTooltip };
}
