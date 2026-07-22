// Screenshot cropping. `webview.capturePage()` returns the visible viewport at
// DEVICE pixels, while the guest reports boxes in CSS pixels — so every crop has
// to be scaled by the ratio between the two. Deriving that ratio from the image
// width (rather than trusting devicePixelRatio) also absorbs page zoom.

import type { Box } from "../../shared/types.js";

/** Load a data: URL into an <img>. */
function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("could not decode screenshot"));
    img.src = dataUrl;
  });
}

/** Crop `box` (CSS px, measured in a `vw`-wide viewport) out of a viewport shot.
 *  `pad` grows the crop so an element isn't cut flush to its own border. */
export async function cropShot(
  pageShot: string, box: Box, vw: number, pad = 8,
): Promise<string> {
  const img = await loadImage(pageShot);
  const scale = vw > 0 ? img.naturalWidth / vw : 1;

  const x = Math.max(0, Math.round((box.x - pad) * scale));
  const y = Math.max(0, Math.round((box.y - pad) * scale));
  const w = Math.min(img.naturalWidth - x, Math.round((box.w + pad * 2) * scale));
  const h = Math.min(img.naturalHeight - y, Math.round((box.h + pad * 2) * scale));
  if (w <= 0 || h <= 0) return pageShot;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return pageShot;
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
  return canvas.toDataURL("image/png");
}

/** Draw the clay highlight box onto a full-viewport shot so the attached image
 *  points at the defect on its own, without needing the ticket text. */
export async function annotateShot(
  pageShot: string, boxes: Array<{ box: Box; id: number }>, vw: number,
): Promise<string> {
  const img = await loadImage(pageShot);
  const scale = vw > 0 ? img.naturalWidth / vw : 1;
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return pageShot;
  ctx.drawImage(img, 0, 0);

  for (const { box, id } of boxes) {
    const x = box.x * scale, y = box.y * scale, w = box.w * scale, h = box.h * scale;
    ctx.strokeStyle = "#E54D2E";
    ctx.lineWidth = Math.max(2, 2 * scale);
    ctx.strokeRect(x, y, w, h);

    // Numbered badge, kept on-canvas even when the box starts at the very edge.
    const r = 11 * scale;
    const cx = Math.max(r, x), cy = Math.max(r, y);
    ctx.fillStyle = "#E54D2E";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${13 * scale}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(id), cx, cy);
  }
  return canvas.toDataURL("image/png");
}
