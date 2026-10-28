"use client";

import { Children, cloneElement, useCallback, useEffect, useId, useRef, useState, type ReactElement } from "react";
import s from "./v2.module.css";
import { tooltipViewportPosition } from "./tooltipPosition";

type TooltipTrigger = { "aria-describedby"?: string };

/** Small player tooltip shown for pointer hover and keyboard-visible focus. */
export function Tooltip({ content, children, placement = "cursor", rootClassName }: { content: string; children: ReactElement<TooltipTrigger>; placement?: "overlay" | "above" | "cursor"; rootClassName?: string }) {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const showTimer = useRef<number | null>(null);
  const tooltipRef = useRef<HTMLSpanElement | null>(null);
  const pointerPosition = useRef({ x: 0, y: 0 });
  const pointerHovering = useRef(false);
  const trigger = Children.only(children);
  const describedBy = [trigger.props["aria-describedby"], id].filter(Boolean).join(" ");
  const open = hovered || focused;
  const positionAtPointer = useCallback((x: number, y: number) => {
    pointerPosition.current = { x, y };
    if (placement !== "cursor" || !tooltipRef.current) return;
    const rect = tooltipRef.current.getBoundingClientRect();
    const position = tooltipViewportPosition({ x, y }, { width: rect.width, height: rect.height }, { width: window.innerWidth, height: window.innerHeight });
    tooltipRef.current.style.left = `${position.left}px`;
    tooltipRef.current.style.top = `${position.top}px`;
  }, [placement]);
  const clearShowTimer = () => {
    if (showTimer.current !== null) window.clearTimeout(showTimer.current);
    showTimer.current = null;
  };
  const clearCursorPosition = () => {
    if (!tooltipRef.current) return;
    tooltipRef.current.style.removeProperty("left");
    tooltipRef.current.style.removeProperty("top");
  };
  useEffect(() => () => { if (showTimer.current !== null) window.clearTimeout(showTimer.current); }, []);
  useEffect(() => {
    if (!hovered || placement !== "cursor") return;
    const reposition = () => positionAtPointer(pointerPosition.current.x, pointerPosition.current.y);
    window.addEventListener("resize", reposition);
    return () => window.removeEventListener("resize", reposition);
  }, [hovered, placement, positionAtPointer]);

  return (
    <span
      className={`${s.tooltipRoot}${rootClassName ? ` ${rootClassName}` : ""}`}
      onPointerEnter={(event) => { if (event.pointerType !== "touch") { pointerHovering.current = true; positionAtPointer(event.clientX, event.clientY); clearShowTimer(); showTimer.current = window.setTimeout(() => setHovered(true), 400); } }}
      onPointerMove={(event) => { if (event.pointerType !== "touch" && pointerHovering.current) positionAtPointer(event.clientX, event.clientY); }}
      onPointerLeave={(event) => { if (event.pointerType !== "touch") { pointerHovering.current = false; clearShowTimer(); clearCursorPosition(); setHovered(false); } }}
      onFocus={(event) => { if (event.target instanceof HTMLElement && event.target.matches(":focus-visible")) { clearShowTimer(); showTimer.current = window.setTimeout(() => setFocused(true), 400); } }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { clearShowTimer(); setFocused(false); } }}
    >
      {cloneElement(trigger, { "aria-describedby": describedBy })}
      <span ref={tooltipRef} id={id} role="tooltip" className={`${s.tooltipBubble} ${placement === "cursor" ? (hovered ? s.tooltipBubbleCursor : s.tooltipBubbleAbove) : placement === "above" ? s.tooltipBubbleAbove : ""} ${open ? s.tooltipBubbleVisible : ""}`}>
        {content}
      </span>
    </span>
  );
}
