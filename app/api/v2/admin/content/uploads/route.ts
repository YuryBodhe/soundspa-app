import { operatorAuthStatus, operatorAuthResponse, isSameOriginMutation } from "../../../../../../lib/v2/adminOperator";
import { createUploadSession, uploadSessionStatus, acceptUploadChunk, finalizeUploadSession } from "../../../../../../lib/v2/resumableUpload";
import { UploadError } from "../../../../../../lib/v2/mediaStorage";
import { revalidatePath } from "next/cache";
export const runtime="nodejs";
function protect(r:Request,mutation:boolean){const status=operatorAuthStatus(r.headers.get("authorization"));if(status!==200)return operatorAuthResponse(status);if(mutation&&!isSameOriginMutation(r))return new Response("Same-origin request required.",{status:403});}
function result(value:unknown,status=200){return Response.json(value,{status,headers:{"Cache-Control":"no-store"}});}
async function action(r:Request,mutation:boolean,fn:()=>Promise<unknown>){
 const denied=protect(r,mutation);if(denied)return denied;
 try{return result(await fn());}catch(e){if(e instanceof UploadError)return result({error:e.message},e.status);console.error("[V2ResumableUpload] request-failed",{uploadId:new URL(r.url).searchParams.get("uploadId")});return result({error:"Upload operation failed; query upload status before retrying."},503);}
}
export async function GET(r:Request){return action(r,false,()=>uploadSessionStatus(new URL(r.url).searchParams.get("uploadId")??""));}
export async function POST(r:Request){return action(r,true,async()=>{
 const url=new URL(r.url);
 if(url.searchParams.get("action")==="finalize"){
  const s=await finalizeUploadSession(url.searchParams.get("uploadId")??"");
  try{revalidatePath("/app/admin/channels/v2");}catch{console.error("[V2ResumableUpload] admin-refresh-required");}
  return s;
 }
 if(!r.headers.get("content-type")?.startsWith("application/json"))throw new UploadError("JSON session metadata required.",415);
 if(Number(r.headers.get("content-length"))>4096)throw new UploadError("Session metadata too large.",413);
 const body=await r.text();if(body.length>4096)throw new UploadError("Session metadata too large.",413);
 return createUploadSession(JSON.parse(body));
});}
export async function PATCH(r:Request){return action(r,true,()=>{
 if(r.headers.get("content-encoding")&&r.headers.get("content-encoding")!=="identity")throw new UploadError("Encoded chunks not accepted.",415);
 const url=new URL(r.url);const offset=url.searchParams.get("offset");
 if(offset===null||!/^\d+$/.test(offset))throw new UploadError("Invalid offset.",400);
 return acceptUploadChunk(url.searchParams.get("uploadId")??"",Number(offset),r);
});}
