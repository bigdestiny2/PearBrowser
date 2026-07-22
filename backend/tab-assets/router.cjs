var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/b4a/index.js
var require_b4a = __commonJS({
  "node_modules/b4a/index.js"(exports2, module2) {
    function isBuffer(value) {
      return Buffer.isBuffer(value) || value instanceof Uint8Array;
    }
    function isEncoding(encoding) {
      return Buffer.isEncoding(encoding);
    }
    function alloc(size, fill2, encoding) {
      return Buffer.alloc(size, fill2, encoding);
    }
    function allocUnsafe(size) {
      return Buffer.allocUnsafe(size);
    }
    function allocUnsafeSlow(size) {
      return Buffer.allocUnsafeSlow(size);
    }
    function byteLength(string, encoding) {
      return Buffer.byteLength(string, encoding);
    }
    function compare(a, b) {
      return Buffer.compare(a, b);
    }
    function concat(buffers, totalLength) {
      return Buffer.concat(buffers, totalLength);
    }
    function copy(source, target, targetStart, start, end) {
      return toBuffer(source).copy(target, targetStart, start, end);
    }
    function equals(a, b) {
      return toBuffer(a).equals(b);
    }
    function fill(buffer, value, offset, end, encoding) {
      return toBuffer(buffer).fill(value, offset, end, encoding);
    }
    function from(value, encodingOrOffset, length) {
      return Buffer.from(value, encodingOrOffset, length);
    }
    function includes(buffer, value, byteOffset, encoding) {
      return toBuffer(buffer).includes(value, byteOffset, encoding);
    }
    function indexOf(buffer, value, byfeOffset, encoding) {
      return toBuffer(buffer).indexOf(value, byfeOffset, encoding);
    }
    function lastIndexOf(buffer, value, byteOffset, encoding) {
      return toBuffer(buffer).lastIndexOf(value, byteOffset, encoding);
    }
    function swap16(buffer) {
      return toBuffer(buffer).swap16();
    }
    function swap32(buffer) {
      return toBuffer(buffer).swap32();
    }
    function swap64(buffer) {
      return toBuffer(buffer).swap64();
    }
    function toBuffer(buffer) {
      if (Buffer.isBuffer(buffer)) return buffer;
      return Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }
    function toString(buffer, encoding, start, end) {
      return toBuffer(buffer).toString(encoding, start, end);
    }
    function write(buffer, string, offset, length, encoding) {
      return toBuffer(buffer).write(string, offset, length, encoding);
    }
    function readDoubleBE(buffer, offset) {
      return toBuffer(buffer).readDoubleBE(offset);
    }
    function readDoubleLE(buffer, offset) {
      return toBuffer(buffer).readDoubleLE(offset);
    }
    function readFloatBE(buffer, offset) {
      return toBuffer(buffer).readFloatBE(offset);
    }
    function readFloatLE(buffer, offset) {
      return toBuffer(buffer).readFloatLE(offset);
    }
    function readInt32BE(buffer, offset) {
      return toBuffer(buffer).readInt32BE(offset);
    }
    function readInt32LE(buffer, offset) {
      return toBuffer(buffer).readInt32LE(offset);
    }
    function readUInt32BE(buffer, offset) {
      return toBuffer(buffer).readUInt32BE(offset);
    }
    function readUInt32LE(buffer, offset) {
      return toBuffer(buffer).readUInt32LE(offset);
    }
    function writeDoubleBE(buffer, value, offset) {
      return toBuffer(buffer).writeDoubleBE(value, offset);
    }
    function writeDoubleLE(buffer, value, offset) {
      return toBuffer(buffer).writeDoubleLE(value, offset);
    }
    function writeFloatBE(buffer, value, offset) {
      return toBuffer(buffer).writeFloatBE(value, offset);
    }
    function writeFloatLE(buffer, value, offset) {
      return toBuffer(buffer).writeFloatLE(value, offset);
    }
    function writeInt32BE(buffer, value, offset) {
      return toBuffer(buffer).writeInt32BE(value, offset);
    }
    function writeInt32LE(buffer, value, offset) {
      return toBuffer(buffer).writeInt32LE(value, offset);
    }
    function writeUInt32BE(buffer, value, offset) {
      return toBuffer(buffer).writeUInt32BE(value, offset);
    }
    function writeUInt32LE(buffer, value, offset) {
      return toBuffer(buffer).writeUInt32LE(value, offset);
    }
    module2.exports = {
      isBuffer,
      isEncoding,
      alloc,
      allocUnsafe,
      allocUnsafeSlow,
      byteLength,
      compare,
      concat,
      copy,
      equals,
      fill,
      from,
      includes,
      indexOf,
      lastIndexOf,
      swap16,
      swap32,
      swap64,
      toBuffer,
      toString,
      write,
      readDoubleBE,
      readDoubleLE,
      readFloatBE,
      readFloatLE,
      readInt32BE,
      readInt32LE,
      readUInt32BE,
      readUInt32LE,
      writeDoubleBE,
      writeDoubleLE,
      writeFloatBE,
      writeFloatLE,
      writeInt32BE,
      writeInt32LE,
      writeUInt32BE,
      writeUInt32LE
    };
  }
});

// node_modules/compact-encoding/endian.js
var require_endian = __commonJS({
  "node_modules/compact-encoding/endian.js"(exports2) {
    var LE = exports2.LE = new Uint8Array(new Uint16Array([255]).buffer)[0] === 255;
    exports2.BE = !LE;
  }
});

// node_modules/compact-encoding/raw.js
var require_raw = __commonJS({
  "node_modules/compact-encoding/raw.js"(exports2, module2) {
    var b4a = require_b4a();
    var { BE } = require_endian();
    exports2 = module2.exports = {
      preencode(state, b) {
        state.end += b.byteLength;
      },
      encode(state, b) {
        state.buffer.set(b, state.start);
        state.start += b.byteLength;
      },
      decode(state) {
        const b = state.buffer.subarray(state.start, state.end);
        state.start = state.end;
        return b;
      }
    };
    var buffer = exports2.buffer = {
      preencode(state, b) {
        if (b) uint8array.preencode(state, b);
        else state.end++;
      },
      encode(state, b) {
        if (b) uint8array.encode(state, b);
        else state.buffer[state.start++] = 0;
      },
      decode(state) {
        const b = state.buffer.subarray(state.start);
        if (b.byteLength === 0) return null;
        state.start = state.end;
        return b;
      }
    };
    exports2.binary = {
      ...buffer,
      preencode(state, b) {
        if (typeof b === "string") utf8.preencode(state, b);
        else buffer.preencode(state, b);
      },
      encode(state, b) {
        if (typeof b === "string") utf8.encode(state, b);
        else buffer.encode(state, b);
      }
    };
    exports2.arraybuffer = {
      preencode(state, b) {
        state.end += b.byteLength;
      },
      encode(state, b) {
        const view = new Uint8Array(b);
        state.buffer.set(view, state.start);
        state.start += b.byteLength;
      },
      decode(state) {
        const b = new ArrayBuffer(state.end - state.start);
        const view = new Uint8Array(b);
        view.set(state.buffer.subarray(state.start));
        state.start = state.end;
        return b;
      }
    };
    function typedarray(TypedArray, swap) {
      const n = TypedArray.BYTES_PER_ELEMENT;
      return {
        preencode(state, b) {
          state.end += b.byteLength;
        },
        encode(state, b) {
          const view = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
          if (BE && swap) swap(view);
          state.buffer.set(view, state.start);
          state.start += b.byteLength;
        },
        decode(state) {
          let b = state.buffer.subarray(state.start);
          if (b.byteOffset % n !== 0) b = new Uint8Array(b);
          if (BE && swap) swap(b);
          state.start = state.end;
          return new TypedArray(b.buffer, b.byteOffset, b.byteLength / n);
        }
      };
    }
    var uint8array = exports2.uint8array = typedarray(Uint8Array);
    exports2.uint16array = typedarray(Uint16Array, b4a.swap16);
    exports2.uint32array = typedarray(Uint32Array, b4a.swap32);
    exports2.int8array = typedarray(Int8Array);
    exports2.int16array = typedarray(Int16Array, b4a.swap16);
    exports2.int32array = typedarray(Int32Array, b4a.swap32);
    exports2.biguint64array = typedarray(BigUint64Array, b4a.swap64);
    exports2.bigint64array = typedarray(BigInt64Array, b4a.swap64);
    exports2.float32array = typedarray(Float32Array, b4a.swap32);
    exports2.float64array = typedarray(Float64Array, b4a.swap64);
    function string(encoding) {
      return {
        preencode(state, s) {
          state.end += b4a.byteLength(s, encoding);
        },
        encode(state, s) {
          state.start += b4a.write(state.buffer, s, state.start, encoding);
        },
        decode(state) {
          const s = b4a.toString(state.buffer, encoding, state.start);
          state.start = state.end;
          return s;
        }
      };
    }
    var utf8 = exports2.string = exports2.utf8 = string("utf-8");
    exports2.ascii = string("ascii");
    exports2.hex = string("hex");
    exports2.base64 = string("base64");
    exports2.ucs2 = exports2.utf16le = string("utf16le");
    exports2.array = function array(enc) {
      return {
        preencode(state, list) {
          for (const value of list) enc.preencode(state, value);
        },
        encode(state, list) {
          for (const value of list) enc.encode(state, value);
        },
        decode(state) {
          const arr = [];
          while (state.start < state.end) arr.push(enc.decode(state));
          return arr;
        }
      };
    };
    exports2.json = {
      preencode(state, v) {
        utf8.preencode(state, JSON.stringify(v));
      },
      encode(state, v) {
        utf8.encode(state, JSON.stringify(v));
      },
      decode(state) {
        return JSON.parse(utf8.decode(state));
      }
    };
    exports2.ndjson = {
      preencode(state, v) {
        utf8.preencode(state, JSON.stringify(v) + "\n");
      },
      encode(state, v) {
        utf8.encode(state, JSON.stringify(v) + "\n");
      },
      decode(state) {
        return JSON.parse(utf8.decode(state));
      }
    };
  }
});

// node_modules/compact-encoding/lexint.js
var require_lexint = __commonJS({
  "node_modules/compact-encoding/lexint.js"(exports2, module2) {
    module2.exports = {
      preencode,
      encode,
      decode
    };
    function preencode(state, num) {
      if (num < 251) {
        state.end++;
      } else if (num < 256) {
        state.end += 2;
      } else if (num < 65536) {
        state.end += 3;
      } else if (num < 16777216) {
        state.end += 4;
      } else if (num < 4294967296) {
        state.end += 5;
      } else {
        state.end++;
        const exp = Math.floor(Math.log(num) / Math.log(2)) - 32;
        preencode(state, exp);
        state.end += 6;
      }
    }
    function encode(state, num) {
      const max = 251;
      const x = num - max;
      if (num < max) {
        state.buffer[state.start++] = num;
      } else if (num < 256) {
        state.buffer[state.start++] = max;
        state.buffer[state.start++] = x;
      } else if (num < 65536) {
        state.buffer[state.start++] = max + 1;
        state.buffer[state.start++] = x >> 8 & 255;
        state.buffer[state.start++] = x & 255;
      } else if (num < 16777216) {
        state.buffer[state.start++] = max + 2;
        state.buffer[state.start++] = x >> 16;
        state.buffer[state.start++] = x >> 8 & 255;
        state.buffer[state.start++] = x & 255;
      } else if (num < 4294967296) {
        state.buffer[state.start++] = max + 3;
        state.buffer[state.start++] = x >> 24;
        state.buffer[state.start++] = x >> 16 & 255;
        state.buffer[state.start++] = x >> 8 & 255;
        state.buffer[state.start++] = x & 255;
      } else {
        const exp = Math.floor(Math.log(x) / Math.log(2)) - 32;
        state.buffer[state.start++] = 255;
        encode(state, exp);
        const rem = x / Math.pow(2, exp - 11);
        for (let i = 5; i >= 0; i--) {
          state.buffer[state.start++] = rem / Math.pow(2, 8 * i) & 255;
        }
      }
    }
    function decode(state) {
      const max = 251;
      if (state.end - state.start < 1) throw new Error("Out of bounds");
      const flag = state.buffer[state.start++];
      if (flag < max) return flag;
      if (state.end - state.start < flag - max + 1) {
        throw new Error("Out of bounds.");
      }
      if (flag < 252) {
        return state.buffer[state.start++] + max;
      }
      if (flag < 253) {
        return (state.buffer[state.start++] << 8) + state.buffer[state.start++] + max;
      }
      if (flag < 254) {
        return (state.buffer[state.start++] << 16) + (state.buffer[state.start++] << 8) + state.buffer[state.start++] + max;
      }
      if (flag < 255) {
        return state.buffer[state.start++] * 16777216 + (state.buffer[state.start++] << 16) + (state.buffer[state.start++] << 8) + state.buffer[state.start++] + max;
      }
      const exp = decode(state);
      if (state.end - state.start < 6) throw new Error("Out of bounds");
      let rem = 0;
      for (let i = 5; i >= 0; i--) {
        rem += state.buffer[state.start++] * Math.pow(2, 8 * i);
      }
      return rem * Math.pow(2, exp - 11) + max;
    }
  }
});

// node_modules/compact-encoding/index.js
var require_compact_encoding = __commonJS({
  "node_modules/compact-encoding/index.js"(exports2) {
    var b4a = require_b4a();
    var { BE } = require_endian();
    exports2.state = function(start = 0, end = 0, buffer2 = null) {
      return { start, end, buffer: buffer2 };
    };
    var raw = exports2.raw = require_raw();
    var uint = exports2.uint = {
      preencode(state, n) {
        state.end += n <= 252 ? 1 : n <= 65535 ? 3 : n <= 4294967295 ? 5 : 9;
      },
      encode(state, n) {
        if (n <= 252) uint8.encode(state, n);
        else if (n <= 65535) {
          state.buffer[state.start++] = 253;
          uint16.encode(state, n);
        } else if (n <= 4294967295) {
          state.buffer[state.start++] = 254;
          uint32.encode(state, n);
        } else {
          state.buffer[state.start++] = 255;
          uint64.encode(state, n);
        }
      },
      decode(state) {
        const a = uint8.decode(state);
        if (a <= 252) return a;
        if (a === 253) return uint16.decode(state);
        if (a === 254) return uint32.decode(state);
        return uint64.decode(state);
      }
    };
    var uint8 = exports2.uint8 = {
      preencode(state, n) {
        state.end += 1;
      },
      encode(state, n) {
        validateUint(n);
        state.buffer[state.start++] = n;
      },
      decode(state) {
        if (state.start >= state.end) throw new Error("Out of bounds");
        return state.buffer[state.start++];
      }
    };
    var uint16 = exports2.uint16 = {
      preencode(state, n) {
        state.end += 2;
      },
      encode(state, n) {
        validateUint(n);
        state.buffer[state.start++] = n;
        state.buffer[state.start++] = n >>> 8;
      },
      decode(state) {
        if (state.end - state.start < 2) throw new Error("Out of bounds");
        return state.buffer[state.start++] + state.buffer[state.start++] * 256;
      }
    };
    var uint24 = exports2.uint24 = {
      preencode(state, n) {
        state.end += 3;
      },
      encode(state, n) {
        validateUint(n);
        state.buffer[state.start++] = n;
        state.buffer[state.start++] = n >>> 8;
        state.buffer[state.start++] = n >>> 16;
      },
      decode(state) {
        if (state.end - state.start < 3) throw new Error("Out of bounds");
        return state.buffer[state.start++] + state.buffer[state.start++] * 256 + state.buffer[state.start++] * 65536;
      }
    };
    var uint32 = exports2.uint32 = {
      preencode(state, n) {
        state.end += 4;
      },
      encode(state, n) {
        validateUint(n);
        state.buffer[state.start++] = n;
        state.buffer[state.start++] = n >>> 8;
        state.buffer[state.start++] = n >>> 16;
        state.buffer[state.start++] = n >>> 24;
      },
      decode(state) {
        if (state.end - state.start < 4) throw new Error("Out of bounds");
        return state.buffer[state.start++] + state.buffer[state.start++] * 256 + state.buffer[state.start++] * 65536 + state.buffer[state.start++] * 16777216;
      }
    };
    var uint40 = exports2.uint40 = {
      preencode(state, n) {
        state.end += 5;
      },
      encode(state, n) {
        validateUint(n);
        const r = Math.floor(n / 256);
        uint8.encode(state, n);
        uint32.encode(state, r);
      },
      decode(state) {
        if (state.end - state.start < 5) throw new Error("Out of bounds");
        return uint8.decode(state) + 256 * uint32.decode(state);
      }
    };
    var uint48 = exports2.uint48 = {
      preencode(state, n) {
        state.end += 6;
      },
      encode(state, n) {
        validateUint(n);
        const r = Math.floor(n / 65536);
        uint16.encode(state, n);
        uint32.encode(state, r);
      },
      decode(state) {
        if (state.end - state.start < 6) throw new Error("Out of bounds");
        return uint16.decode(state) + 65536 * uint32.decode(state);
      }
    };
    var uint56 = exports2.uint56 = {
      preencode(state, n) {
        state.end += 7;
      },
      encode(state, n) {
        validateUint(n);
        const r = Math.floor(n / 16777216);
        uint24.encode(state, n);
        uint32.encode(state, r);
      },
      decode(state) {
        if (state.end - state.start < 7) throw new Error("Out of bounds");
        return uint24.decode(state) + 16777216 * uint32.decode(state);
      }
    };
    var uint64 = exports2.uint64 = {
      preencode(state, n) {
        state.end += 8;
      },
      encode(state, n) {
        validateUint(n);
        const r = Math.floor(n / 4294967296);
        uint32.encode(state, n);
        uint32.encode(state, r);
      },
      decode(state) {
        if (state.end - state.start < 8) throw new Error("Out of bounds");
        return uint32.decode(state) + 4294967296 * uint32.decode(state);
      }
    };
    var int = exports2.int = zigZagInt(uint);
    exports2.int8 = zigZagInt(uint8);
    exports2.int16 = zigZagInt(uint16);
    exports2.int24 = zigZagInt(uint24);
    exports2.int32 = zigZagInt(uint32);
    exports2.int40 = zigZagInt(uint40);
    exports2.int48 = zigZagInt(uint48);
    exports2.int56 = zigZagInt(uint56);
    exports2.int64 = zigZagInt(uint64);
    var biguint64 = exports2.biguint64 = {
      preencode(state, n) {
        state.end += 8;
      },
      encode(state, n) {
        const view = new DataView(
          state.buffer.buffer,
          state.start + state.buffer.byteOffset,
          8
        );
        view.setBigUint64(0, n, true);
        state.start += 8;
      },
      decode(state) {
        if (state.end - state.start < 8) throw new Error("Out of bounds");
        const view = new DataView(
          state.buffer.buffer,
          state.start + state.buffer.byteOffset,
          8
        );
        const n = view.getBigUint64(0, true);
        state.start += 8;
        return n;
      }
    };
    exports2.bigint64 = zigZagBigInt(biguint64);
    var biguint = exports2.biguint = {
      preencode(state, n) {
        let len = 0;
        for (let m = n; m; m = m >> 64n) len++;
        uint.preencode(state, len);
        state.end += 8 * len;
      },
      encode(state, n) {
        let len = 0;
        for (let m = n; m; m = m >> 64n) len++;
        uint.encode(state, len);
        const view = new DataView(
          state.buffer.buffer,
          state.start + state.buffer.byteOffset,
          8 * len
        );
        for (let m = n, i = 0; m; m = m >> 64n, i += 8) {
          view.setBigUint64(i, BigInt.asUintN(64, m), true);
        }
        state.start += 8 * len;
      },
      decode(state) {
        const len = uint.decode(state);
        if (state.end - state.start < 8 * len) throw new Error("Out of bounds");
        const view = new DataView(
          state.buffer.buffer,
          state.start + state.buffer.byteOffset,
          8 * len
        );
        let n = 0n;
        for (let i = len - 1; i >= 0; i--)
          n = (n << 64n) + view.getBigUint64(i * 8, true);
        state.start += 8 * len;
        return n;
      }
    };
    exports2.bigint = zigZagBigInt(biguint);
    exports2.lexint = require_lexint();
    exports2.float32 = {
      preencode(state, n) {
        state.end += 4;
      },
      encode(state, n) {
        const view = new DataView(
          state.buffer.buffer,
          state.start + state.buffer.byteOffset,
          4
        );
        view.setFloat32(0, n, true);
        state.start += 4;
      },
      decode(state) {
        if (state.end - state.start < 4) throw new Error("Out of bounds");
        const view = new DataView(
          state.buffer.buffer,
          state.start + state.buffer.byteOffset,
          4
        );
        const float = view.getFloat32(0, true);
        state.start += 4;
        return float;
      }
    };
    exports2.float64 = {
      preencode(state, n) {
        state.end += 8;
      },
      encode(state, n) {
        const view = new DataView(
          state.buffer.buffer,
          state.start + state.buffer.byteOffset,
          8
        );
        view.setFloat64(0, n, true);
        state.start += 8;
      },
      decode(state) {
        if (state.end - state.start < 8) throw new Error("Out of bounds");
        const view = new DataView(
          state.buffer.buffer,
          state.start + state.buffer.byteOffset,
          8
        );
        const float = view.getFloat64(0, true);
        state.start += 8;
        return float;
      }
    };
    var buffer = exports2.buffer = {
      preencode(state, b) {
        if (b) uint8array.preencode(state, b);
        else state.end++;
      },
      encode(state, b) {
        if (b) uint8array.encode(state, b);
        else state.buffer[state.start++] = 0;
      },
      decode(state) {
        const len = uint.decode(state);
        if (len === 0) return null;
        if (state.end - state.start < len) throw new Error("Out of bounds");
        return state.buffer.subarray(state.start, state.start += len);
      }
    };
    exports2.binary = {
      ...buffer,
      preencode(state, b) {
        if (typeof b === "string") utf8.preencode(state, b);
        else buffer.preencode(state, b);
      },
      encode(state, b) {
        if (typeof b === "string") utf8.encode(state, b);
        else buffer.encode(state, b);
      }
    };
    exports2.arraybuffer = {
      preencode(state, b) {
        uint.preencode(state, b.byteLength);
        state.end += b.byteLength;
      },
      encode(state, b) {
        uint.encode(state, b.byteLength);
        const view = new Uint8Array(b);
        state.buffer.set(view, state.start);
        state.start += b.byteLength;
      },
      decode(state) {
        const len = uint.decode(state);
        const b = new ArrayBuffer(len);
        const view = new Uint8Array(b);
        view.set(state.buffer.subarray(state.start, state.start += len));
        return b;
      }
    };
    function typedarray(TypedArray, swap) {
      const n = TypedArray.BYTES_PER_ELEMENT;
      return {
        preencode(state, b) {
          uint.preencode(state, b.length);
          state.end += b.byteLength;
        },
        encode(state, b) {
          uint.encode(state, b.length);
          const view = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
          if (BE && swap) swap(view);
          state.buffer.set(view, state.start);
          state.start += b.byteLength;
        },
        decode(state) {
          const len = uint.decode(state);
          let b = state.buffer.subarray(state.start, state.start += len * n);
          if (b.byteLength !== len * n) throw new Error("Out of bounds");
          if (b.byteOffset % n !== 0) b = new Uint8Array(b);
          if (BE && swap) swap(b);
          return new TypedArray(b.buffer, b.byteOffset, b.byteLength / n);
        }
      };
    }
    var uint8array = exports2.uint8array = typedarray(Uint8Array);
    exports2.uint16array = typedarray(Uint16Array, b4a.swap16);
    exports2.uint32array = typedarray(Uint32Array, b4a.swap32);
    exports2.int8array = typedarray(Int8Array);
    exports2.int16array = typedarray(Int16Array, b4a.swap16);
    exports2.int32array = typedarray(Int32Array, b4a.swap32);
    exports2.biguint64array = typedarray(BigUint64Array, b4a.swap64);
    exports2.bigint64array = typedarray(BigInt64Array, b4a.swap64);
    exports2.float32array = typedarray(Float32Array, b4a.swap32);
    exports2.float64array = typedarray(Float64Array, b4a.swap64);
    function string(encoding) {
      return {
        preencode(state, s) {
          const len = b4a.byteLength(s, encoding);
          uint.preencode(state, len);
          state.end += len;
        },
        encode(state, s) {
          const len = b4a.byteLength(s, encoding);
          uint.encode(state, len);
          b4a.write(state.buffer, s, state.start, encoding);
          state.start += len;
        },
        decode(state) {
          const len = uint.decode(state);
          if (state.end - state.start < len) throw new Error("Out of bounds");
          return b4a.toString(
            state.buffer,
            encoding,
            state.start,
            state.start += len
          );
        },
        fixed(n) {
          return {
            preencode(state) {
              state.end += n;
            },
            encode(state, s) {
              b4a.write(state.buffer, s, state.start, n, encoding);
              state.start += n;
            },
            decode(state) {
              if (state.end - state.start < n) throw new Error("Out of bounds");
              return b4a.toString(
                state.buffer,
                encoding,
                state.start,
                state.start += n
              );
            }
          };
        }
      };
    }
    var utf8 = exports2.string = exports2.utf8 = string("utf-8");
    exports2.ascii = string("ascii");
    exports2.hex = string("hex");
    exports2.base64 = string("base64");
    exports2.ucs2 = exports2.utf16le = string("utf16le");
    exports2.bool = {
      preencode(state, b) {
        state.end++;
      },
      encode(state, b) {
        state.buffer[state.start++] = b ? 1 : 0;
      },
      decode(state) {
        if (state.start >= state.end) throw Error("Out of bounds");
        return state.buffer[state.start++] === 1;
      }
    };
    var fixed = exports2.fixed = function fixed2(n) {
      return {
        preencode(state, s) {
          if (s.byteLength !== n) throw new Error("Incorrect buffer size");
          state.end += n;
        },
        encode(state, s) {
          state.buffer.set(s, state.start);
          state.start += n;
        },
        decode(state) {
          if (state.end - state.start < n) throw new Error("Out of bounds");
          return state.buffer.subarray(state.start, state.start += n);
        }
      };
    };
    exports2.fixed32 = fixed(32);
    exports2.fixed64 = fixed(64);
    exports2.array = function array(enc) {
      return {
        preencode(state, list) {
          uint.preencode(state, list.length);
          for (let i = 0; i < list.length; i++) enc.preencode(state, list[i]);
        },
        encode(state, list) {
          uint.encode(state, list.length);
          for (let i = 0; i < list.length; i++) enc.encode(state, list[i]);
        },
        decode(state) {
          const len = uint.decode(state);
          if (len > 1048576) throw new Error("Array is too big");
          const arr = new Array(len);
          for (let i = 0; i < len; i++) arr[i] = enc.decode(state);
          return arr;
        }
      };
    };
    exports2.frame = function frame(enc) {
      const dummy = exports2.state();
      return {
        preencode(state, m) {
          const end = state.end;
          enc.preencode(state, m);
          uint.preencode(state, state.end - end);
        },
        encode(state, m) {
          dummy.end = 0;
          enc.preencode(dummy, m);
          uint.encode(state, dummy.end);
          enc.encode(state, m);
        },
        decode(state) {
          const end = state.end;
          const len = uint.decode(state);
          state.end = state.start + len;
          const m = enc.decode(state);
          state.start = state.end;
          state.end = end;
          return m;
        }
      };
    };
    exports2.date = {
      preencode(state, d) {
        int.preencode(state, d.getTime());
      },
      encode(state, d) {
        int.encode(state, d.getTime());
      },
      decode(state, d) {
        return new Date(int.decode(state));
      }
    };
    exports2.json = {
      preencode(state, v) {
        utf8.preencode(state, JSON.stringify(v));
      },
      encode(state, v) {
        utf8.encode(state, JSON.stringify(v));
      },
      decode(state) {
        return JSON.parse(utf8.decode(state));
      }
    };
    exports2.ndjson = {
      preencode(state, v) {
        utf8.preencode(state, JSON.stringify(v) + "\n");
      },
      encode(state, v) {
        utf8.encode(state, JSON.stringify(v) + "\n");
      },
      decode(state) {
        return JSON.parse(utf8.decode(state));
      }
    };
    exports2.none = {
      preencode(state, n) {
      },
      encode(state, n) {
      },
      decode(state) {
        return null;
      }
    };
    var anyArray = {
      preencode(state, arr) {
        uint.preencode(state, arr.length);
        for (let i = 0; i < arr.length; i++) {
          any.preencode(state, arr[i]);
        }
      },
      encode(state, arr) {
        uint.encode(state, arr.length);
        for (let i = 0; i < arr.length; i++) {
          any.encode(state, arr[i]);
        }
      },
      decode(state) {
        const arr = [];
        let len = uint.decode(state);
        while (len-- > 0) {
          arr.push(any.decode(state));
        }
        return arr;
      }
    };
    var anyObject = {
      preencode(state, o) {
        const keys = Object.keys(o);
        uint.preencode(state, keys.length);
        for (const key of keys) {
          utf8.preencode(state, key);
          any.preencode(state, o[key]);
        }
      },
      encode(state, o) {
        const keys = Object.keys(o);
        uint.encode(state, keys.length);
        for (const key of keys) {
          utf8.encode(state, key);
          any.encode(state, o[key]);
        }
      },
      decode(state) {
        let len = uint.decode(state);
        const o = {};
        while (len-- > 0) {
          const key = utf8.decode(state);
          o[key] = any.decode(state);
        }
        return o;
      }
    };
    var anyTypes = [
      exports2.none,
      exports2.bool,
      exports2.string,
      exports2.buffer,
      exports2.uint,
      exports2.int,
      exports2.float64,
      anyArray,
      anyObject,
      exports2.date
    ];
    var any = exports2.any = {
      preencode(state, o) {
        const t = getType(o);
        uint.preencode(state, t);
        anyTypes[t].preencode(state, o);
      },
      encode(state, o) {
        const t = getType(o);
        uint.encode(state, t);
        anyTypes[t].encode(state, o);
      },
      decode(state) {
        const t = uint.decode(state);
        if (t >= anyTypes.length) throw new Error("Unknown type: " + t);
        return anyTypes[t].decode(state);
      }
    };
    var port = exports2.port = uint16;
    var address = (host, family) => {
      return {
        preencode(state, m) {
          host.preencode(state, m.host);
          port.preencode(state, m.port);
        },
        encode(state, m) {
          host.encode(state, m.host);
          port.encode(state, m.port);
        },
        decode(state) {
          return {
            host: host.decode(state),
            family,
            port: port.decode(state)
          };
        }
      };
    };
    var ipv4 = exports2.ipv4 = {
      preencode(state) {
        state.end += 4;
      },
      encode(state, string2) {
        const start = state.start;
        const end = start + 4;
        let i = 0;
        while (i < string2.length) {
          let n = 0;
          let c2;
          while (i < string2.length && (c2 = string2.charCodeAt(i++)) !== /* . */
          46) {
            n = n * 10 + (c2 - /* 0 */
            48);
          }
          state.buffer[state.start++] = n;
        }
        state.start = end;
      },
      decode(state) {
        if (state.end - state.start < 4) throw new Error("Out of bounds");
        return state.buffer[state.start++] + "." + state.buffer[state.start++] + "." + state.buffer[state.start++] + "." + state.buffer[state.start++];
      }
    };
    exports2.ipv4Address = address(ipv4, 4);
    var ipv6 = exports2.ipv6 = {
      preencode(state) {
        state.end += 16;
      },
      encode(state, string2) {
        const start = state.start;
        const end = start + 16;
        let i = 0;
        let split = null;
        while (i < string2.length) {
          let n = 0;
          let c2;
          while (i < string2.length && (c2 = string2.charCodeAt(i++)) !== /* : */
          58) {
            if (c2 >= 48 && c2 <= 57) n = n * 16 + (c2 - /* 0 */
            48);
            else if (c2 >= 65 && c2 <= 70) n = n * 16 + (c2 - /* A */
            65 + 10);
            else if (c2 >= 97 && c2 <= 102) n = n * 16 + (c2 - /* a */
            97 + 10);
          }
          state.buffer[state.start++] = n >>> 8;
          state.buffer[state.start++] = n;
          if (i < string2.length && string2.charCodeAt(i) === /* : */
          58) {
            i++;
            split = state.start;
          }
        }
        if (split !== null) {
          const offset = end - state.start;
          state.buffer.copyWithin(split + offset, split).fill(0, split, split + offset);
        }
        state.start = end;
      },
      decode(state) {
        if (state.end - state.start < 16) throw new Error("Out of bounds");
        return (state.buffer[state.start++] * 256 + state.buffer[state.start++]).toString(16) + ":" + (state.buffer[state.start++] * 256 + state.buffer[state.start++]).toString(16) + ":" + (state.buffer[state.start++] * 256 + state.buffer[state.start++]).toString(16) + ":" + (state.buffer[state.start++] * 256 + state.buffer[state.start++]).toString(16) + ":" + (state.buffer[state.start++] * 256 + state.buffer[state.start++]).toString(16) + ":" + (state.buffer[state.start++] * 256 + state.buffer[state.start++]).toString(16) + ":" + (state.buffer[state.start++] * 256 + state.buffer[state.start++]).toString(16) + ":" + (state.buffer[state.start++] * 256 + state.buffer[state.start++]).toString(16);
      }
    };
    exports2.ipv6Address = address(ipv6, 6);
    var ip = exports2.ip = {
      preencode(state, string2) {
        const family = string2.includes(":") ? 6 : 4;
        uint8.preencode(state, family);
        if (family === 4) ipv4.preencode(state);
        else ipv6.preencode(state);
      },
      encode(state, string2) {
        const family = string2.includes(":") ? 6 : 4;
        uint8.encode(state, family);
        if (family === 4) ipv4.encode(state, string2);
        else ipv6.encode(state, string2);
      },
      decode(state) {
        const family = uint8.decode(state);
        if (family === 4) return ipv4.decode(state);
        else return ipv6.decode(state);
      }
    };
    exports2.ipAddress = {
      preencode(state, m) {
        ip.preencode(state, m.host);
        port.preencode(state, m.port);
      },
      encode(state, m) {
        ip.encode(state, m.host);
        port.encode(state, m.port);
      },
      decode(state) {
        const family = uint8.decode(state);
        return {
          host: family === 4 ? ipv4.decode(state) : ipv6.decode(state),
          family,
          port: port.decode(state)
        };
      }
    };
    var record = exports2.record = function(keyEncoding, valueEncoding) {
      return {
        preencode(state, v) {
          const keys = Object.keys(v);
          uint.preencode(state, keys.length);
          for (const k of keys) {
            keyEncoding.preencode(state, k);
            valueEncoding.preencode(state, v[k]);
          }
        },
        encode(state, v) {
          const keys = Object.keys(v);
          uint.encode(state, keys.length);
          for (const k of keys) {
            keyEncoding.encode(state, k);
            valueEncoding.encode(state, v[k]);
          }
        },
        decode(state) {
          const out = /* @__PURE__ */ Object.create(null);
          const keys = uint.decode(state);
          for (let i = 0; i < keys; i++) {
            out[keyEncoding.decode(state)] = valueEncoding.decode(state);
          }
          return out;
        }
      };
    };
    exports2.stringRecord = record(utf8, utf8);
    function getType(o) {
      if (o === null || o === void 0) return 0;
      if (typeof o === "boolean") return 1;
      if (typeof o === "string") return 2;
      if (b4a.isBuffer(o)) return 3;
      if (typeof o === "number") {
        if (Number.isInteger(o)) return o >= 0 ? 4 : 5;
        return 6;
      }
      if (Array.isArray(o)) return 7;
      if (o instanceof Date) return 9;
      if (typeof o === "object") return 8;
      throw new Error("Unsupported type for " + o);
    }
    exports2.from = function from(enc) {
      if (typeof enc === "string") return fromNamed(enc);
      if (enc.preencode) return enc;
      if (enc.encodingLength) return fromAbstractEncoder(enc);
      return fromCodec(enc);
    };
    function fromNamed(enc) {
      switch (enc) {
        case "ascii":
          return raw.ascii;
        case "utf-8":
        case "utf8":
          return raw.utf8;
        case "hex":
          return raw.hex;
        case "base64":
          return raw.base64;
        case "utf16-le":
        case "utf16le":
        case "ucs-2":
        case "ucs2":
          return raw.ucs2;
        case "ndjson":
          return raw.ndjson;
        case "json":
          return raw.json;
        case "binary":
        default:
          return raw.binary;
      }
    }
    function fromCodec(enc) {
      let tmpM = null;
      let tmpBuf = null;
      return {
        preencode(state, m) {
          tmpM = m;
          tmpBuf = enc.encode(m);
          state.end += tmpBuf.byteLength;
        },
        encode(state, m) {
          raw.encode(state, m === tmpM ? tmpBuf : enc.encode(m));
          tmpM = tmpBuf = null;
        },
        decode(state) {
          return enc.decode(raw.decode(state));
        }
      };
    }
    function fromAbstractEncoder(enc) {
      return {
        preencode(state, m) {
          state.end += enc.encodingLength(m);
        },
        encode(state, m) {
          enc.encode(m, state.buffer, state.start);
          state.start += enc.encode.bytes;
        },
        decode(state) {
          const m = enc.decode(state.buffer, state.start, state.end);
          state.start += enc.decode.bytes;
          return m;
        }
      };
    }
    exports2.encode = function encode(enc, m) {
      const state = exports2.state();
      enc.preencode(state, m);
      state.buffer = b4a.allocUnsafe(state.end);
      enc.encode(state, m);
      return state.buffer;
    };
    exports2.decode = function decode(enc, buffer2) {
      return enc.decode(exports2.state(0, buffer2.byteLength, buffer2));
    };
    function zigZagInt(enc) {
      return {
        preencode(state, n) {
          enc.preencode(state, zigZagEncodeInt(n));
        },
        encode(state, n) {
          enc.encode(state, zigZagEncodeInt(n));
        },
        decode(state) {
          return zigZagDecodeInt(enc.decode(state));
        }
      };
    }
    function zigZagDecodeInt(n) {
      return n === 0 ? n : (n & 1) === 0 ? n / 2 : -(n + 1) / 2;
    }
    function zigZagEncodeInt(n) {
      return n < 0 ? 2 * -n - 1 : n === 0 ? 0 : 2 * n;
    }
    function zigZagBigInt(enc) {
      return {
        preencode(state, n) {
          enc.preencode(state, zigZagEncodeBigInt(n));
        },
        encode(state, n) {
          enc.encode(state, zigZagEncodeBigInt(n));
        },
        decode(state) {
          return zigZagDecodeBigInt(enc.decode(state));
        }
      };
    }
    function zigZagDecodeBigInt(n) {
      return n === 0n ? n : (n & 1n) === 0n ? n / 2n : -(n + 1n) / 2n;
    }
    function zigZagEncodeBigInt(n) {
      return n < 0n ? 2n * -n - 1n : n === 0n ? 0n : 2n * n;
    }
    function validateUint(n) {
      if (n >= 0 === false)
        throw new Error("uint must be positive");
    }
  }
});

// node_modules/compact-encoding-struct/bitfield.js
var require_bitfield = __commonJS({
  "node_modules/compact-encoding-struct/bitfield.js"(exports2, module2) {
    var c2 = require_compact_encoding();
    module2.exports = {
      preencode(state, bits = [], prev) {
        c2.uint.preencode(state, bitsToNumberLE(bits));
      },
      encode(state, bits = []) {
        const num = bitsToNumberLE(bits);
        c2.uint.encode(state, num);
      },
      decode(state) {
        const num = c2.uint.decode(state);
        return numberToBitsLE(num);
      }
    };
    function bitsToNumberLE(bits) {
      let num = 0;
      for (let i = 0; i < bits.length; i++) {
        num |= bits[i] << i;
      }
      return num;
    }
    function numberToBitsLE(num) {
      const bits = [];
      while (num > 0) {
        bits.push(num & 1);
        num >>>= 1;
      }
      return bits;
    }
  }
});

// node_modules/compact-encoding-struct/index.js
var require_compact_encoding_struct = __commonJS({
  "node_modules/compact-encoding-struct/index.js"(exports2, module2) {
    var c2 = require_compact_encoding();
    var bitfield = require_bitfield();
    module2.exports = {
      compile: compile2,
      opt,
      array,
      constant,
      header,
      getHeader,
      either
    };
    function compile2(struct) {
      function preencode(state, msg) {
        if (!state.headers) state.headers = [];
        const headerIndex = state.headers.length;
        const header2 = {};
        header2.flag = [];
        header2.opt = [];
        header2.state = {
          start: 0,
          end: 0,
          buffer: null
        };
        for (const [field, cenc2] of Object.entries(struct)) {
          const enc = parseArray(cenc2);
          enc.preencode(state, msg[field], header2);
        }
        bitfield.preencode(header2.state, header2.flag);
        bitfield.preencode(header2.state, header2.opt);
        state.headers.splice(headerIndex, -1, header2);
        c2.uint.preencode(state, header2.state.end);
        state.end += header2.state.end;
      }
      function encode(state, msg) {
        const header2 = state.headers.shift();
        header2.state.buffer = Buffer.alloc(header2.state.end);
        const headerOffset = state.start;
        c2.buffer.encode(state, header2.state.buffer);
        bitfield.encode(header2.state, header2.flag);
        bitfield.encode(header2.state, header2.opt);
        for (const [field, cenc2] of Object.entries(struct)) {
          const enc = parseArray(cenc2);
          enc.encode(state, msg[field], header2);
        }
        const finalOffset = state.start;
        state.start = headerOffset;
        c2.buffer.encode(state, header2.state.buffer);
        state.start = finalOffset;
      }
      function decode(state) {
        const buffer = c2.buffer.decode(state);
        const header2 = {
          start: 0,
          end: buffer.byteLength,
          buffer
        };
        const flag = bitfield.decode(header2);
        const opt2 = bitfield.decode(header2);
        const ret = {};
        for (const [field, cenc2] of Object.entries(struct)) {
          const enc = parseArray(cenc2);
          ret[field] = enc.decode(state, { flag, opt: opt2, state: header2 });
        }
        return ret;
      }
      return {
        preencode,
        encode,
        decode
      };
    }
    function getHeader(buf, struct) {
      const buffer = c2.decode(c2.buffer, buf);
      const state = {
        start: 0,
        end: buffer.byteLength,
        buffer
      };
      const flag = bitfield.decode(state);
      const opt2 = bitfield.decode(state);
      const ret = {};
      for (const [field, cenc2] of Object.entries(struct)) {
        const enc = parseArray(cenc2);
        ret[field] = enc.decode(state, { flag, opt: opt2, state });
      }
      return ret;
    }
    function opt(enc, defaultVal = null) {
      const cenc2 = parseArray(enc);
      return {
        preencode(state, opt2, header2) {
          if (opt2) cenc2.preencode(header2.state, opt2);
          header2.opt.push(!!opt2);
        },
        encode(state, opt2, header2) {
          if (header2.opt.shift()) cenc2.encode(header2.state, opt2);
        },
        decode(state, header2) {
          if (!header2.opt.shift()) return defaultVal;
          return cenc2.decode(header2.state);
        }
      };
    }
    function constant(enc, value) {
      return {
        preencode(state) {
          enc.preencode(state, value);
        },
        encode(state) {
          enc.encode(state, value);
        },
        decode(state) {
          const prop = enc.decode(state);
          if (!same(prop, value)) {
            throw new Error(`Expect constant value: ${value}, got ${prop}`);
          }
          return value;
        }
      };
    }
    function header(enc) {
      return {
        preencode(state, value, header2) {
          enc.preencode(header2.state, value);
        },
        encode(state, value, header2) {
          enc.encode(header2.state, value);
        },
        decode(state, header2) {
          return enc.decode(header2.state);
        }
      };
    }
    function array(enc) {
      return [enc];
    }
    module2.exports.flag = {
      preencode(state, bool, header2) {
        header2.flag.push(bool);
      },
      encode() {
      },
      // ignore
      decode(state, header2) {
        return !!header2.flag.shift();
      }
    };
    function either(encodings, test) {
      return {
        preencode(state, value) {
          const index = test(value);
          c2.uint.preencode(state, index);
          encodings[index].preencode(state, value);
        },
        encode(state, value) {
          const index = test(value);
          c2.uint.encode(state, index);
          encodings[index].encode(state, value);
        },
        decode(state) {
          const index = c2.uint.decode(state);
          return encodings[index].decode(state);
        }
      };
    }
    function parseArray(enc) {
      let nest = 0;
      while (Array.isArray(enc)) {
        enc = enc[0];
        nest++;
      }
      for (let i = 0; i < nest; i++) enc = c2.array(enc);
      return enc;
    }
    function same(a, b) {
      if (typeof a !== typeof b) return false;
      if (typeof a === "number" || typeof a === "string") return a === b;
      if (a instanceof Uint8Array) {
        if (!(b instanceof Uint8Array)) return false;
        return Buffer.compare(a, b) === 0;
      }
      return false;
    }
  }
});

// node_modules/url-pattern/lib/url-pattern.js
var require_url_pattern = __commonJS({
  "node_modules/url-pattern/lib/url-pattern.js"(exports2, module2) {
    var slice = [].slice;
    (function(root, factory) {
      if ("function" === typeof define && define.amd != null) {
        return define([], factory);
      } else if (typeof exports2 !== "undefined" && exports2 !== null) {
        return module2.exports = factory();
      } else {
        return root.UrlPattern = factory();
      }
    })(exports2, function() {
      var P, UrlPattern, astNodeContainsSegmentsForProvidedParams, astNodeToNames, astNodeToRegexString, baseAstNodeToRegexString, concatMap, defaultOptions, escapeForRegex, getParam, keysAndValuesToObject, newParser, regexGroupCount, stringConcatMap, stringify;
      escapeForRegex = function(string) {
        return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
      };
      concatMap = function(array, f) {
        var i, length, results;
        results = [];
        i = -1;
        length = array.length;
        while (++i < length) {
          results = results.concat(f(array[i]));
        }
        return results;
      };
      stringConcatMap = function(array, f) {
        var i, length, result;
        result = "";
        i = -1;
        length = array.length;
        while (++i < length) {
          result += f(array[i]);
        }
        return result;
      };
      regexGroupCount = function(regex) {
        return new RegExp(regex.toString() + "|").exec("").length - 1;
      };
      keysAndValuesToObject = function(keys, values) {
        var i, key, length, object, value;
        object = {};
        i = -1;
        length = keys.length;
        while (++i < length) {
          key = keys[i];
          value = values[i];
          if (value == null) {
            continue;
          }
          if (object[key] != null) {
            if (!Array.isArray(object[key])) {
              object[key] = [object[key]];
            }
            object[key].push(value);
          } else {
            object[key] = value;
          }
        }
        return object;
      };
      P = {};
      P.Result = function(value, rest) {
        this.value = value;
        this.rest = rest;
      };
      P.Tagged = function(tag, value) {
        this.tag = tag;
        this.value = value;
      };
      P.tag = function(tag, parser) {
        return function(input) {
          var result, tagged;
          result = parser(input);
          if (result == null) {
            return;
          }
          tagged = new P.Tagged(tag, result.value);
          return new P.Result(tagged, result.rest);
        };
      };
      P.regex = function(regex) {
        return function(input) {
          var matches, result;
          matches = regex.exec(input);
          if (matches == null) {
            return;
          }
          result = matches[0];
          return new P.Result(result, input.slice(result.length));
        };
      };
      P.sequence = function() {
        var parsers;
        parsers = 1 <= arguments.length ? slice.call(arguments, 0) : [];
        return function(input) {
          var i, length, parser, rest, result, values;
          i = -1;
          length = parsers.length;
          values = [];
          rest = input;
          while (++i < length) {
            parser = parsers[i];
            result = parser(rest);
            if (result == null) {
              return;
            }
            values.push(result.value);
            rest = result.rest;
          }
          return new P.Result(values, rest);
        };
      };
      P.pick = function() {
        var indexes, parsers;
        indexes = arguments[0], parsers = 2 <= arguments.length ? slice.call(arguments, 1) : [];
        return function(input) {
          var array, result;
          result = P.sequence.apply(P, parsers)(input);
          if (result == null) {
            return;
          }
          array = result.value;
          result.value = array[indexes];
          return result;
        };
      };
      P.string = function(string) {
        var length;
        length = string.length;
        return function(input) {
          if (input.slice(0, length) === string) {
            return new P.Result(string, input.slice(length));
          }
        };
      };
      P.lazy = function(fn) {
        var cached;
        cached = null;
        return function(input) {
          if (cached == null) {
            cached = fn();
          }
          return cached(input);
        };
      };
      P.baseMany = function(parser, end, stringResult, atLeastOneResultRequired, input) {
        var endResult, parserResult, rest, results;
        rest = input;
        results = stringResult ? "" : [];
        while (true) {
          if (end != null) {
            endResult = end(rest);
            if (endResult != null) {
              break;
            }
          }
          parserResult = parser(rest);
          if (parserResult == null) {
            break;
          }
          if (stringResult) {
            results += parserResult.value;
          } else {
            results.push(parserResult.value);
          }
          rest = parserResult.rest;
        }
        if (atLeastOneResultRequired && results.length === 0) {
          return;
        }
        return new P.Result(results, rest);
      };
      P.many1 = function(parser) {
        return function(input) {
          return P.baseMany(parser, null, false, true, input);
        };
      };
      P.concatMany1Till = function(parser, end) {
        return function(input) {
          return P.baseMany(parser, end, true, true, input);
        };
      };
      P.firstChoice = function() {
        var parsers;
        parsers = 1 <= arguments.length ? slice.call(arguments, 0) : [];
        return function(input) {
          var i, length, parser, result;
          i = -1;
          length = parsers.length;
          while (++i < length) {
            parser = parsers[i];
            result = parser(input);
            if (result != null) {
              return result;
            }
          }
        };
      };
      newParser = function(options) {
        var U;
        U = {};
        U.wildcard = P.tag("wildcard", P.string(options.wildcardChar));
        U.optional = P.tag("optional", P.pick(1, P.string(options.optionalSegmentStartChar), P.lazy(function() {
          return U.pattern;
        }), P.string(options.optionalSegmentEndChar)));
        U.name = P.regex(new RegExp("^[" + options.segmentNameCharset + "]+"));
        U.named = P.tag("named", P.pick(1, P.string(options.segmentNameStartChar), P.lazy(function() {
          return U.name;
        })));
        U.escapedChar = P.pick(1, P.string(options.escapeChar), P.regex(/^./));
        U["static"] = P.tag("static", P.concatMany1Till(P.firstChoice(P.lazy(function() {
          return U.escapedChar;
        }), P.regex(/^./)), P.firstChoice(P.string(options.segmentNameStartChar), P.string(options.optionalSegmentStartChar), P.string(options.optionalSegmentEndChar), U.wildcard)));
        U.token = P.lazy(function() {
          return P.firstChoice(U.wildcard, U.optional, U.named, U["static"]);
        });
        U.pattern = P.many1(P.lazy(function() {
          return U.token;
        }));
        return U;
      };
      defaultOptions = {
        escapeChar: "\\",
        segmentNameStartChar: ":",
        segmentValueCharset: "a-zA-Z0-9-_~ %",
        segmentNameCharset: "a-zA-Z0-9",
        optionalSegmentStartChar: "(",
        optionalSegmentEndChar: ")",
        wildcardChar: "*"
      };
      baseAstNodeToRegexString = function(astNode, segmentValueCharset) {
        if (Array.isArray(astNode)) {
          return stringConcatMap(astNode, function(node) {
            return baseAstNodeToRegexString(node, segmentValueCharset);
          });
        }
        switch (astNode.tag) {
          case "wildcard":
            return "(.*?)";
          case "named":
            return "([" + segmentValueCharset + "]+)";
          case "static":
            return escapeForRegex(astNode.value);
          case "optional":
            return "(?:" + baseAstNodeToRegexString(astNode.value, segmentValueCharset) + ")?";
        }
      };
      astNodeToRegexString = function(astNode, segmentValueCharset) {
        if (segmentValueCharset == null) {
          segmentValueCharset = defaultOptions.segmentValueCharset;
        }
        return "^" + baseAstNodeToRegexString(astNode, segmentValueCharset) + "$";
      };
      astNodeToNames = function(astNode) {
        if (Array.isArray(astNode)) {
          return concatMap(astNode, astNodeToNames);
        }
        switch (astNode.tag) {
          case "wildcard":
            return ["_"];
          case "named":
            return [astNode.value];
          case "static":
            return [];
          case "optional":
            return astNodeToNames(astNode.value);
        }
      };
      getParam = function(params, key, nextIndexes, sideEffects) {
        var index, maxIndex, result, value;
        if (sideEffects == null) {
          sideEffects = false;
        }
        value = params[key];
        if (value == null) {
          if (sideEffects) {
            throw new Error("no values provided for key `" + key + "`");
          } else {
            return;
          }
        }
        index = nextIndexes[key] || 0;
        maxIndex = Array.isArray(value) ? value.length - 1 : 0;
        if (index > maxIndex) {
          if (sideEffects) {
            throw new Error("too few values provided for key `" + key + "`");
          } else {
            return;
          }
        }
        result = Array.isArray(value) ? value[index] : value;
        if (sideEffects) {
          nextIndexes[key] = index + 1;
        }
        return result;
      };
      astNodeContainsSegmentsForProvidedParams = function(astNode, params, nextIndexes) {
        var i, length;
        if (Array.isArray(astNode)) {
          i = -1;
          length = astNode.length;
          while (++i < length) {
            if (astNodeContainsSegmentsForProvidedParams(astNode[i], params, nextIndexes)) {
              return true;
            }
          }
          return false;
        }
        switch (astNode.tag) {
          case "wildcard":
            return getParam(params, "_", nextIndexes, false) != null;
          case "named":
            return getParam(params, astNode.value, nextIndexes, false) != null;
          case "static":
            return false;
          case "optional":
            return astNodeContainsSegmentsForProvidedParams(astNode.value, params, nextIndexes);
        }
      };
      stringify = function(astNode, params, nextIndexes) {
        if (Array.isArray(astNode)) {
          return stringConcatMap(astNode, function(node) {
            return stringify(node, params, nextIndexes);
          });
        }
        switch (astNode.tag) {
          case "wildcard":
            return getParam(params, "_", nextIndexes, true);
          case "named":
            return getParam(params, astNode.value, nextIndexes, true);
          case "static":
            return astNode.value;
          case "optional":
            if (astNodeContainsSegmentsForProvidedParams(astNode.value, params, nextIndexes)) {
              return stringify(astNode.value, params, nextIndexes);
            } else {
              return "";
            }
        }
      };
      UrlPattern = function(arg1, arg2) {
        var groupCount, options, parsed, parser, withoutWhitespace;
        if (arg1 instanceof UrlPattern) {
          this.isRegex = arg1.isRegex;
          this.regex = arg1.regex;
          this.ast = arg1.ast;
          this.names = arg1.names;
          return;
        }
        this.isRegex = arg1 instanceof RegExp;
        if (!("string" === typeof arg1 || this.isRegex)) {
          throw new TypeError("argument must be a regex or a string");
        }
        if (this.isRegex) {
          this.regex = arg1;
          if (arg2 != null) {
            if (!Array.isArray(arg2)) {
              throw new Error("if first argument is a regex the second argument may be an array of group names but you provided something else");
            }
            groupCount = regexGroupCount(this.regex);
            if (arg2.length !== groupCount) {
              throw new Error("regex contains " + groupCount + " groups but array of group names contains " + arg2.length);
            }
            this.names = arg2;
          }
          return;
        }
        if (arg1 === "") {
          throw new Error("argument must not be the empty string");
        }
        withoutWhitespace = arg1.replace(/\s+/g, "");
        if (withoutWhitespace !== arg1) {
          throw new Error("argument must not contain whitespace");
        }
        options = {
          escapeChar: (arg2 != null ? arg2.escapeChar : void 0) || defaultOptions.escapeChar,
          segmentNameStartChar: (arg2 != null ? arg2.segmentNameStartChar : void 0) || defaultOptions.segmentNameStartChar,
          segmentNameCharset: (arg2 != null ? arg2.segmentNameCharset : void 0) || defaultOptions.segmentNameCharset,
          segmentValueCharset: (arg2 != null ? arg2.segmentValueCharset : void 0) || defaultOptions.segmentValueCharset,
          optionalSegmentStartChar: (arg2 != null ? arg2.optionalSegmentStartChar : void 0) || defaultOptions.optionalSegmentStartChar,
          optionalSegmentEndChar: (arg2 != null ? arg2.optionalSegmentEndChar : void 0) || defaultOptions.optionalSegmentEndChar,
          wildcardChar: (arg2 != null ? arg2.wildcardChar : void 0) || defaultOptions.wildcardChar
        };
        parser = newParser(options);
        parsed = parser.pattern(arg1);
        if (parsed == null) {
          throw new Error("couldn't parse pattern");
        }
        if (parsed.rest !== "") {
          throw new Error("could only partially parse pattern");
        }
        this.ast = parsed.value;
        this.regex = new RegExp(astNodeToRegexString(this.ast, options.segmentValueCharset));
        this.names = astNodeToNames(this.ast);
      };
      UrlPattern.prototype.match = function(url) {
        var groups, match;
        match = this.regex.exec(url);
        if (match == null) {
          return null;
        }
        groups = match.slice(1);
        if (this.names) {
          return keysAndValuesToObject(this.names, groups);
        } else {
          return groups;
        }
      };
      UrlPattern.prototype.stringify = function(params) {
        if (params == null) {
          params = {};
        }
        if (this.isRegex) {
          throw new Error("can't stringify patterns generated from a regex");
        }
        if (params !== Object(params)) {
          throw new Error("argument must be an object or undefined");
        }
        return stringify(this.ast, params, {});
      };
      UrlPattern.escapeForRegex = escapeForRegex;
      UrlPattern.concatMap = concatMap;
      UrlPattern.stringConcatMap = stringConcatMap;
      UrlPattern.regexGroupCount = regexGroupCount;
      UrlPattern.keysAndValuesToObject = keysAndValuesToObject;
      UrlPattern.P = P;
      UrlPattern.newParser = newParser;
      UrlPattern.defaultOptions = defaultOptions;
      UrlPattern.astNodeToRegexString = astNodeToRegexString;
      UrlPattern.astNodeToNames = astNodeToNames;
      UrlPattern.getParam = getParam;
      UrlPattern.astNodeContainsSegmentsForProvidedParams = astNodeContainsSegmentsForProvidedParams;
      UrlPattern.stringify = stringify;
      return UrlPattern;
    });
  }
});

// router-entry.mjs
var router_entry_exports = {};
__export(router_entry_exports, {
  PearRequestRouter: () => PearRequestRouter,
  registerRoutes: () => registerRoutes
});
module.exports = __toCommonJS(router_entry_exports);

// node_modules/pear-request/dist/router.js
var import_compact_encoding = __toESM(require_compact_encoding(), 1);
var import_compact_encoding_struct = __toESM(require_compact_encoding_struct(), 1);
var import_compact_encoding2 = __toESM(require_compact_encoding(), 1);
var import_url_pattern = __toESM(require_url_pattern(), 1);
var requestEncoding = (0, import_compact_encoding_struct.compile)({
  id: import_compact_encoding.default.string,
  body: import_compact_encoding.default.buffer,
  url: import_compact_encoding.default.string,
  method: import_compact_encoding.default.string
});
var responseEncoding = (0, import_compact_encoding_struct.compile)({
  id: import_compact_encoding.default.string,
  body: import_compact_encoding.default.buffer,
  headers: import_compact_encoding.default.json,
  status: import_compact_encoding.default.uint16
});
var PearRequestRouter = class {
  routes = [];
  pipe;
  constructor(pipe) {
    this.pipe = pipe;
  }
  route(method, path, handler) {
    this.routes.push({ method, path, handler });
  }
  get(path, handler) {
    this.route("GET", path, handler);
  }
  put(path, handler) {
    this.route("PUT", path, handler);
  }
  post(path, handler) {
    this.route("POST", path, handler);
  }
  delete(path, handler) {
    this.route("DELETE", path, handler);
  }
  async sendResponse(response) {
    const body = response.body ? Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body, "utf-8") : Buffer.alloc(0);
    const message = {
      id: response.id,
      body,
      headers: response.headers || { "Content-Type": "text/html" },
      status: response.status || 200
    };
    const encoded = import_compact_encoding2.default.encode(responseEncoding, message);
    const encodedLength = import_compact_encoding2.default.encode(import_compact_encoding2.default.uint32, encoded.length);
    const canWrite = this.pipe.write(Buffer.concat([encodedLength, encoded]));
    if (!canWrite) {
      await new Promise((resolve) => this.pipe.once("drain", resolve));
    }
  }
  async handleRequest(request) {
    const { method, url, id } = request;
    const [path, query] = url.split("?");
    if (!path) {
      throw new Error("Invalid URL");
    }
    const [route, params] = this.routes.reduce((acc, r) => {
      const pattern = new import_url_pattern.default(r.path);
      const match = pattern.match(path);
      if (r.method.toLowerCase() !== method.toLowerCase()) {
        return acc;
      }
      return match ? [r, match] : acc;
    }, [null, null]);
    if (route) {
      try {
        const response = {
          id,
          body: null,
          headers: { "Content-Type": "text/html" }
        };
        await route.handler({ ...request, params }, response);
        await this.sendResponse(response);
      } catch (error) {
        console.error("Route handler error:", error);
        this.sendResponse({
          id,
          body: Buffer.from("Internal Server Error", "utf-8"),
          headers: { "Content-Type": "text/plain" },
          status: 500
        });
      }
    } else {
      this.sendResponse({
        id,
        body: Buffer.from("Not Found", "utf-8"),
        headers: { "Content-Type": "text/plain" },
        status: 404
      });
    }
  }
  async processMessage(message) {
    const { method, body, url, id } = import_compact_encoding2.default.decode(requestEncoding, message);
    await this.handleRequest({ method, url, body, id });
  }
};

// counter-routes.mjs
var PAGE = `<!-- served by a Pear worker, streamed over a pipe -->
<div id="root" style="font:16px/1.5 system-ui;max-width:560px;margin:40px auto;color:#e6e6e6">
  <h2 style="margin:0 0 4px">\u{1F350} Headless htmx app</h2>
  <p style="opacity:.7;margin:.2em 0 1.2em">
    This UI is served by a Pear <b>worker</b> with no window and no HTTP server.
    <code>XMLHttpRequest</code> is hooked to a <b>streamx</b> \u2014 htmx thinks it's
    talking to a server.
  </p>
  <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px">
    <button hx-post="/inc" hx-target="#count" hx-swap="innerHTML"
      style="padding:8px 14px;border-radius:8px;border:0;background:#16a34a;color:#fff;font-weight:600;cursor:pointer">Count +1</button>
    <button hx-post="/reset" hx-target="#count" hx-swap="innerHTML"
      style="padding:8px 14px;border-radius:8px;border:1px solid #444;background:transparent;color:#ccc;cursor:pointer">reset</button>
    <strong style="margin-left:auto">Count: <span id="count">0</span></strong>
  </div>
  <div id="who" hx-get="/whoami" hx-trigger="load" hx-swap="innerHTML"
    style="font:13px ui-monospace,monospace;opacity:.7"></div>
</div>`;
function registerRoutes(router, ctx = {}) {
  const state = { count: 0, started: ctx.startedAt || 0, label: ctx.label || "worker" };
  router.get("/", async (req, res) => {
    res.body = PAGE;
    res.headers = { "Content-Type": "text/html" };
  });
  router.post("/inc", async (req, res) => {
    state.count++;
    res.body = String(state.count);
    res.headers = { "Content-Type": "text/html" };
  });
  router.post("/reset", async (req, res) => {
    state.count = 0;
    res.body = "0";
    res.headers = { "Content-Type": "text/html" };
  });
  router.get("/whoami", async (req, res) => {
    res.body = `served headless by <b>${state.label}</b> \xB7 requests over a stream \xB7 count=${state.count}`;
    res.headers = { "Content-Type": "text/html" };
  });
  return state;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PearRequestRouter,
  registerRoutes
});
