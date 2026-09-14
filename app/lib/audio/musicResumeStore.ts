type StorageLike = Pick<Storage,"getItem"|"setItem"|"removeItem">;
export type MusicResume = {version:1;trackId:string;positionSeconds:number};
export const RESUME_NEAR_END_SECONDS = 10;
export const RESUME_SAVE_INTERVAL_MS = 10_000;

// Per-channel keys, no media/cache data. In-memory fallback also tolerates denied storage.
export class MusicResumeStore {
  private memory=new Map<string,MusicResume>();
  constructor(private readonly storage:()=>StorageLike|null=()=>{
    try{return typeof window!=="undefined"?window.localStorage:null;}catch{return null;}
  }){}
  private key(channelId:string){return `soundspa:v2:music-resume:v1:${channelId}`;}
  read(channelId:string,trackIds:readonly string[]):MusicResume|null {
    let value:unknown=this.memory.get(channelId)??null;
    let raw:string|null|undefined;
    if(!this.memory.has(channelId)){try {raw=this.storage()?.getItem(this.key(channelId));}catch{/* Use session fallback if storage is denied. */}}
    if(raw!==null&&raw!==undefined){try{value=JSON.parse(raw);}catch{this.clear(channelId);return null;}}
    if(value===null)return null;
    const saved=value as Partial<MusicResume>;
    if(!saved || saved.version!==1 || typeof saved.trackId!=="string" || !trackIds.includes(saved.trackId) || typeof saved.positionSeconds!=="number" || !Number.isFinite(saved.positionSeconds) || saved.positionSeconds<0){this.clear(channelId);return null;}
    return saved as MusicResume;
  }
  write(channelId:string,trackId:string,positionSeconds:number){
    if(!Number.isFinite(positionSeconds)||positionSeconds<0)return;
    const value:MusicResume={version:1,trackId,positionSeconds};this.memory.set(channelId,value);
    try{this.storage()?.setItem(this.key(channelId),JSON.stringify(value));}catch{/* Playback is independent of storage availability. */}
  }
  clear(channelId:string){this.memory.delete(channelId);try{this.storage()?.removeItem(this.key(channelId));}catch{}}
}
export const musicResumeStore=new MusicResumeStore();

// Evaluated by the engine only after real media metadata is available.
export function validateResumePosition(index:number,position:number,duration:number,trackCount:number){
  if(!Number.isFinite(duration)||duration<=0||!Number.isFinite(position)||position<0||position>duration)return {index:0,position:0,invalid:true};
  if(position>0&&duration-position<=RESUME_NEAR_END_SECONDS)return {index:(index+1)%trackCount,position:0,invalid:false};
  return {index,position,invalid:false};
}
