/**
 * GX texture format decoders.
 * Converts tiled/swizzled Wii GPU texture data to linear RGBA pixels.
 *
 * Reference: noclip.website gx_texture.ts
 */

// GX texture format IDs
export const GXTexFmt = {
  I4:      0x00,
  I8:      0x01,
  IA4:     0x02,
  IA8:     0x03,
  RGB565:  0x04,
  RGB5A3:  0x05,
  RGBA32:  0x06,
  C4:      0x08,
  C8:      0x09,
  C14X2:   0x0A,
  CMPR:    0x0E,
};

/**
 * Decode a GX texture to RGBA8 pixel data.
 * @param {Uint8Array} data - raw texture data
 * @param {number} width
 * @param {number} height
 * @param {number} format - GXTexFmt value
 * @param {Uint8Array} [palette] - palette data for C4/C8/C14X2
 * @param {number} [palFmt] - palette format (IA8=0, RGB565=1, RGB5A3=2)
 * @returns {Uint8Array} RGBA8 pixel data (width * height * 4)
 */
export function decodeTexture(data, width, height, format, palette, palFmt) {
  switch (format) {
    case GXTexFmt.I4:     return decodeI4(data, width, height);
    case GXTexFmt.I8:     return decodeI8(data, width, height);
    case GXTexFmt.IA4:    return decodeIA4(data, width, height);
    case GXTexFmt.IA8:    return decodeIA8(data, width, height);
    case GXTexFmt.RGB565: return decodeRGB565(data, width, height);
    case GXTexFmt.RGB5A3: return decodeRGB5A3(data, width, height);
    case GXTexFmt.RGBA32: return decodeRGBA32(data, width, height);
    case GXTexFmt.C4:     return decodeC4(data, width, height, palette, palFmt);
    case GXTexFmt.C8:     return decodeC8(data, width, height, palette, palFmt);
    case GXTexFmt.C14X2:  return decodeC14X2(data, width, height, palette, palFmt);
    case GXTexFmt.CMPR:   return decodeCMPR(data, width, height);
    default:
      throw new Error(`Unknown GX texture format: 0x${format.toString(16)}`);
  }
}

// -- Helper: write pixel at (x,y) into dst RGBA array --
function setPixel(dst, width, x, y, r, g, b, a) {
  if (x >= width || y >= 0xFFFF) return; // clamp check
  const idx = (y * width + x) * 4;
  dst[idx]     = r;
  dst[idx + 1] = g;
  dst[idx + 2] = b;
  dst[idx + 3] = a;
}

// -- I4: 8x8 tiles, 4 bits per pixel --
function decodeI4(data, w, h) {
  const dst = new Uint8Array(w * h * 4);
  let si = 0;
  for (let ty = 0; ty < h; ty += 8) {
    for (let tx = 0; tx < w; tx += 8) {
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x += 2) {
          const byte = data[si++];
          const i0 = (byte >> 4) * 0x11;
          const i1 = (byte & 0xF) * 0x11;
          setPixel(dst, w, tx + x, ty + y, i0, i0, i0, 255);
          setPixel(dst, w, tx + x + 1, ty + y, i1, i1, i1, 255);
        }
      }
    }
  }
  return dst;
}

// -- I8: 8x4 tiles, 8 bits per pixel --
function decodeI8(data, w, h) {
  const dst = new Uint8Array(w * h * 4);
  let si = 0;
  for (let ty = 0; ty < h; ty += 4) {
    for (let tx = 0; tx < w; tx += 8) {
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 8; x++) {
          const i = data[si++];
          setPixel(dst, w, tx + x, ty + y, i, i, i, 255);
        }
      }
    }
  }
  return dst;
}

// -- IA4: 8x4 tiles, 8 bits (4 intensity + 4 alpha) --
function decodeIA4(data, w, h) {
  const dst = new Uint8Array(w * h * 4);
  let si = 0;
  for (let ty = 0; ty < h; ty += 4) {
    for (let tx = 0; tx < w; tx += 8) {
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 8; x++) {
          const byte = data[si++];
          const a = (byte >> 4) * 0x11;
          const i = (byte & 0xF) * 0x11;
          setPixel(dst, w, tx + x, ty + y, i, i, i, a);
        }
      }
    }
  }
  return dst;
}

// -- IA8: 4x4 tiles, 16 bits (8 alpha + 8 intensity) --
function decodeIA8(data, w, h) {
  const dst = new Uint8Array(w * h * 4);
  let si = 0;
  for (let ty = 0; ty < h; ty += 4) {
    for (let tx = 0; tx < w; tx += 4) {
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const a = data[si++];
          const i = data[si++];
          setPixel(dst, w, tx + x, ty + y, i, i, i, a);
        }
      }
    }
  }
  return dst;
}

// -- RGB565: 4x4 tiles, 16 bits --
function decodeRGB565(data, w, h) {
  const dst = new Uint8Array(w * h * 4);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let si = 0;
  for (let ty = 0; ty < h; ty += 4) {
    for (let tx = 0; tx < w; tx += 4) {
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const px = view.getUint16(si, false);
          si += 2;
          const r = ((px >> 11) & 0x1F) * 255 / 31;
          const g = ((px >> 5) & 0x3F) * 255 / 63;
          const b = (px & 0x1F) * 255 / 31;
          setPixel(dst, w, tx + x, ty + y, r | 0, g | 0, b | 0, 255);
        }
      }
    }
  }
  return dst;
}

// -- RGB5A3: 4x4 tiles, 16 bits, mode bit selects format --
function decodeRGB5A3(data, w, h) {
  const dst = new Uint8Array(w * h * 4);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let si = 0;
  for (let ty = 0; ty < h; ty += 4) {
    for (let tx = 0; tx < w; tx += 4) {
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const px = view.getUint16(si, false);
          si += 2;
          let r, g, b, a;
          if (px & 0x8000) {
            // RGB555, fully opaque
            r = ((px >> 10) & 0x1F) * 255 / 31;
            g = ((px >> 5) & 0x1F) * 255 / 31;
            b = (px & 0x1F) * 255 / 31;
            a = 255;
          } else {
            // RGBA4443
            a = ((px >> 12) & 0x07) * 255 / 7;
            r = ((px >> 8) & 0x0F) * 255 / 15;
            g = ((px >> 4) & 0x0F) * 255 / 15;
            b = (px & 0x0F) * 255 / 15;
          }
          setPixel(dst, w, tx + x, ty + y, r | 0, g | 0, b | 0, a | 0);
        }
      }
    }
  }
  return dst;
}

// -- RGBA32: 4x4 tiles, 32 bits, interleaved AR/GB --
function decodeRGBA32(data, w, h) {
  const dst = new Uint8Array(w * h * 4);
  let si = 0;
  for (let ty = 0; ty < h; ty += 4) {
    for (let tx = 0; tx < w; tx += 4) {
      // First 32 bytes: AR pairs for 16 pixels
      const arData = new Uint8Array(32);
      for (let i = 0; i < 32; i++) arData[i] = data[si++];
      // Next 32 bytes: GB pairs for 16 pixels
      const gbData = new Uint8Array(32);
      for (let i = 0; i < 32; i++) gbData[i] = data[si++];

      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const pi = y * 4 + x;
          const a = arData[pi * 2];
          const r = arData[pi * 2 + 1];
          const g = gbData[pi * 2];
          const b = gbData[pi * 2 + 1];
          setPixel(dst, w, tx + x, ty + y, r, g, b, a);
        }
      }
    }
  }
  return dst;
}

// -- CMPR (DXT1/BC1): 8x8 macro-tiles of four 4x4 DXT1 blocks --
function decodeCMPR(data, w, h) {
  const dst = new Uint8Array(w * h * 4);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let si = 0;

  for (let ty = 0; ty < h; ty += 8) {
    for (let tx = 0; tx < w; tx += 8) {
      // Each 8x8 macro-tile contains four 4x4 DXT1 sub-blocks
      for (let by = 0; by < 2; by++) {
        for (let bx = 0; bx < 2; bx++) {
          const c0raw = view.getUint16(si, false); si += 2;
          const c1raw = view.getUint16(si, false); si += 2;

          const c0 = rgb565ToRGBA(c0raw);
          const c1 = rgb565ToRGBA(c1raw);

          // Build color table
          const colors = [c0, c1, [0,0,0,255], [0,0,0,255]];
          if (c0raw > c1raw) {
            colors[2] = [(2*c0[0]+c1[0]+1)/3|0, (2*c0[1]+c1[1]+1)/3|0, (2*c0[2]+c1[2]+1)/3|0, 255];
            colors[3] = [(c0[0]+2*c1[0]+1)/3|0, (c0[1]+2*c1[1]+1)/3|0, (c0[2]+2*c1[2]+1)/3|0, 255];
          } else {
            colors[2] = [(c0[0]+c1[0])/2|0, (c0[1]+c1[1])/2|0, (c0[2]+c1[2])/2|0, 255];
            colors[3] = [0, 0, 0, 0]; // transparent
          }

          // 4 rows of 4 pixels, 2 bits each = 4 bytes
          for (let y = 0; y < 4; y++) {
            const row = data[si++];
            for (let x = 0; x < 4; x++) {
              const idx = (row >> (6 - x * 2)) & 0x03;
              const c = colors[idx];
              const px = tx + bx * 4 + x;
              const py = ty + by * 4 + y;
              if (px < w && py < h) {
                setPixel(dst, w, px, py, c[0], c[1], c[2], c[3]);
              }
            }
          }
        }
      }
    }
  }
  return dst;
}

function rgb565ToRGBA(val) {
  const r = ((val >> 11) & 0x1F) * 255 / 31;
  const g = ((val >> 5) & 0x3F) * 255 / 63;
  const b = (val & 0x1F) * 255 / 31;
  return [r | 0, g | 0, b | 0, 255];
}

// -- Palette-based formats --

function decodePaletteColor(palette, palFmt, index) {
  if (!palette) return [255, 0, 255, 255]; // magenta = missing
  const view = new DataView(palette.buffer, palette.byteOffset, palette.byteLength);
  const px = view.getUint16(index * 2, false);

  switch (palFmt) {
    case 0: { // IA8
      const i = px & 0xFF;
      const a = (px >> 8) & 0xFF;
      return [i, i, i, a];
    }
    case 1: { // RGB565
      return rgb565ToRGBA(px);
    }
    case 2: { // RGB5A3
      if (px & 0x8000) {
        const r = ((px >> 10) & 0x1F) * 255 / 31;
        const g = ((px >> 5) & 0x1F) * 255 / 31;
        const b = (px & 0x1F) * 255 / 31;
        return [r | 0, g | 0, b | 0, 255];
      } else {
        const a = ((px >> 12) & 0x07) * 255 / 7;
        const r = ((px >> 8) & 0x0F) * 255 / 15;
        const g = ((px >> 4) & 0x0F) * 255 / 15;
        const b = (px & 0x0F) * 255 / 15;
        return [r | 0, g | 0, b | 0, a | 0];
      }
    }
    default: return [255, 0, 255, 255];
  }
}

// -- C4: 8x8 tiles, 4 bits per pixel, paletted --
function decodeC4(data, w, h, palette, palFmt) {
  const dst = new Uint8Array(w * h * 4);
  let si = 0;
  for (let ty = 0; ty < h; ty += 8) {
    for (let tx = 0; tx < w; tx += 8) {
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x += 2) {
          const byte = data[si++];
          const i0 = byte >> 4;
          const i1 = byte & 0xF;
          const c0 = decodePaletteColor(palette, palFmt, i0);
          const c1 = decodePaletteColor(palette, palFmt, i1);
          setPixel(dst, w, tx + x, ty + y, c0[0], c0[1], c0[2], c0[3]);
          setPixel(dst, w, tx + x + 1, ty + y, c1[0], c1[1], c1[2], c1[3]);
        }
      }
    }
  }
  return dst;
}

// -- C8: 8x4 tiles, 8 bits per pixel, paletted --
function decodeC8(data, w, h, palette, palFmt) {
  const dst = new Uint8Array(w * h * 4);
  let si = 0;
  for (let ty = 0; ty < h; ty += 4) {
    for (let tx = 0; tx < w; tx += 8) {
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 8; x++) {
          const idx = data[si++];
          const c = decodePaletteColor(palette, palFmt, idx);
          setPixel(dst, w, tx + x, ty + y, c[0], c[1], c[2], c[3]);
        }
      }
    }
  }
  return dst;
}

// -- C14X2: 4x4 tiles, 16 bits per pixel (14-bit index), paletted --
function decodeC14X2(data, w, h, palette, palFmt) {
  const dst = new Uint8Array(w * h * 4);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let si = 0;
  for (let ty = 0; ty < h; ty += 4) {
    for (let tx = 0; tx < w; tx += 4) {
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const idx = view.getUint16(si, false) & 0x3FFF;
          si += 2;
          const c = decodePaletteColor(palette, palFmt, idx);
          setPixel(dst, w, tx + x, ty + y, c[0], c[1], c[2], c[3]);
        }
      }
    }
  }
  return dst;
}
