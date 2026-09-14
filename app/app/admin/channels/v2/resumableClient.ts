export type UploadStatus={uploadId:string;offset:number;expectedSize:number;state:"uploading"|"ready"|"finalizing"|"completed"|"failed"|"expired";error?:string;trackId?:string};
type Transport=(method:string,url:string,body:Blob|string|null,headers:Record<string,string>,timeout:number)=>Promise<UploadStatus>;
const endpoint="/api/v2/admin/content/uploads";
export class UploadResponseError extends Error{constructor(message:string,public status:number){super(message);}}
export const transport:Transport=(method,url,body,headers,timeout)=>new Promise((resolve,reject)=>{
 const xhr=new XMLHttpRequest();xhr.open(method,url);xhr.timeout=timeout;
 for(const [key,value] of Object.entries(headers))xhr.setRequestHeader(key,value);
 xhr.onload=()=>{try{const value=JSON.parse(xhr.responseText);if(xhr.status>=200&&xhr.status<300)resolve(value);else reject(new UploadResponseError(value.error??"Upload request rejected.",xhr.status));}catch{reject(new Error("Upload response unreadable; reconnecting."));}};
 xhr.onerror=()=>reject(new Error("Connection interrupted; reconnecting."));xhr.ontimeout=()=>reject(new Error("Chunk request timed out; reconnecting."));xhr.send(body);
});
export async function resumeMp3Upload(file:File,channelId:string,uploadId:string,report:(progress:number,message:string)=>void,paused:()=>boolean,send:Transport=transport,sleep:(ms:number)=>Promise<void>=ms=>new Promise(r=>setTimeout(r,ms))){
 const url=`${endpoint}?uploadId=${encodeURIComponent(uploadId)}`;
 let status:UploadStatus|undefined;let failures=0;
 while(!paused()){
  try{
   // Status is authoritative even if a prior chunk/finalize response was lost.
   if(!status){
    try{status=await send("GET",url,null,{},15000);}
    catch(e){if(!(e instanceof UploadResponseError)||e.status!==404)throw e;
     status=await send("POST",endpoint,JSON.stringify({uploadId,channelId,originalFilename:file.name,expectedSize:file.size,contentType:"audio/mpeg"}),{"Content-Type":"application/json"},15000);
    }
   }
   if(status.expectedSize!==file.size)throw new UploadResponseError("Selected file differs from upload session.",409);
   if(status.state==="completed"){report(100,"Completed.");return true;}
   if(status.state==="failed"||status.state==="expired")throw new UploadResponseError(status.error??`Upload ${status.state}.`,status.state==="expired"?410:422);
   if(paused())break;
   report(Math.round(status.offset/file.size*100),status.state==="finalizing"?"Validating…":"Resuming / uploading…");
   if(status.state==="finalizing"){
    // A live finalizer may outlast the browser request. Poll, never submit a
    // competing finalizer; a process-restart status exposes 'ready' instead.
    await sleep(2000);status=undefined;continue;
   }
   if(status.offset===file.size){status=await send("POST",`${url}&action=finalize`,null,{},180000);}
   else{
    if(!Number.isSafeInteger(status.offset)||status.offset<0||status.offset>file.size)throw new UploadResponseError("Invalid server offset.",422);
    const chunk=file.slice(status.offset,Math.min(file.size,status.offset+512*1024));
    status=await send("PATCH",`${url}&offset=${status.offset}`,chunk,{"Content-Type":"application/octet-stream","X-Upload-Size":String(file.size),"X-Upload-Filename":encodeURIComponent(file.name),"X-Chunk-Size":String(chunk.size)},120000);
   }
   failures=0;
  }catch(e){
   if(e instanceof UploadResponseError&&[400,401,403,404,410,413,415,422].includes(e.status))throw e;
   failures++;status=undefined;report(-1,`Reconnecting (${failures}); confirmed bytes are retained.`);
   if(failures>=5){report(-1,"Paused: connection unavailable. Resume continues from server offset.");return false;}
   await sleep([2000,5000,10000,20000][Math.min(failures-1,3)]);
  }
 }
 report(-1,"Paused. Confirmed bytes retained; Resume continues this session.");return false;
}
export function sessionStorageKey(channelId:string,file:Pick<File,"name"|"size"|"lastModified">){return `soundspa-v2-upload-v1:${channelId}:${file.name}:${file.size}:${file.lastModified}`;}
