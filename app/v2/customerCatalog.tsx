"use client";
import { useEffect, useState } from "react";
import V2Player from "./V2Player";
import type { PlayerChannel } from "./catalog";
import s from "./v2.module.css";
type ApiChannel = { id:string; slug:string; displayName:string; kind:"music"|"ambient"; description:string|null; imageUrl:string|null; playable:boolean; accessSources:string[]; accessExpiries:Record<string,string>; tracks:Array<{id:string;url:string;sizeBytes:string;originalFilename?:string}> };
export default function CustomerCatalogPlayer() { const [state,setState]=useState<{status:"loading"|"ready"|"unauthorized"|"error";catalog?:PlayerChannel[]}>({status:"loading"});
  useEffect(()=>{ fetch("/api/v2/catalog",{credentials:"same-origin",cache:"no-store"}).then(async r=>{ if(r.status===401){setState({status:"unauthorized"});return;} if(!r.ok) throw new Error("catalog"); const data=await r.json() as {channels:ApiChannel[]}; setState({status:"ready",catalog:data.channels.map(c=>({id:c.id,slug:c.slug,kind:c.kind,title:c.displayName,mood:c.description??"",image:c.imageUrl,playable:c.playable,accessSources:c.accessSources,accessExpiries:c.accessExpiries,tracks:c.tracks}))}); }).catch(()=>setState({status:"error"})); },[]);
  if(state.status==="loading") return <div className={s.shell}><main className={s.main}><section className={s.hero}><h1 className={s.channelName}>Loading catalog</h1></section></main></div>;
  if(state.status==="unauthorized") return <div className={s.shell}><main className={s.main}><section className={s.hero} role="alert"><h1 className={s.channelName}>Device setup required</h1><p>This player is not authorized for a V2 device.</p></section></main></div>;
  if(state.status==="error"||!state.catalog) return <div className={s.shell}><main className={s.main}><section className={s.hero} role="alert"><h1 className={s.channelName}>Catalog unavailable</h1><p>Unable to load the customer catalog.</p></section></main></div>;
  return <V2Player catalog={state.catalog}/>;
}
