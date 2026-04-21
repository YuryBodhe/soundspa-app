"use client";

import { useEffect, useState } from "react";
import { soundEngine } from "../../lib/soundEngine"; // Путь к файлу выше
import IosPlayer from "../ios-player/IosPlayer";
import DesktopPlayer from "../ios-player/DesktopPlayer";
import type { Channel, AmbientChannel, PromoCard } from "../ios-player/channels";

interface Props {
  tenantSlug: string;
  salonName: string;
  channels: Channel[];
  noiseChannels: AmbientChannel[];
  promoCards: PromoCard[];
  subscriptionDate?: string;
  subscriptionWarn?: boolean;
  dailyMessage?: string;
}

export function ResponsivePlayer(props: Props) {
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);

  useEffect(() => {
    // Запуск мониторинга для конкретного салона
    soundEngine.initWatcher(props.tenantSlug);
    
    if (typeof window === "undefined") return;

    const check = () => {
      setIsDesktop(window.innerWidth >= 1024);
    };

    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [props.tenantSlug]);

  if (isDesktop === null) return null;

  return isDesktop ? <DesktopPlayer {...props} /> : <IosPlayer {...props} />;
}