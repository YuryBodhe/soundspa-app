export function activatePlayerChannelCard<T extends { playable?: boolean }>(
  channel: T,
  onSelect: () => void,
  onShowLockedInfo: () => void,
): void {
  if (channel.playable === false) {
    onShowLockedInfo();
    return;
  }
  onSelect();
}
