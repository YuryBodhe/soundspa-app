// Static config for ambient/noise channels (MVP without DB integration)

export interface NoiseChannelConfig {
  id: string;
  slug: string;
  title: string;
  src: string;
  order: number;
  image?: string; // optional background image for card UI
}

export const NOISE_CHANNELS: NoiseChannelConfig[] = [
  {
    id: "forest",
    slug: "forest",
    title: "Forest ambience",
    src: "/noise/forest.mp3",
    order: 1,
    image: "/noise-forest.jpg",
  },
  {
    id: "sea",
    slug: "sea",
    title: "Sea ambience",
    src: "/noise/sea.mp3",
    order: 2,
    image: "/noise-sea.jpg",
  },
  {
    id: "night",
    slug: "night",
    title: "Night ambience",
    src: "/noise/night.mp3",
    order: 3,
    image: "/noise-night.jpg",
  },
];
