"use client";
import { useEffect, useState } from "react";
import V2Player from "./V2Player";
import type { PlayerChannel } from "./catalog";
import s from "./v2.module.css";
import type { CustomerCatalogChannel } from "@/lib/v2/customerCatalog";
import { I18nProvider, useI18n } from "../i18n/I18nProvider";
export type ApiChannel = CustomerCatalogChannel;
type CatalogState = {status:"loading"|"ready"|"unauthorized"|"error";catalog?:PlayerChannel[];organizationName?:string;locationName?:string};
function toPlayerChannels(channels: ApiChannel[]): PlayerChannel[] { return channels.map(c=>({id:c.id,slug:c.slug,kind:c.kind,title:c.displayName,mood:c.description??"",image:c.imageUrl,playable:c.playable,accessSources:c.accessSources,accessExpiries:c.accessExpiries,tracks:c.tracks})); }
function CustomerCatalogPlayerContent({ initialCatalog, organizationName: initialOrganizationName, locationName: initialLocationName, monitoringEnabled = false }: { initialCatalog?: ApiChannel[]; organizationName?: string; locationName?: string; monitoringEnabled?: boolean }) {
  const { t } = useI18n();
  const [state,setState]=useState<CatalogState>(()=>initialCatalog ? {status:"ready",catalog:toPlayerChannels(initialCatalog),organizationName:initialOrganizationName,locationName:initialLocationName} : {status:"loading"});
  useEffect(()=>{ if (initialCatalog) return; fetch("/api/v2/catalog",{credentials:"same-origin",cache:"no-store"}).then(async r=>{ if(r.status===401){setState({status:"unauthorized"});return;} if(!r.ok) throw new Error("catalog"); const data=await r.json() as {organizationName:string;locationName:string;channels:ApiChannel[]}; if(typeof data.organizationName!=="string"||!data.organizationName.trim()||typeof data.locationName!=="string"||!data.locationName.trim()) throw new Error("customer branding"); setState({status:"ready",catalog:toPlayerChannels(data.channels),organizationName:data.organizationName,locationName:data.locationName}); }).catch(()=>setState({status:"error"})); },[initialCatalog]);
  if(state.status==="loading") return <div className={s.shell}><main className={s.main}><section className={s.hero}><h1 className={s.channelName}>{t("loadingCatalog")}</h1></section></main></div>;
  if(state.status==="unauthorized") return <div className={s.shell}><main className={s.main}><section className={s.hero} role="alert"><h1 className={s.channelName}>{t("deviceSetupRequired")}</h1><p>{t("unauthorizedDevice")}</p></section></main></div>;
  if(state.status==="error"||!state.catalog) return <div className={s.shell}><main className={s.main}><section className={s.hero} role="alert"><h1 className={s.channelName}>{t("catalogUnavailable")}</h1><p>{t("unableToLoadCatalog")}</p></section></main></div>;
  return <V2Player catalog={state.catalog} organizationName={state.organizationName} locationName={state.locationName} monitoringEnabled={monitoringEnabled}/>;
}
export default function CustomerCatalogPlayer(props: { initialCatalog?: ApiChannel[]; organizationName?: string; locationName?: string; monitoringEnabled?: boolean }) { return <I18nProvider><CustomerCatalogPlayerContent {...props} /></I18nProvider>; }
