import assert from "node:assert/strict";
import { setMaxListeners } from "node:events";
import { Mp3Engine, Mp3Track } from "../../app/lib/audio/mp3Engine";
import { MusicSessionCache } from "../../app/lib/audio/musicSessionCache";
import { MusicResumeStore, validateResumePosition } from "../../app/lib/audio/musicResumeStore";

class MemoryStorage {
  values=new Map<string,string>(); writes=0;
  getItem=(key:string)=>this.values.get(key)??null;
  setItem=(key:string,value:string)=>{this.values.set(key,value);this.writes++;};
  removeItem=(key:string)=>{this.values.delete(key);};
}
class FakeAudio extends EventTarget {
  static duration=300;static reserve=300;static deferred:Promise<void>|null=null;static metadataReady=true;
  src="";preload="";muted=false;paused=true;currentTime=0;duration=FakeAudio.duration;
  readyState=0;networkState=1;ended=false;error=null;playCalls=0;pauseVersion=0;
  buffered={length:1,start:(_index:number)=>0,end:(_index:number)=>FakeAudio.reserve};
  load(){this.currentTime=0;this.pause();this.readyState=FakeAudio.metadataReady?1:0;}
  pause(){this.paused=true;this.pauseVersion++;}
  removeAttribute(_name:string){this.src="";}
  async play(){this.playCalls++;const pauseVersion=this.pauseVersion;if(FakeAudio.deferred)await FakeAudio.deferred;if(pauseVersion!==this.pauseVersion)return;this.paused=false;this.dispatchEvent(new Event("playing"));}
}
const browser=new EventTarget();
const storage=new MemoryStorage();Object.assign(browser,{localStorage:storage});
Object.defineProperty(globalThis,"window",{value:browser,configurable:true});
Object.defineProperty(globalThis,"Audio",{value:FakeAudio,configurable:true});
Object.defineProperty(globalThis,"HTMLMediaElement",{value:{HAVE_METADATA:1,HAVE_FUTURE_DATA:3,NETWORK_LOADING:2},configurable:true});
Object.defineProperty(globalThis,"document",{value:Object.assign(new EventTarget(),{visibilityState:"visible"}),configurable:true});
setMaxListeners(0,browser,document as unknown as EventTarget); // The harness retains multiple engines until finally; the UI uses one.
const tracks:Mp3Track[]=[{id:"a",url:"/music/a.mp3"},{id:"b",url:"/music/b.mp3"},{id:"c",url:"/music/c.mp3"}];
const store=new MusicResumeStore(()=>storage);
const engines:Mp3Engine[]=[];
const make=(channel:string,list:Mp3Track[]=tracks,cache=new MusicSessionCache())=>{const e=new Mp3Engine(list,cache,{channelId:channel,store});engines.push(e);return e;};
type Internal={audio:FakeAudio;phase:string;startNetworkTrack:(index:number,recover:boolean,position:number)=>Promise<void>;handoffToBlob:(slot:0|1)=>Promise<void>;handleEnded:()=>Promise<void>;evaluateBufferState:()=>void;saveResume:(force:boolean)=>void};
const internal=(e:Mp3Engine)=>e as unknown as Internal;
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const advance=(e:Mp3Engine,position:number)=>{internal(e).audio.currentTime=position;internal(e).evaluateBufferState();};

async function main(){try{
  const first=make("channel-one");await first.play();await flush();advance(first,73);first.pause();
  assert.equal(store.read("channel-one",tracks.map(t=>t.id))?.positionSeconds,73);first.dispose();
  const returned=make("channel-one");await returned.play();await flush();assert.equal(internal(returned).audio.currentTime,73);
  const second=make("channel-two");await second.play();await flush();advance(second,41);second.dispose();
  assert.equal(store.read("channel-one",["a","b","c"])?.positionSeconds,73);assert.equal(store.read("channel-two",["a","b","c"])?.positionSeconds,41);
  // A new store simulates JS/page recreation, with only persistent storage retained.
  const recreatedStore=new MusicResumeStore(()=>storage);
  const recreated=new Mp3Engine(tracks,new MusicSessionCache(),{channelId:"channel-one",store:recreatedStore});engines.push(recreated);await recreated.play();await flush();assert.equal(internal(recreated).audio.currentTime,73);
  store.write("multi","b",120);const multi=make("multi");await multi.play();await flush();assert.equal(multi.getSnapshot().currentTrackIndex,1);assert.equal(internal(multi).audio.currentTime,120);
  await internal(multi).startNetworkTrack(1,true,120);await flush();assert.equal(internal(multi).audio.currentTime,120);assert.equal(multi.getSnapshot().currentTime,120);
  store.write("deleted","gone",90);const deleted=make("deleted");await deleted.play();await flush();assert.equal(deleted.getSnapshot().currentTrackIndex,0);assert.equal(internal(deleted).audio.currentTime,0);
  for(const raw of ["{bad",JSON.stringify({version:99,trackId:"a",positionSeconds:12}),JSON.stringify({version:1,trackId:"a",positionSeconds:-1}),JSON.stringify({version:1,trackId:"a",positionSeconds:"12"})]){
    storage.values.set("soundspa:v2:music-resume:v1:corrupt",raw);assert.equal(new MusicResumeStore(()=>storage).read("corrupt",["a"]),null);
  }
  const denied=new MusicResumeStore(()=>({getItem(){throw new Error("denied");},setItem(){throw new Error("denied");},removeItem(){throw new Error("denied");}}));denied.write("private","a",45);assert.equal(denied.read("private",["a"])?.positionSeconds,45);
  store.write("near","a",295);const near=make("near");await near.play();await flush();assert.equal(near.getSnapshot().currentTrackIndex,1);assert.equal(internal(near).audio.currentTime,0);assert.equal(store.read("near",["a","b","c"])?.trackId,"b");
  store.write("single","a",295);const single=make("single",[tracks[0]]);await single.play();await flush();assert.equal(internal(single).audio.currentTime,0);
  store.write("outside","b",900);const outside=make("outside");await outside.play();await flush();assert.equal(outside.getSnapshot().currentTrackIndex,0);assert.equal(internal(outside).audio.currentTime,0);
  const normal=make("ended");await normal.play();await flush();advance(normal,299);internal(normal).audio.currentTime=300;internal(normal).audio.dispatchEvent(new Event("ended"));await flush();assert.equal(normal.getSnapshot().currentTrackIndex,1);assert.deepEqual(store.read("ended",["a","b","c"]),{version:1,trackId:"b",positionSeconds:0});
  const nextPlaying=make("next-playing");await nextPlaying.play();await flush();nextPlaying.next();await flush();assert.equal(nextPlaying.getSnapshot().currentTrackIndex,1);assert.equal(nextPlaying.getSnapshot().status,"playing");
  const nextPaused=make("next-paused");nextPaused.next();await flush();assert.equal(nextPaused.getSnapshot().currentTrackIndex,1);assert.equal(nextPaused.getSnapshot().status,"paused");await nextPaused.play();await flush();assert.equal(nextPaused.getSnapshot().currentTrackIndex,1);
  const oneTrack=make("next-single",[tracks[0]]);oneTrack.next();assert.equal(oneTrack.getSnapshot().currentTrackIndex,0);
  const fourTracks=[...tracks,{id:"d",url:"/music/d.mp3"}];const rapid=make("next-rapid",fourTracks);await rapid.play();await flush();rapid.next();rapid.next();rapid.next();await flush();assert.equal(rapid.getSnapshot().currentTrackIndex,3);assert.equal(rapid.getSnapshot().status,"playing");
  const cache=new MusicSessionCache();cache.put(tracks[0].url,new Blob(["complete"]));
  store.write("blob","a",85);const blob=make("blob",tracks,cache);await blob.play();await flush();assert.equal(blob.getSnapshot().sourceKind,"blob");assert.equal(internal(blob).audio.currentTime,85);
  const handoffCache=new MusicSessionCache();const handoff=make("handoff-actual",tracks,handoffCache);await handoff.play();await flush();advance(handoff,96);handoffCache.put(tracks[0].url,new Blob(["complete"]));(internal(handoff) as unknown as {restoreTrackFromSessionCache:(i:number)=>void}).restoreTrackFromSessionCache(0);await internal(handoff).handoffToBlob(0);await flush();assert.equal(handoff.getSnapshot().sourceKind,"blob");assert.equal(internal(handoff).audio.currentTime,96);
  // Startup remains threshold-driven; play resolution alone does not assert playing.
  FakeAudio.reserve=4;const buffering=make("buffering");await buffering.play();assert.equal(internal(buffering).audio.playCalls,0);assert.equal(buffering.getSnapshot().status,"loading");FakeAudio.reserve=5;internal(buffering).evaluateBufferState();await flush();assert.equal(internal(buffering).audio.playCalls,1);assert.equal(buffering.getSnapshot().status,"loading");advance(buffering,1);assert.equal(buffering.getSnapshot().status,"playing");FakeAudio.reserve=300;
  let resolve!:()=>void;FakeAudio.deferred=new Promise<void>(r=>{resolve=r;});const pending=make("pending");await pending.play();pending.pause();resolve();await flush();assert.equal(pending.getSnapshot().status,"paused");assert(internal(pending).audio.paused);FakeAudio.deferred=null;
  // Pause while Blob metadata is pending must preserve the intended seek, not zero.
  FakeAudio.metadataReady=false;store.write("pending-seek","a",88);const seeking=make("pending-seek",tracks,cache);const started=seeking.play();seeking.pause();assert.equal(store.read("pending-seek",["a"])?.positionSeconds,88);internal(seeking).audio.readyState=1;internal(seeking).audio.dispatchEvent(new Event("loadedmetadata"));await started;assert.equal(seeking.getSnapshot().status,"paused");assert.equal(internal(seeking).audio.currentTime,88);FakeAudio.metadataReady=true;
  const lifecycle=make("lifecycle");await lifecycle.play();await flush();advance(lifecycle,64);window.dispatchEvent(new Event("pagehide"));assert.equal(store.read("lifecycle",["a"])?.positionSeconds,64);
  FakeAudio.metadataReady=false;store.write("network-seek","b",112);const networkSeek=make("network-seek");const networkStarted=networkSeek.play();internal(networkSeek).audio.dispatchEvent(new Event("progress"));assert.equal(internal(networkSeek).audio.playCalls,0);networkSeek.pause();internal(networkSeek).audio.readyState=1;internal(networkSeek).audio.dispatchEvent(new Event("loadedmetadata"));await networkStarted;assert.equal(internal(networkSeek).audio.currentTime,112);assert.equal(networkSeek.getSnapshot().status,"paused");
  store.write("disposed-seek","a",92);const disposedSeek=make("disposed-seek");const disposeStarted=disposedSeek.play();const oldAudio=internal(disposedSeek).audio;disposedSeek.dispose();oldAudio.readyState=1;oldAudio.dispatchEvent(new Event("loadedmetadata"));await disposeStarted;assert.equal(oldAudio.playCalls,0);assert.equal(store.read("disposed-seek",["a"])?.positionSeconds,92);FakeAudio.metadataReady=true;
  const writes=storage.writes;for(let i=0;i<50;i++)internal(lifecycle).saveResume(false);assert.equal(storage.writes,writes);
  assert.deepEqual(validateResumePosition(1,120,300,3),{index:1,position:120,invalid:false});
  console.info("PASS: independent channel switch/page recreation; correct track; invalid/removed state; denied storage; metadata duration/near-end; ended persistence; recovery/handoff preserve seek; original 5s startup/progression gate; Pause wins over pending play/seek; pagehide; write throttling.");
 }finally{for(const e of engines)e.dispose();}}
main().catch(e=>{console.error(e);process.exitCode=1;});
