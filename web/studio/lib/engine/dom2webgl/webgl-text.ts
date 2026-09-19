/* eslint-disable @typescript-eslint/no-explicit-any */
// WebGLText: troika Text bound to a DOM text node, with glyph-bounds helpers.
import { Text } from "troika-three-text";
import { store } from "../core/store";
import { WebGLItem, type WebGLItemOptions } from "./webgl-item";

const o: any = store;

export interface GlyphPosition {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function rgbToHex(s: string) {
  return `#${(s.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/) as RegExpMatchArray)
    .slice(1)
    .map((e) => parseInt(e, 10).toString(16).padStart(2, "0"))
    .join("")}`;
}

export class WebGLText extends WebGLItem {
  initialLoad: boolean;
  resolve!: () => void;
  fontSize = 0;
  glyphPositions: GlyphPosition[] = [];

  constructor(e: WebGLItemOptions) {
    super(e);
    this.domEl._glProps = { "position.x": 0, "position.y": 0 };
    this.initialLoad = true;
    o.TextLoader.add(
      new Promise<void>((res) => {
        this.resolve = res;
      }),
    );
  }

  build() {
    this.item = new Text();
    Object.assign(this.item, {
      text: this.domEl.innerText,
      anchorX: "center",
      anchorY: "middle",
    });
    this.item.material.depthTest = false;
    this.item.material.renderOrder = 10;
    this.item.material.defines.FOG = true;
    this.add(this.item);
  }

  calcPixelScale() {}

  syncDomSize() {
    const e = window.getComputedStyle(this.domEl);
    const t = this.domEl.getBoundingClientRect();
    const i = e.fontFamily.split(",")[0].replace(/"/g, "");
    this.fontSize = parseFloat(e.fontSize);
    Object.assign(this.item, {
      font: o.Gl.webglFonts[i].url,
      fontSize: this.fontSize,
      letterSpacing: parseFloat(e.letterSpacing) / this.fontSize,
      maxWidth: t.width + 4,
      lineHeight: parseFloat(e.lineHeight) / this.fontSize,
      textAlign: e.textAlign,
      color: parseInt("0x" + rgbToHex(e.color).replace("#", ""), 16),
      sdfGlyphSize: o.Gl.webglFonts[i].sdfGlyphSize,
      clipRect: [0.6 * -t.width, 0.5 * -t.height, 0.6 * t.width, 0.5 * t.height],
    });
    this.item.sync(() => {
      this.copyGlyphPositions();
      if (this.initialLoad) {
        this.initialLoad = false;
        this.resolve();
      }
    });
  }

  copyGlyphPositions() {
    this.glyphPositions = [];
    const attr = this.item.geometry.attributes.aTroikaGlyphBounds;
    let e = 0;
    for (let t = 0; t < attr.count; t++)
      this.glyphPositions[t] = {
        minX: attr.array[e++],
        minY: attr.array[e++],
        maxX: attr.array[e++],
        maxY: attr.array[e++],
      };
  }

  updateGlyphPositions() {
    const attr = this.item.geometry.attributes.aTroikaGlyphBounds;
    let e = 0;
    for (let t = 0; t < attr.count; t++) {
      attr.array[e++] = this.glyphPositions[t].minX;
      attr.array[e++] = this.glyphPositions[t].minY;
      attr.array[e++] = this.glyphPositions[t].maxX;
      attr.array[e++] = this.glyphPositions[t].maxY;
    }
    attr.needsUpdate = true;
  }

  addToGlyphPositions(e: Partial<GlyphPosition> = {}) {
    const attr = this.item.geometry.attributes.aTroikaGlyphBounds;
    let t = 0;
    for (let i = 0; i < attr.count; i++) {
      attr.array[t++] += e.minX || 0;
      attr.array[t++] += e.minY || 0;
      attr.array[t++] += e.maxX || 0;
      attr.array[t++] += e.maxY || 0;
    }
    attr.needsUpdate = true;
  }
}

export default WebGLText;
