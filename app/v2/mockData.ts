export interface V2MusicChannel {
  id: string;
  title: string;
  mood: string;
  image: string;
}

export interface V2AmbientChannel {
  id: string;
  title: string;
  image: string;
}

export const MUSIC_CHANNELS: V2MusicChannel[] = [
  {
    id: "divnitsa",
    title: "Divnitsa",
    mood: "Deep relaxation",
    image: "/channel-divnitsa_v2.jpg",
  },
  {
    id: "relax",
    title: "Relax",
    mood: "Calm and restorative",
    image: "/channel-1.jpg",
  },
  {
    id: "432-hz",
    title: "432 Hz",
    mood: "Soft and meditative",
    image: "/channel-432.jpg",
  },
];

export const AMBIENT_CHANNELS: V2AmbientChannel[] = [
  { id: "forest", title: "Forest", image: "/noise-forest.jpg" },
  { id: "night", title: "Night", image: "/noise-night.jpg" },
  { id: "sea", title: "Sea", image: "/noise-sea.jpg" },
];
