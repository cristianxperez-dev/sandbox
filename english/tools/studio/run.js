/* Studio driver: window.RENDER(name, style) → { url, anchors, w, h } for the Playwright exporter (english/tools/render-figs.cjs). */
import { renderInk, anchors as project } from "./studio.js";
import { FIGS } from "./figs.js";
window.RENDER = async (name, style = "ink", opts = {}) => {
  const f = await FIGS[name](style, opts);
  const url = renderInk(f.scene, f.camera, f.w, f.h, { style, ss: f.ss || 2, width: f.lineWidth || 1.6 });
  return { url, anchors: project(f.camera, f.anchors || {}), w: f.w, h: f.h };
};
window.STUDIO_READY = true;
