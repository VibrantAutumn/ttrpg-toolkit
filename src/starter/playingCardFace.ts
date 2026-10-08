/** Draws the face of a playing card on a canvas, so no picture files are needed. */

const WIDTH = 360;
const HEIGHT = 504;
const RED = "#c92a2a";
const BLACK = "#212529";

// The "︎" asks for the plain text version of the symbol (not a coloured emoji).
const SYMBOLS: Record<string, string> = {
  spades: "♠︎",
  hearts: "♥︎",
  diamonds: "♦︎",
  clubs: "♣︎",
};

const RANK_LABELS: Record<string, string> = { a: "A", j: "J", q: "Q", k: "K" };

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, color: string): void {
  ctx.fillStyle = color;
  ctx.font = `bold ${size}px Georgia, "Times New Roman", serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(value, x, y);
}

/** One corner's rank and suit; called twice, the second time upside-down in the opposite corner. */
function cornerIndex(ctx: CanvasRenderingContext2D, rank: string, symbol: string, color: string): void {
  text(ctx, rank, 48, 60, rank.length > 1 ? 44 : 52, color);
  text(ctx, symbol, 48, 112, 44, color);
}

/**
 * The face for a card key like `spades-a`, `hearts-10` or `joker-red`. Returns a
 * canvas with transparent corners, ready to be shrunk and saved as the card's picture.
 */
export function drawPlayingCardFace(key: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This device can't draw pictures.");

  roundedRect(ctx, 6, 6, WIDTH - 12, HEIGHT - 12, 30);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#adb5bd";
  ctx.stroke();

  const [first, second] = key.split("-");
  if (first === "joker") {
    const color = second === "red" ? RED : BLACK;
    text(ctx, "★", WIDTH / 2, HEIGHT / 2 - 20, 200, color);
    text(ctx, "JOKER", WIDTH / 2, HEIGHT / 2 + 110, 56, color);
    text(ctx, "★", 48, 62, 44, color);
    ctx.save();
    ctx.translate(WIDTH, HEIGHT);
    ctx.rotate(Math.PI);
    text(ctx, "★", 48, 62, 44, color);
    ctx.restore();
    return canvas;
  }

  const symbol = SYMBOLS[first] ?? "?";
  const color = first === "hearts" || first === "diamonds" ? RED : BLACK;
  const rank = RANK_LABELS[second] ?? second.toUpperCase();

  cornerIndex(ctx, rank, symbol, color);
  ctx.save();
  ctx.translate(WIDTH, HEIGHT);
  ctx.rotate(Math.PI);
  cornerIndex(ctx, rank, symbol, color);
  ctx.restore();

  if (second === "j" || second === "q" || second === "k") {
    text(ctx, second.toUpperCase(), WIDTH / 2, HEIGHT / 2 - 30, 190, color);
    text(ctx, symbol, WIDTH / 2, HEIGHT / 2 + 110, 90, color);
  } else {
    text(ctx, symbol, WIDTH / 2, HEIGHT / 2, 200, color);
  }
  return canvas;
}
