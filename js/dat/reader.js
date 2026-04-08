/**
 * BinaryReader - Cursor-based DataView wrapper for parsing binary formats.
 * Defaults to big-endian (Wii/GX native byte order).
 */
export class BinaryReader {
  /**
   * @param {ArrayBuffer} buffer
   * @param {number} [offset=0] - base offset within buffer
   * @param {number} [length] - view length (defaults to rest of buffer)
   */
  constructor(buffer, offset = 0, length) {
    this.buffer = buffer;
    this.baseOffset = offset;
    this.view = new DataView(buffer, offset, length);
    this.pos = 0;
    this.length = length !== undefined ? length : buffer.byteLength - offset;
  }

  // -- Position --

  tell() { return this.pos; }

  seek(pos) {
    if (pos < 0 || pos > this.length) {
      throw new RangeError(`seek out of bounds: ${pos} (length ${this.length})`);
    }
    this.pos = pos;
  }

  skip(n) { this.seek(this.pos + n); }

  align(n) {
    const rem = this.pos % n;
    if (rem !== 0) this.pos += n - rem;
  }

  remaining() { return this.length - this.pos; }

  eof() { return this.pos >= this.length; }

  /**
   * Create a child reader over a sub-region (relative to current reader's base).
   */
  slice(offset, length) {
    return new BinaryReader(this.buffer, this.baseOffset + offset, length);
  }

  // -- Integer reads (big-endian default) --

  readU8() {
    const v = this.view.getUint8(this.pos);
    this.pos += 1;
    return v;
  }

  readI8() {
    const v = this.view.getInt8(this.pos);
    this.pos += 1;
    return v;
  }

  readU16(le = false) {
    const v = this.view.getUint16(this.pos, le);
    this.pos += 2;
    return v;
  }

  readI16(le = false) {
    const v = this.view.getInt16(this.pos, le);
    this.pos += 2;
    return v;
  }

  readU32(le = false) {
    const v = this.view.getUint32(this.pos, le);
    this.pos += 4;
    return v;
  }

  readI32(le = false) {
    const v = this.view.getInt32(this.pos, le);
    this.pos += 4;
    return v;
  }

  // -- Float reads --

  readF32(le = false) {
    const v = this.view.getFloat32(this.pos, le);
    this.pos += 4;
    return v;
  }

  // -- Bulk reads --

  readBytes(n) {
    const arr = new Uint8Array(this.buffer, this.baseOffset + this.pos, n);
    this.pos += n;
    return arr;
  }

  readArrayBuffer(n) {
    const slice = this.buffer.slice(this.baseOffset + this.pos, this.baseOffset + this.pos + n);
    this.pos += n;
    return slice;
  }

  // -- String reads --

  /** Read a null-terminated string. */
  readStringNT() {
    let str = '';
    while (this.pos < this.length) {
      const c = this.view.getUint8(this.pos++);
      if (c === 0) break;
      str += String.fromCharCode(c);
    }
    return str;
  }

  /** Read a fixed-length string (may contain trailing nulls). */
  readString(n) {
    let str = '';
    for (let i = 0; i < n; i++) {
      const c = this.view.getUint8(this.pos++);
      if (c !== 0) str += String.fromCharCode(c);
    }
    return str;
  }

  /** Read a string from the string table at the given absolute offset (does not move cursor). */
  readStringAt(offset) {
    let str = '';
    let p = offset;
    while (p < this.length) {
      const c = this.view.getUint8(p++);
      if (c === 0) break;
      str += String.fromCharCode(c);
    }
    return str;
  }

  /** Peek at bytes without advancing. */
  peekU8(offset = 0) {
    return this.view.getUint8(this.pos + offset);
  }

  peekU32(offset = 0, le = false) {
    return this.view.getUint32(this.pos + offset, le);
  }

  /** Get underlying Uint8Array for the entire reader range. */
  getUint8Array() {
    return new Uint8Array(this.buffer, this.baseOffset, this.length);
  }
}
