export class MusicPlaybackIntent {
  private value = false;
  get wantsPlayback() { return this.value; }
  start() { this.value = true; }
  stop() { this.value = false; }
}
