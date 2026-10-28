"use client";

import { Children, cloneElement, useEffect, useId, useRef, useState, type ReactElement } from "react";
import s from "./v2.module.css";

type TooltipTrigger = { "aria-describedby"?: string };

/** Small player tooltip shown for pointer hover and keyboard-visible focus. */
export function Tooltip({ content, children, placement = "overlay" }: { content: string; children: ReactElement<TooltipTrigger>; placement?: "overlay" | "above" }) {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const showTimer = useRef<number | null>(null);
  const trigger = Children.only(children);
  const describedBy = [trigger.props["aria-describedby"], id].filter(Boolean).join(" ");
  const open = hovered || focused;
  const clearShowTimer = () => {
    if (showTimer.current !== null) window.clearTimeout(showTimer.current);
    showTimer.current = null;
  };
  useEffect(() => () => { if (showTimer.current !== null) window.clearTimeout(showTimer.current); }, []);

  return (
    <span
      className={s.tooltipRoot}
      onPointerEnter={(event) => { if (event.pointerType !== "touch") { clearShowTimer(); showTimer.current = window.setTimeout(() => setHovered(true), 400); } }}
      onPointerLeave={(event) => { if (event.pointerType !== "touch") { clearShowTimer(); setHovered(false); } }}
      onFocus={(event) => { if (event.target instanceof HTMLElement && event.target.matches(":focus-visible")) { clearShowTimer(); showTimer.current = window.setTimeout(() => setFocused(true), 400); } }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { clearShowTimer(); setFocused(false); } }}
    >
      {cloneElement(trigger, { "aria-describedby": describedBy })}
      <span id={id} role="tooltip" className={`${s.tooltipBubble} ${placement === "above" ? s.tooltipBubbleAbove : ""} ${open ? s.tooltipBubbleVisible : ""}`}>
        {content}
      </span>
    </span>
  );
}
