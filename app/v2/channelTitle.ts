export function resolveChannelTitle(title: string, localizedTitles: Record<string, string> | undefined, locale: string): string {
  const requested = localizedTitles?.[locale]?.trim(); if (requested) return requested;
  const english = localizedTitles?.en?.trim(); if (english) return english;
  return title.trim() || "Untitled channel";
}
