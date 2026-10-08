import { prepareBundledImage, prepareCanvasImage, type PreparedImage } from "../lib/cards/image";
import { buildPlayingCards, buildTarokka, type StarterDef } from "../lib/cards/starters";
import tarokkaData from "./tarokka/cards.json";
import { drawPlayingCardFace } from "./playingCardFace";

/** A ready-made deck the app carries with it. */
export interface StarterDeck {
  def: StarterDef;
  /** One line shown beside the "Add" button. */
  description: string;
  /** Loads or draws every card's picture, reporting progress, keyed by card key. */
  makeImages(onProgress: (done: number, total: number) => void): Promise<Map<string, PreparedImage>>;
}

/** The shrunk Tarokka pictures that are part of the app, by card key. */
const tarokkaPictures = import.meta.glob("./tarokka/images/*.webp", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

const tarokka: StarterDeck = {
  def: buildTarokka(tarokkaData),
  description: "The 54 Curse of Strahd fortune-telling cards, with pictures and what each one means.",
  async makeImages(onProgress) {
    const images = new Map<string, PreparedImage>();
    const entries = Object.entries(tarokkaPictures);
    for (const [path, url] of entries) {
      const key = path.split("/").pop()!.replace(/\.webp$/, "");
      const response = await fetch(url);
      if (!response.ok) throw new Error("A bundled card picture couldn't be loaded.");
      images.set(key, await prepareBundledImage(new Uint8Array(await response.arrayBuffer()), "image/webp"));
      onProgress(images.size, entries.length);
    }
    return images;
  },
};

const playingCards: StarterDeck = {
  def: buildPlayingCards(),
  description: "A standard 52-card deck in four suits, plus two jokers, drawn by the app.",
  async makeImages(onProgress) {
    const images = new Map<string, PreparedImage>();
    const keys = playingCards.def.cards.map((c) => c.key);
    for (const key of keys) {
      images.set(key, await prepareCanvasImage(drawPlayingCardFace(key)));
      onProgress(images.size, keys.length);
    }
    return images;
  },
};

/** Every starter deck, in the order they are offered. Add new ones here. */
export const STARTER_DECKS: readonly StarterDeck[] = [tarokka, playingCards];
