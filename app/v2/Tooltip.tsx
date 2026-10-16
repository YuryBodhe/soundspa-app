"use client";

import { Children, cloneElement, useId, useState, type ReactElement } from "react";
import s from "./v2.module.css";

type TooltipTrigger = { "aria-describedby"?: string };

/** Small player tooltip shown for pointer hover and keyboard-visible focus. */
export function Tooltip({ content, children }: { content: string; children: ReactElement<TooltipTrigger> }) {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const trigger = Children.only(children);
  const describedBy = [trigger.props["aria-describedby"], id].filter(Boolean).join(" ");
  const open = hovered || focused;

  return (
    <span
      className={s.tooltipRoot}
      onPointerEnter={(event) => { if (event.pointerType !== "touch") setHovered(true); }}
      onPointerLeave={(event) => { if (event.pointerType !== "touch") setHovered(false); }}
      onFocus={(event) => { if (event.target instanceof HTMLElement && event.target.matches(":focus-visible")) setFocused(true); }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}
    >
      {cloneElement(trigger, { "aria-describedby": describedBy })}
      <span id={id} role="tooltip" className={`${s.tooltipBubble} ${open ? s.tooltipBubbleVisible : ""}`}>
        {content}
      </span>
    </span>
  );
}
