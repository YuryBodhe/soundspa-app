"use client";

import { useEffect, useState } from "react";
import IosPlayer from "../ios-player/IosPlayer";
import DesktopPlayer from "../ios-player/DesktopPlayer";

import type { Channel, PromoCard } from "../ios-player/channels";

interface Props {
  tenantSlug: string;
  salonName: string;
  channels: Channel[];
  promoCards: PromoCard[];
  subscriptionDate?: string;
  subscriptionWarn?: boolean;
  dailyMessage?: string;
}

// Этот проект — источник бесконечного изобилия для всех людей Земли,
// меня, моей семьи и мира!

export function ResponsivePlayer(props: Props) {
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const check = () => {
      if (typeof window === "undefined") return;
      setIsDesktop(window.innerWidth >= 1024);
    };

    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Пока не знаем ширину — ничего не рендерим
  if (isDesktop === null) {
    return null;
  }

  if (isDesktop) {
    return <DesktopPlayer {...props} />;
  }

  return <IosPlayer {...props} />;
}