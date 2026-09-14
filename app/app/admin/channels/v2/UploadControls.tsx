"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { resumeMp3Upload, sessionStorageKey, UploadResponseError } from "./resumableClient";

type Item = {file:File;status:"waiting"|"uploading"|"paused"|"success"|"failed";progress:number;message?:string;uploadId?:string};
export function UploadControls({channelId,kind}:{channelId:string;kind:"track"|"artwork"}) {
  const [items,setItems] = useState<Item[]>([]); const [busy,setBusy] = useState(false);
  const router = useRouter();
  const pauseRequested=useRef(false);
  const update = (index:number,patch:Partial<Item>)=>setItems((previous)=>previous.map((item,i)=>i===index?{...item,...patch}:item));
  const upload = async()=>{
    setBusy(true);
    pauseRequested.current=false;
    try {
      for (let index=0;index<items.length;index++) {
        const item=items[index]; if (item.status === "success") continue;
        update(index,{status:"uploading",progress:0,message:undefined});
        try {
          if(kind==="track"){
            const key=sessionStorageKey(channelId,item.file);let uploadId=item.uploadId;
            try{uploadId??=localStorage.getItem(key)??undefined;}catch{}
            uploadId??=crypto.randomUUID();update(index,{uploadId});
            try{localStorage.setItem(key,uploadId);}catch{}
            const completed=await resumeMp3Upload(item.file,channelId,uploadId,(progress,message)=>update(index,{...progress>=0?{progress}:{},message}),()=>pauseRequested.current);
            if(!completed){update(index,{status:"paused"});break;}
            update(index,{status:"success",progress:100});try{localStorage.removeItem(key);}catch{}router.refresh();continue;
          }
          await new Promise<void>((resolve,reject)=>{
            const request=new XMLHttpRequest();
            request.open("POST",`/api/v2/admin/content/upload?channelId=${encodeURIComponent(channelId)}&kind=${kind}`);
            request.setRequestHeader("Content-Type","application/octet-stream");
            request.setRequestHeader("X-Upload-Filename",encodeURIComponent(item.file.name));
            request.setRequestHeader("X-Upload-Size",String(item.file.size));
            request.timeout=20*60*1000;
            request.upload.onprogress=(event)=>{if(event.lengthComputable)update(index,{progress:Math.round(100*event.loaded/event.total)});};
            request.onload=()=>{if(request.status===201)resolve();else {let message="Upload failed.";try{message=JSON.parse(request.responseText).error??message;}catch{}reject(new Error(message));}};
            request.onerror=()=>reject(new Error("Connection failed. Confirm the Admin track list before retrying; the result may be ambiguous."));
            request.ontimeout=()=>reject(new Error("Upload timed out. Confirm the Admin track list before retrying."));
            request.send(item.file);
          });
          update(index,{status:"success",progress:100}); router.refresh();
        } catch(error) {
          if(error instanceof UploadResponseError&&error.status===410){try{localStorage.removeItem(sessionStorageKey(channelId,item.file));}catch{}update(index,{uploadId:undefined});}
          update(index,{status:"failed",message:error instanceof Error?error.message:"Upload failed."});
        }
      }
    } finally {setBusy(false);router.refresh();}
  };
  return <div><input type="file" disabled={busy} multiple={kind==="track"} accept={kind==="track"?".mp3,audio/mpeg":"image/jpeg,image/png"}
    aria-label={kind==="track"?"Select MP3 tracks":"Select channel artwork"}
    onChange={(event)=>setItems(Array.from(event.currentTarget.files??[]).map((file)=>({file,status:"waiting",progress:0})))} />
    <button type="button" className="btn" disabled={busy||!items.length} onClick={()=>void upload()}>{kind==="track"?"Upload / Resume selected tracks":"Upload / replace artwork"}</button>
    {kind==="track"&&busy&&<button type="button" className="btn" onClick={()=>{pauseRequested.current=true;}}>Pause after current chunk</button>}
    <p className="text-dim">{kind==="track"?"MP3 up to 128 MiB. Resumable sequential queue; confirmed bytes retained for 24 hours. After reload, reselect the same file to resume. Validation follows transfer.":"JPEG/PNG up to 10 MiB, 64–4096 px; normalized to JPEG. Old artwork is retained."}</p>
    <ul aria-live="polite">{items.map((item,index)=><li key={index}>{item.file.name}: {item.status}{item.status==="uploading"?` ${item.progress}%`:""}{item.message?` — ${item.message}`:""}</li>)}</ul>
  </div>;
}
