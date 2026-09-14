"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Item = {file:File;status:"waiting"|"uploading"|"success"|"failed";progress:number;message?:string};
export function UploadControls({channelId,kind}:{channelId:string;kind:"track"|"artwork"}) {
  const [items,setItems] = useState<Item[]>([]); const [busy,setBusy] = useState(false);
  const router = useRouter();
  const update = (index:number,patch:Partial<Item>)=>setItems((previous)=>previous.map((item,i)=>i===index?{...item,...patch}:item));
  const upload = async()=>{
    setBusy(true);
    try {
      for (let index=0;index<items.length;index++) {
        const item=items[index]; if (item.status === "success") continue;
        update(index,{status:"uploading",progress:0,message:undefined});
        try {
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
        } catch(error) {update(index,{status:"failed",message:error instanceof Error?error.message:"Upload failed."});}
      }
    } finally {setBusy(false);router.refresh();}
  };
  return <div><input type="file" disabled={busy} multiple={kind==="track"} accept={kind==="track"?".mp3,audio/mpeg":"image/jpeg,image/png"}
    aria-label={kind==="track"?"Select MP3 tracks":"Select channel artwork"}
    onChange={(event)=>setItems(Array.from(event.currentTarget.files??[]).map((file)=>({file,status:"waiting",progress:0})))} />
    <button type="button" className="btn" disabled={busy||!items.length} onClick={()=>void upload()}>{kind==="track"?"Upload selected tracks":"Upload / replace artwork"}</button>
    <p className="text-dim">{kind==="track"?"MP3 up to 128 MiB per file. Sequential queue; validation continues after transfer reaches 100%.":"JPEG/PNG up to 10 MiB, 64–4096 px; normalized to JPEG. Old artwork is retained."}</p>
    <ul aria-live="polite">{items.map((item,index)=><li key={index}>{item.file.name}: {item.status}{item.status==="uploading"?` ${item.progress}%`:""}{item.message?` — ${item.message}`:""}</li>)}</ul>
  </div>;
}
