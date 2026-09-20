import V2Player from "./V2Player";
import s from "./v2.module.css";
import { toPlayerCatalog } from "./catalog";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sound Spa 2",
};

export default async function SoundSpaV2Page() {
  try {
    // Lazy import keeps missing runtime configuration inside this failure boundary
    // and avoids any DB connection during the production build.
    const { getPublishedContentCatalog } = await import("../../db/v2/queries/content");
    const catalog = toPlayerCatalog(await getPublishedContentCatalog());
    if (!catalog.some((c) => c.kind === "music" && c.tracks.length)) throw new Error("No playable catalog");
    return <V2Player catalog={catalog} />;
  } catch {
    console.error("SoundSpa V2 catalog loading failed");
    return <div className={s.shell}><header className={s.header}><div className={s.brand}>Sound Spa 2</div></header><main className={s.main}><section className={s.hero} role="alert"><h1 className={s.channelName}>Catalog unavailable</h1><p>Unable to load the music catalog. Please try again later.</p></section></main></div>;
  }
}
