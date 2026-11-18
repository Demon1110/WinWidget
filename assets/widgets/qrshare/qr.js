/* QR encoder: byte mode, versions 1–10, ECC level L or M, best mask by the standard penalty.
 * Written for this widget only; no dependency. */
const QREncoder = (() => {
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  {
    let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  }
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

  // [ecc codewords per block, [[block count, data codewords], …]] for versions 1…10
  const SPEC = {
    L: [[7, [[1, 19]]], [10, [[1, 34]]], [15, [[1, 55]]], [20, [[1, 80]]], [26, [[1, 108]]],
        [18, [[2, 68]]], [20, [[2, 78]]], [24, [[2, 97]]], [30, [[2, 116]]], [18, [[2, 68], [2, 69]]]],
    M: [[10, [[1, 16]]], [16, [[1, 28]]], [26, [[1, 44]]], [18, [[2, 32]]], [24, [[2, 43]]],
        [16, [[4, 27]]], [18, [[4, 31]]], [22, [[2, 38], [2, 39]]], [22, [[3, 36], [2, 37]]], [26, [[4, 43], [1, 44]]]],
  };
  const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  const ECL = { L: 1, M: 0 };

  function genPoly(n) {
    let g = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) {
        next[j] ^= g[j];
        next[j + 1] ^= mul(g[j], EXP[i]);
      }
      g = next;
    }
    return g;
  }
  function rsEncode(data, eccLen) {
    const g = genPoly(eccLen);
    const res = new Uint8Array(data.length + eccLen);
    res.set(data);
    for (let i = 0; i < data.length; i++) {
      const f = res[i];
      if (!f) continue;
      for (let j = 0; j < g.length; j++) res[i + j] ^= mul(g[j], f);
    }
    return res.slice(data.length);
  }

  function capacityBits(spec) {
    return spec[1].reduce((n, [c, d]) => n + c * d, 0) * 8;
  }

  function assemble(bytes, level) {
    let version = 0, spec = null;
    for (let v = 1; v <= 10; v++) {
      const s = SPEC[level][v - 1];
      const need = 4 + (v < 10 ? 8 : 16) + 8 * bytes.length;
      if (need <= capacityBits(s)) { version = v; spec = s; break; }
    }
    if (!version) return null;

    const buf = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) buf.push((val >>> i) & 1); };
    put(4, 4);
    put(bytes.length, version < 10 ? 8 : 16);
    for (const b of bytes) put(b, 8);
    const cap = capacityBits(spec);
    for (let i = 0; i < 4 && buf.length < cap; i++) buf.push(0);
    while (buf.length % 8) buf.push(0);
    const words = [];
    for (let i = 0; i < buf.length; i += 8) {
      let w = 0;
      for (let j = 0; j < 8; j++) w = (w << 1) | buf[i + j];
      words.push(w);
    }
    const pads = [0xEC, 0x11];
    let k = 0;
    while (words.length < cap / 8) words.push(pads[k++ % 2]);

    const dataBlocks = [];
    let at = 0;
    for (const [count, dlen] of spec[1]) {
      for (let b = 0; b < count; b++) { dataBlocks.push(words.slice(at, at + dlen)); at += dlen; }
    }
    const eccLen = spec[0];
    const eccBlocks = dataBlocks.map((d) => rsEncode(d, eccLen));
    const stream = [];
    const maxData = Math.max(...dataBlocks.map((d) => d.length));
    for (let i = 0; i < maxData; i++) for (const d of dataBlocks) if (i < d.length) stream.push(d[i]);
    for (let i = 0; i < eccLen; i++) for (const e of eccBlocks) stream.push(e[i]);
    return { version, stream };
  }

  function layout(version, stream, level, onlyMask) {
    const size = 17 + version * 4;
    const m = new Int8Array(size * size).fill(0);
    const fn = new Uint8Array(size * size);
    const set = (x, y, dark) => {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      m[y * size + x] = dark ? 1 : 0;
      fn[y * size + x] = 1;
    };

    const finder = (x0, y0) => {
      for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) {
        const onRing = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6 &&
          (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
        set(x0 + dx, y0 + dy, onRing);
      }
    };
    finder(0, 0); finder(size - 7, 0); finder(0, size - 7);

    for (let i = 8; i < size - 8; i++) { set(i, 6, i % 2 === 0); set(6, i, i % 2 === 0); }

    const centers = ALIGN[version - 1];
    for (const cy of centers) for (const cx of centers) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
        set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }

    if (version >= 7) {
      let rem = version;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (version << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const bit = (bits >>> i) & 1;
        const a = size - 11 + (i % 3), b = Math.floor(i / 3);
        set(a, b, bit === 1);
        set(b, a, bit === 1);
      }
    }

    // reserve the two format areas and the dark module
    for (let i = 0; i <= 5; i++) set(8, i, false);
    set(8, 7, false); set(8, 8, false); set(7, 8, false);
    for (let i = 9; i < 15; i++) set(14 - i, 8, false);
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, false);
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, false);
    set(8, size - 8, true);

    // data, two columns at a time, bottom-up then top-down
    let bit = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!fn[y * size + x] && bit < stream.length * 8) {
            m[y * size + x] = (stream[bit >>> 3] >>> (7 - (bit & 7))) & 1;
            bit++;
          }
        }
      }
    }

    const maskFn = (mask, x, y) => {
      switch (mask) {
        case 0: return (x + y) % 2 === 0;
        case 1: return y % 2 === 0;
        case 2: return x % 3 === 0;
        case 3: return (x + y) % 3 === 0;
        case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
        case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
        case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
        case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        default: return false;
      }
    };

    const formatBits = (mask) => {
      const data = (ECL[level] << 3) | mask;
      let rem = data << 10;
      for (let i = 14; i >= 10; i--) if (rem & (1 << i)) rem ^= 0x537 << (i - 10);
      return ((data << 10) | rem) ^ 0x5412;
    };

    const applyFormat = (g, mask) => {
      const bits = formatBits(mask);
      const put = (x, y, i) => { g[y * size + x] = (bits >>> i) & 1; };
      for (let i = 0; i <= 5; i++) put(8, i, i);
      put(8, 7, 6); put(8, 8, 7); put(7, 8, 8);
      for (let i = 9; i < 15; i++) put(14 - i, 8, i);
      for (let i = 0; i < 8; i++) put(size - 1 - i, 8, i);
      for (let i = 8; i < 15; i++) put(8, size - 15 + i, i);
    };

    const penalty = (g) => {
      let score = 0;
      const run = (get) => {
        for (let a = 0; a < size; a++) {
          let len = 1, prev = get(a, 0);
          for (let b = 1; b < size; b++) {
            const cur = get(a, b);
            if (cur === prev) len++;
            else { if (len >= 5) score += 3 + (len - 5); len = 1; prev = cur; }
          }
          if (len >= 5) score += 3 + (len - 5);
        }
      };
      run((a, b) => g[a * size + b]);
      run((a, b) => g[b * size + a]);
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
        const c = g[y * size + x];
        if (c === g[y * size + x + 1] && c === g[(y + 1) * size + x] && c === g[(y + 1) * size + x + 1]) score += 3;
      }
      // finder-like sequences: 1011101 with four light modules on either side
      const scan = (get) => {
        for (let a = 0; a < size; a++) {
          for (let b = 0; b + 10 < size; b++) {
            let seq = 0;
            for (let k = 0; k < 11; k++) seq = (seq << 1) | get(a, b + k);
            if (seq === 0b10111010000 || seq === 0b00001011101) score += 40;
          }
        }
      };
      scan((a, b) => g[a * size + b]);
      scan((a, b) => g[b * size + a]);
      let dark = 0;
      for (let i = 0; i < g.length; i++) dark += g[i];
      const total = size * size;
      const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
      score += Math.max(0, k) * 10;
      return score;
    };

    let best = null, bestScore = Infinity, bestMask = 0;
    for (let mask = 0; mask < 8; mask++) {
      if (typeof onlyMask === "number" && mask !== onlyMask) continue;
      const g = new Uint8Array(m);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        if (!fn[y * size + x] && maskFn(mask, x, y)) g[y * size + x] ^= 1;
      }
      applyFormat(g, mask);
      const s = penalty(g);
      if (s < bestScore) { bestScore = s; best = g; bestMask = mask; }
    }
    return { size, modules: best || new Uint8Array(m), mask: bestMask };
  }

  function make(text, level, forcedMask) {
    const levelName = level === "L" ? "L" : "M";
    if (!text) return null;
    const bytes = new TextEncoder().encode(text);
    const packed = assemble(bytes, levelName);
    if (!packed) return null;
    return layout(packed.version, packed.stream, levelName, forcedMask);
  }

  return { make };
})();
window.QREncoder = QREncoder;
if (typeof module === "object" && module.exports) module.exports = QREncoder;
