import { bytesToBase64 } from "../base64";

/** Longest side, in pixels, of a card's picture and of its list thumbnail. */
export const FULL_MAX = 600;
export const THUMB_MAX = 200;

export interface Size {
  width: number;
  height: number;
}

/**
 * The size to draw a picture at so its longest side is at most `max`, keeping
 * its shape. A picture that already fits is not enlarged. Whole pixels, at least 1.
 */
export function fitWithin(width: number, height: number, max: number): Size {
  if (![width, height, max].every((n) => Number.isFinite(n) && n > 0)) {
    throw new RangeError("fitWithin needs positive sizes");
  }
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** A card picture ready to send to Rust (base64 text, already shrunk). */
export interface PreparedImage {
  mime: string;
  image: string;
  thumb: string;
}

/**
 * Shrinks a picture file for use on a card: a full-size copy and a thumbnail,
 * both re-encoded as WebP (which keeps transparency). The browser does the
 * decoding and resizing, so no image library is needed, and a huge phone photo
 * becomes a few dozen kilobytes. Throws if the file isn't a picture the
 * WebView can read.
 */
export async function prepareCardImage(file: Uint8Array): Promise<PreparedImage> {
  // Copy into a plain ArrayBuffer so the Blob owns its bytes.
  const source = new Blob([file.slice().buffer]);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source);
  } catch {
    throw new Error("That file isn't a picture this app can read. Try a JPEG, PNG or WebP.");
  }
  try {
    const full = await encode(bitmap, FULL_MAX, 0.85);
    const thumb = await encode(bitmap, THUMB_MAX, 0.8, full.type);
    return {
      mime: full.type,
      image: bytesToBase64(new Uint8Array(await full.arrayBuffer())),
      thumb: bytesToBase64(new Uint8Array(await thumb.arrayBuffer())),
    };
  } finally {
    bitmap.close();
  }
}

/** Draws the picture at most `max` pixels on its longest side and encodes it. */
async function encode(bitmap: ImageBitmap, max: number, quality: number, mime?: string): Promise<Blob> {
  const { width, height } = fitWithin(bitmap.width, bitmap.height, max);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This device can't resize pictures.");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, mime ?? "image/webp", quality),
  );
  if (!blob) throw new Error("The picture couldn't be resized.");
  // A browser that can't write WebP quietly writes PNG instead; that is fine, but
  // the thumbnail must match the full picture's type.
  if (mime && blob.type !== mime) throw new Error("The picture couldn't be resized.");
  return blob;
}
