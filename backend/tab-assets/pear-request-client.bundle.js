(() => {
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

  // node_modules/base64-js/index.js
  var require_base64_js = __commonJS({
    "node_modules/base64-js/index.js"(exports) {
      "use strict";
      exports.byteLength = byteLength;
      exports.toByteArray = toByteArray;
      exports.fromByteArray = fromByteArray;
      var lookup = [];
      var revLookup = [];
      var Arr = typeof Uint8Array !== "undefined" ? Uint8Array : Array;
      var code = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      for (i = 0, len = code.length; i < len; ++i) {
        lookup[i] = code[i];
        revLookup[code.charCodeAt(i)] = i;
      }
      var i;
      var len;
      revLookup["-".charCodeAt(0)] = 62;
      revLookup["_".charCodeAt(0)] = 63;
      function getLens(b64) {
        var len2 = b64.length;
        if (len2 % 4 > 0) {
          throw new Error("Invalid string. Length must be a multiple of 4");
        }
        var validLen = b64.indexOf("=");
        if (validLen === -1) validLen = len2;
        var placeHoldersLen = validLen === len2 ? 0 : 4 - validLen % 4;
        return [validLen, placeHoldersLen];
      }
      function byteLength(b64) {
        var lens = getLens(b64);
        var validLen = lens[0];
        var placeHoldersLen = lens[1];
        return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
      }
      function _byteLength(b64, validLen, placeHoldersLen) {
        return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
      }
      function toByteArray(b64) {
        var tmp;
        var lens = getLens(b64);
        var validLen = lens[0];
        var placeHoldersLen = lens[1];
        var arr = new Arr(_byteLength(b64, validLen, placeHoldersLen));
        var curByte = 0;
        var len2 = placeHoldersLen > 0 ? validLen - 4 : validLen;
        var i2;
        for (i2 = 0; i2 < len2; i2 += 4) {
          tmp = revLookup[b64.charCodeAt(i2)] << 18 | revLookup[b64.charCodeAt(i2 + 1)] << 12 | revLookup[b64.charCodeAt(i2 + 2)] << 6 | revLookup[b64.charCodeAt(i2 + 3)];
          arr[curByte++] = tmp >> 16 & 255;
          arr[curByte++] = tmp >> 8 & 255;
          arr[curByte++] = tmp & 255;
        }
        if (placeHoldersLen === 2) {
          tmp = revLookup[b64.charCodeAt(i2)] << 2 | revLookup[b64.charCodeAt(i2 + 1)] >> 4;
          arr[curByte++] = tmp & 255;
        }
        if (placeHoldersLen === 1) {
          tmp = revLookup[b64.charCodeAt(i2)] << 10 | revLookup[b64.charCodeAt(i2 + 1)] << 4 | revLookup[b64.charCodeAt(i2 + 2)] >> 2;
          arr[curByte++] = tmp >> 8 & 255;
          arr[curByte++] = tmp & 255;
        }
        return arr;
      }
      function tripletToBase64(num) {
        return lookup[num >> 18 & 63] + lookup[num >> 12 & 63] + lookup[num >> 6 & 63] + lookup[num & 63];
      }
      function encodeChunk(uint8, start, end) {
        var tmp;
        var output = [];
        for (var i2 = start; i2 < end; i2 += 3) {
          tmp = (uint8[i2] << 16 & 16711680) + (uint8[i2 + 1] << 8 & 65280) + (uint8[i2 + 2] & 255);
          output.push(tripletToBase64(tmp));
        }
        return output.join("");
      }
      function fromByteArray(uint8) {
        var tmp;
        var len2 = uint8.length;
        var extraBytes = len2 % 3;
        var parts = [];
        var maxChunkLength = 16383;
        for (var i2 = 0, len22 = len2 - extraBytes; i2 < len22; i2 += maxChunkLength) {
          parts.push(encodeChunk(uint8, i2, i2 + maxChunkLength > len22 ? len22 : i2 + maxChunkLength));
        }
        if (extraBytes === 1) {
          tmp = uint8[len2 - 1];
          parts.push(
            lookup[tmp >> 2] + lookup[tmp << 4 & 63] + "=="
          );
        } else if (extraBytes === 2) {
          tmp = (uint8[len2 - 2] << 8) + uint8[len2 - 1];
          parts.push(
            lookup[tmp >> 10] + lookup[tmp >> 4 & 63] + lookup[tmp << 2 & 63] + "="
          );
        }
        return parts.join("");
      }
    }
  });

  // node_modules/ieee754/index.js
  var require_ieee754 = __commonJS({
    "node_modules/ieee754/index.js"(exports) {
      exports.read = function(buffer, offset, isLE, mLen, nBytes) {
        var e, m;
        var eLen = nBytes * 8 - mLen - 1;
        var eMax = (1 << eLen) - 1;
        var eBias = eMax >> 1;
        var nBits = -7;
        var i = isLE ? nBytes - 1 : 0;
        var d = isLE ? -1 : 1;
        var s = buffer[offset + i];
        i += d;
        e = s & (1 << -nBits) - 1;
        s >>= -nBits;
        nBits += eLen;
        for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {
        }
        m = e & (1 << -nBits) - 1;
        e >>= -nBits;
        nBits += mLen;
        for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {
        }
        if (e === 0) {
          e = 1 - eBias;
        } else if (e === eMax) {
          return m ? NaN : (s ? -1 : 1) * Infinity;
        } else {
          m = m + Math.pow(2, mLen);
          e = e - eBias;
        }
        return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
      };
      exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
        var e, m, c2;
        var eLen = nBytes * 8 - mLen - 1;
        var eMax = (1 << eLen) - 1;
        var eBias = eMax >> 1;
        var rt = mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0;
        var i = isLE ? 0 : nBytes - 1;
        var d = isLE ? 1 : -1;
        var s = value < 0 || value === 0 && 1 / value < 0 ? 1 : 0;
        value = Math.abs(value);
        if (isNaN(value) || value === Infinity) {
          m = isNaN(value) ? 1 : 0;
          e = eMax;
        } else {
          e = Math.floor(Math.log(value) / Math.LN2);
          if (value * (c2 = Math.pow(2, -e)) < 1) {
            e--;
            c2 *= 2;
          }
          if (e + eBias >= 1) {
            value += rt / c2;
          } else {
            value += rt * Math.pow(2, 1 - eBias);
          }
          if (value * c2 >= 2) {
            e++;
            c2 /= 2;
          }
          if (e + eBias >= eMax) {
            m = 0;
            e = eMax;
          } else if (e + eBias >= 1) {
            m = (value * c2 - 1) * Math.pow(2, mLen);
            e = e + eBias;
          } else {
            m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
            e = 0;
          }
        }
        for (; mLen >= 8; buffer[offset + i] = m & 255, i += d, m /= 256, mLen -= 8) {
        }
        e = e << mLen | m;
        eLen += mLen;
        for (; eLen > 0; buffer[offset + i] = e & 255, i += d, e /= 256, eLen -= 8) {
        }
        buffer[offset + i - d] |= s * 128;
      };
    }
  });

  // node_modules/buffer/index.js
  var require_buffer = __commonJS({
    "node_modules/buffer/index.js"(exports) {
      "use strict";
      var base64 = require_base64_js();
      var ieee754 = require_ieee754();
      var customInspectSymbol = typeof Symbol === "function" && typeof Symbol["for"] === "function" ? Symbol["for"]("nodejs.util.inspect.custom") : null;
      exports.Buffer = Buffer3;
      exports.SlowBuffer = SlowBuffer;
      exports.INSPECT_MAX_BYTES = 50;
      var K_MAX_LENGTH = 2147483647;
      exports.kMaxLength = K_MAX_LENGTH;
      Buffer3.TYPED_ARRAY_SUPPORT = typedArraySupport();
      if (!Buffer3.TYPED_ARRAY_SUPPORT && typeof console !== "undefined" && typeof console.error === "function") {
        console.error(
          "This browser lacks typed array (Uint8Array) support which is required by `buffer` v5.x. Use `buffer` v4.x if you require old browser support."
        );
      }
      function typedArraySupport() {
        try {
          const arr = new Uint8Array(1);
          const proto = { foo: function() {
            return 42;
          } };
          Object.setPrototypeOf(proto, Uint8Array.prototype);
          Object.setPrototypeOf(arr, proto);
          return arr.foo() === 42;
        } catch (e) {
          return false;
        }
      }
      Object.defineProperty(Buffer3.prototype, "parent", {
        enumerable: true,
        get: function() {
          if (!Buffer3.isBuffer(this)) return void 0;
          return this.buffer;
        }
      });
      Object.defineProperty(Buffer3.prototype, "offset", {
        enumerable: true,
        get: function() {
          if (!Buffer3.isBuffer(this)) return void 0;
          return this.byteOffset;
        }
      });
      function createBuffer(length) {
        if (length > K_MAX_LENGTH) {
          throw new RangeError('The value "' + length + '" is invalid for option "size"');
        }
        const buf = new Uint8Array(length);
        Object.setPrototypeOf(buf, Buffer3.prototype);
        return buf;
      }
      function Buffer3(arg, encodingOrOffset, length) {
        if (typeof arg === "number") {
          if (typeof encodingOrOffset === "string") {
            throw new TypeError(
              'The "string" argument must be of type string. Received type number'
            );
          }
          return allocUnsafe(arg);
        }
        return from(arg, encodingOrOffset, length);
      }
      Buffer3.poolSize = 8192;
      function from(value, encodingOrOffset, length) {
        if (typeof value === "string") {
          return fromString(value, encodingOrOffset);
        }
        if (ArrayBuffer.isView(value)) {
          return fromArrayView(value);
        }
        if (value == null) {
          throw new TypeError(
            "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof value
          );
        }
        if (isInstance(value, ArrayBuffer) || value && isInstance(value.buffer, ArrayBuffer)) {
          return fromArrayBuffer(value, encodingOrOffset, length);
        }
        if (typeof SharedArrayBuffer !== "undefined" && (isInstance(value, SharedArrayBuffer) || value && isInstance(value.buffer, SharedArrayBuffer))) {
          return fromArrayBuffer(value, encodingOrOffset, length);
        }
        if (typeof value === "number") {
          throw new TypeError(
            'The "value" argument must not be of type number. Received type number'
          );
        }
        const valueOf = value.valueOf && value.valueOf();
        if (valueOf != null && valueOf !== value) {
          return Buffer3.from(valueOf, encodingOrOffset, length);
        }
        const b = fromObject(value);
        if (b) return b;
        if (typeof Symbol !== "undefined" && Symbol.toPrimitive != null && typeof value[Symbol.toPrimitive] === "function") {
          return Buffer3.from(value[Symbol.toPrimitive]("string"), encodingOrOffset, length);
        }
        throw new TypeError(
          "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof value
        );
      }
      Buffer3.from = function(value, encodingOrOffset, length) {
        return from(value, encodingOrOffset, length);
      };
      Object.setPrototypeOf(Buffer3.prototype, Uint8Array.prototype);
      Object.setPrototypeOf(Buffer3, Uint8Array);
      function assertSize(size) {
        if (typeof size !== "number") {
          throw new TypeError('"size" argument must be of type number');
        } else if (size < 0) {
          throw new RangeError('The value "' + size + '" is invalid for option "size"');
        }
      }
      function alloc(size, fill, encoding) {
        assertSize(size);
        if (size <= 0) {
          return createBuffer(size);
        }
        if (fill !== void 0) {
          return typeof encoding === "string" ? createBuffer(size).fill(fill, encoding) : createBuffer(size).fill(fill);
        }
        return createBuffer(size);
      }
      Buffer3.alloc = function(size, fill, encoding) {
        return alloc(size, fill, encoding);
      };
      function allocUnsafe(size) {
        assertSize(size);
        return createBuffer(size < 0 ? 0 : checked(size) | 0);
      }
      Buffer3.allocUnsafe = function(size) {
        return allocUnsafe(size);
      };
      Buffer3.allocUnsafeSlow = function(size) {
        return allocUnsafe(size);
      };
      function fromString(string, encoding) {
        if (typeof encoding !== "string" || encoding === "") {
          encoding = "utf8";
        }
        if (!Buffer3.isEncoding(encoding)) {
          throw new TypeError("Unknown encoding: " + encoding);
        }
        const length = byteLength(string, encoding) | 0;
        let buf = createBuffer(length);
        const actual = buf.write(string, encoding);
        if (actual !== length) {
          buf = buf.slice(0, actual);
        }
        return buf;
      }
      function fromArrayLike(array) {
        const length = array.length < 0 ? 0 : checked(array.length) | 0;
        const buf = createBuffer(length);
        for (let i = 0; i < length; i += 1) {
          buf[i] = array[i] & 255;
        }
        return buf;
      }
      function fromArrayView(arrayView) {
        if (isInstance(arrayView, Uint8Array)) {
          const copy = new Uint8Array(arrayView);
          return fromArrayBuffer(copy.buffer, copy.byteOffset, copy.byteLength);
        }
        return fromArrayLike(arrayView);
      }
      function fromArrayBuffer(array, byteOffset, length) {
        if (byteOffset < 0 || array.byteLength < byteOffset) {
          throw new RangeError('"offset" is outside of buffer bounds');
        }
        if (array.byteLength < byteOffset + (length || 0)) {
          throw new RangeError('"length" is outside of buffer bounds');
        }
        let buf;
        if (byteOffset === void 0 && length === void 0) {
          buf = new Uint8Array(array);
        } else if (length === void 0) {
          buf = new Uint8Array(array, byteOffset);
        } else {
          buf = new Uint8Array(array, byteOffset, length);
        }
        Object.setPrototypeOf(buf, Buffer3.prototype);
        return buf;
      }
      function fromObject(obj) {
        if (Buffer3.isBuffer(obj)) {
          const len = checked(obj.length) | 0;
          const buf = createBuffer(len);
          if (buf.length === 0) {
            return buf;
          }
          obj.copy(buf, 0, 0, len);
          return buf;
        }
        if (obj.length !== void 0) {
          if (typeof obj.length !== "number" || numberIsNaN(obj.length)) {
            return createBuffer(0);
          }
          return fromArrayLike(obj);
        }
        if (obj.type === "Buffer" && Array.isArray(obj.data)) {
          return fromArrayLike(obj.data);
        }
      }
      function checked(length) {
        if (length >= K_MAX_LENGTH) {
          throw new RangeError("Attempt to allocate Buffer larger than maximum size: 0x" + K_MAX_LENGTH.toString(16) + " bytes");
        }
        return length | 0;
      }
      function SlowBuffer(length) {
        if (+length != length) {
          length = 0;
        }
        return Buffer3.alloc(+length);
      }
      Buffer3.isBuffer = function isBuffer(b) {
        return b != null && b._isBuffer === true && b !== Buffer3.prototype;
      };
      Buffer3.compare = function compare(a, b) {
        if (isInstance(a, Uint8Array)) a = Buffer3.from(a, a.offset, a.byteLength);
        if (isInstance(b, Uint8Array)) b = Buffer3.from(b, b.offset, b.byteLength);
        if (!Buffer3.isBuffer(a) || !Buffer3.isBuffer(b)) {
          throw new TypeError(
            'The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array'
          );
        }
        if (a === b) return 0;
        let x = a.length;
        let y = b.length;
        for (let i = 0, len = Math.min(x, y); i < len; ++i) {
          if (a[i] !== b[i]) {
            x = a[i];
            y = b[i];
            break;
          }
        }
        if (x < y) return -1;
        if (y < x) return 1;
        return 0;
      };
      Buffer3.isEncoding = function isEncoding(encoding) {
        switch (String(encoding).toLowerCase()) {
          case "hex":
          case "utf8":
          case "utf-8":
          case "ascii":
          case "latin1":
          case "binary":
          case "base64":
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return true;
          default:
            return false;
        }
      };
      Buffer3.concat = function concat(list, length) {
        if (!Array.isArray(list)) {
          throw new TypeError('"list" argument must be an Array of Buffers');
        }
        if (list.length === 0) {
          return Buffer3.alloc(0);
        }
        let i;
        if (length === void 0) {
          length = 0;
          for (i = 0; i < list.length; ++i) {
            length += list[i].length;
          }
        }
        const buffer = Buffer3.allocUnsafe(length);
        let pos = 0;
        for (i = 0; i < list.length; ++i) {
          let buf = list[i];
          if (isInstance(buf, Uint8Array)) {
            if (pos + buf.length > buffer.length) {
              if (!Buffer3.isBuffer(buf)) buf = Buffer3.from(buf);
              buf.copy(buffer, pos);
            } else {
              Uint8Array.prototype.set.call(
                buffer,
                buf,
                pos
              );
            }
          } else if (!Buffer3.isBuffer(buf)) {
            throw new TypeError('"list" argument must be an Array of Buffers');
          } else {
            buf.copy(buffer, pos);
          }
          pos += buf.length;
        }
        return buffer;
      };
      function byteLength(string, encoding) {
        if (Buffer3.isBuffer(string)) {
          return string.length;
        }
        if (ArrayBuffer.isView(string) || isInstance(string, ArrayBuffer)) {
          return string.byteLength;
        }
        if (typeof string !== "string") {
          throw new TypeError(
            'The "string" argument must be one of type string, Buffer, or ArrayBuffer. Received type ' + typeof string
          );
        }
        const len = string.length;
        const mustMatch = arguments.length > 2 && arguments[2] === true;
        if (!mustMatch && len === 0) return 0;
        let loweredCase = false;
        for (; ; ) {
          switch (encoding) {
            case "ascii":
            case "latin1":
            case "binary":
              return len;
            case "utf8":
            case "utf-8":
              return utf8ToBytes(string).length;
            case "ucs2":
            case "ucs-2":
            case "utf16le":
            case "utf-16le":
              return len * 2;
            case "hex":
              return len >>> 1;
            case "base64":
              return base64ToBytes(string).length;
            default:
              if (loweredCase) {
                return mustMatch ? -1 : utf8ToBytes(string).length;
              }
              encoding = ("" + encoding).toLowerCase();
              loweredCase = true;
          }
        }
      }
      Buffer3.byteLength = byteLength;
      function slowToString(encoding, start, end) {
        let loweredCase = false;
        if (start === void 0 || start < 0) {
          start = 0;
        }
        if (start > this.length) {
          return "";
        }
        if (end === void 0 || end > this.length) {
          end = this.length;
        }
        if (end <= 0) {
          return "";
        }
        end >>>= 0;
        start >>>= 0;
        if (end <= start) {
          return "";
        }
        if (!encoding) encoding = "utf8";
        while (true) {
          switch (encoding) {
            case "hex":
              return hexSlice(this, start, end);
            case "utf8":
            case "utf-8":
              return utf8Slice(this, start, end);
            case "ascii":
              return asciiSlice(this, start, end);
            case "latin1":
            case "binary":
              return latin1Slice(this, start, end);
            case "base64":
              return base64Slice(this, start, end);
            case "ucs2":
            case "ucs-2":
            case "utf16le":
            case "utf-16le":
              return utf16leSlice(this, start, end);
            default:
              if (loweredCase) throw new TypeError("Unknown encoding: " + encoding);
              encoding = (encoding + "").toLowerCase();
              loweredCase = true;
          }
        }
      }
      Buffer3.prototype._isBuffer = true;
      function swap(b, n, m) {
        const i = b[n];
        b[n] = b[m];
        b[m] = i;
      }
      Buffer3.prototype.swap16 = function swap16() {
        const len = this.length;
        if (len % 2 !== 0) {
          throw new RangeError("Buffer size must be a multiple of 16-bits");
        }
        for (let i = 0; i < len; i += 2) {
          swap(this, i, i + 1);
        }
        return this;
      };
      Buffer3.prototype.swap32 = function swap32() {
        const len = this.length;
        if (len % 4 !== 0) {
          throw new RangeError("Buffer size must be a multiple of 32-bits");
        }
        for (let i = 0; i < len; i += 4) {
          swap(this, i, i + 3);
          swap(this, i + 1, i + 2);
        }
        return this;
      };
      Buffer3.prototype.swap64 = function swap64() {
        const len = this.length;
        if (len % 8 !== 0) {
          throw new RangeError("Buffer size must be a multiple of 64-bits");
        }
        for (let i = 0; i < len; i += 8) {
          swap(this, i, i + 7);
          swap(this, i + 1, i + 6);
          swap(this, i + 2, i + 5);
          swap(this, i + 3, i + 4);
        }
        return this;
      };
      Buffer3.prototype.toString = function toString() {
        const length = this.length;
        if (length === 0) return "";
        if (arguments.length === 0) return utf8Slice(this, 0, length);
        return slowToString.apply(this, arguments);
      };
      Buffer3.prototype.toLocaleString = Buffer3.prototype.toString;
      Buffer3.prototype.equals = function equals(b) {
        if (!Buffer3.isBuffer(b)) throw new TypeError("Argument must be a Buffer");
        if (this === b) return true;
        return Buffer3.compare(this, b) === 0;
      };
      Buffer3.prototype.inspect = function inspect() {
        let str = "";
        const max = exports.INSPECT_MAX_BYTES;
        str = this.toString("hex", 0, max).replace(/(.{2})/g, "$1 ").trim();
        if (this.length > max) str += " ... ";
        return "<Buffer " + str + ">";
      };
      if (customInspectSymbol) {
        Buffer3.prototype[customInspectSymbol] = Buffer3.prototype.inspect;
      }
      Buffer3.prototype.compare = function compare(target, start, end, thisStart, thisEnd) {
        if (isInstance(target, Uint8Array)) {
          target = Buffer3.from(target, target.offset, target.byteLength);
        }
        if (!Buffer3.isBuffer(target)) {
          throw new TypeError(
            'The "target" argument must be one of type Buffer or Uint8Array. Received type ' + typeof target
          );
        }
        if (start === void 0) {
          start = 0;
        }
        if (end === void 0) {
          end = target ? target.length : 0;
        }
        if (thisStart === void 0) {
          thisStart = 0;
        }
        if (thisEnd === void 0) {
          thisEnd = this.length;
        }
        if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
          throw new RangeError("out of range index");
        }
        if (thisStart >= thisEnd && start >= end) {
          return 0;
        }
        if (thisStart >= thisEnd) {
          return -1;
        }
        if (start >= end) {
          return 1;
        }
        start >>>= 0;
        end >>>= 0;
        thisStart >>>= 0;
        thisEnd >>>= 0;
        if (this === target) return 0;
        let x = thisEnd - thisStart;
        let y = end - start;
        const len = Math.min(x, y);
        const thisCopy = this.slice(thisStart, thisEnd);
        const targetCopy = target.slice(start, end);
        for (let i = 0; i < len; ++i) {
          if (thisCopy[i] !== targetCopy[i]) {
            x = thisCopy[i];
            y = targetCopy[i];
            break;
          }
        }
        if (x < y) return -1;
        if (y < x) return 1;
        return 0;
      };
      function bidirectionalIndexOf(buffer, val, byteOffset, encoding, dir) {
        if (buffer.length === 0) return -1;
        if (typeof byteOffset === "string") {
          encoding = byteOffset;
          byteOffset = 0;
        } else if (byteOffset > 2147483647) {
          byteOffset = 2147483647;
        } else if (byteOffset < -2147483648) {
          byteOffset = -2147483648;
        }
        byteOffset = +byteOffset;
        if (numberIsNaN(byteOffset)) {
          byteOffset = dir ? 0 : buffer.length - 1;
        }
        if (byteOffset < 0) byteOffset = buffer.length + byteOffset;
        if (byteOffset >= buffer.length) {
          if (dir) return -1;
          else byteOffset = buffer.length - 1;
        } else if (byteOffset < 0) {
          if (dir) byteOffset = 0;
          else return -1;
        }
        if (typeof val === "string") {
          val = Buffer3.from(val, encoding);
        }
        if (Buffer3.isBuffer(val)) {
          if (val.length === 0) {
            return -1;
          }
          return arrayIndexOf(buffer, val, byteOffset, encoding, dir);
        } else if (typeof val === "number") {
          val = val & 255;
          if (typeof Uint8Array.prototype.indexOf === "function") {
            if (dir) {
              return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset);
            } else {
              return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset);
            }
          }
          return arrayIndexOf(buffer, [val], byteOffset, encoding, dir);
        }
        throw new TypeError("val must be string, number or Buffer");
      }
      function arrayIndexOf(arr, val, byteOffset, encoding, dir) {
        let indexSize = 1;
        let arrLength = arr.length;
        let valLength = val.length;
        if (encoding !== void 0) {
          encoding = String(encoding).toLowerCase();
          if (encoding === "ucs2" || encoding === "ucs-2" || encoding === "utf16le" || encoding === "utf-16le") {
            if (arr.length < 2 || val.length < 2) {
              return -1;
            }
            indexSize = 2;
            arrLength /= 2;
            valLength /= 2;
            byteOffset /= 2;
          }
        }
        function read(buf, i2) {
          if (indexSize === 1) {
            return buf[i2];
          } else {
            return buf.readUInt16BE(i2 * indexSize);
          }
        }
        let i;
        if (dir) {
          let foundIndex = -1;
          for (i = byteOffset; i < arrLength; i++) {
            if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
              if (foundIndex === -1) foundIndex = i;
              if (i - foundIndex + 1 === valLength) return foundIndex * indexSize;
            } else {
              if (foundIndex !== -1) i -= i - foundIndex;
              foundIndex = -1;
            }
          }
        } else {
          if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength;
          for (i = byteOffset; i >= 0; i--) {
            let found = true;
            for (let j = 0; j < valLength; j++) {
              if (read(arr, i + j) !== read(val, j)) {
                found = false;
                break;
              }
            }
            if (found) return i;
          }
        }
        return -1;
      }
      Buffer3.prototype.includes = function includes(val, byteOffset, encoding) {
        return this.indexOf(val, byteOffset, encoding) !== -1;
      };
      Buffer3.prototype.indexOf = function indexOf(val, byteOffset, encoding) {
        return bidirectionalIndexOf(this, val, byteOffset, encoding, true);
      };
      Buffer3.prototype.lastIndexOf = function lastIndexOf(val, byteOffset, encoding) {
        return bidirectionalIndexOf(this, val, byteOffset, encoding, false);
      };
      function hexWrite(buf, string, offset, length) {
        offset = Number(offset) || 0;
        const remaining = buf.length - offset;
        if (!length) {
          length = remaining;
        } else {
          length = Number(length);
          if (length > remaining) {
            length = remaining;
          }
        }
        const strLen = string.length;
        if (length > strLen / 2) {
          length = strLen / 2;
        }
        let i;
        for (i = 0; i < length; ++i) {
          const parsed = parseInt(string.substr(i * 2, 2), 16);
          if (numberIsNaN(parsed)) return i;
          buf[offset + i] = parsed;
        }
        return i;
      }
      function utf8Write(buf, string, offset, length) {
        return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length);
      }
      function asciiWrite(buf, string, offset, length) {
        return blitBuffer(asciiToBytes(string), buf, offset, length);
      }
      function base64Write(buf, string, offset, length) {
        return blitBuffer(base64ToBytes(string), buf, offset, length);
      }
      function ucs2Write(buf, string, offset, length) {
        return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length);
      }
      Buffer3.prototype.write = function write(string, offset, length, encoding) {
        if (offset === void 0) {
          encoding = "utf8";
          length = this.length;
          offset = 0;
        } else if (length === void 0 && typeof offset === "string") {
          encoding = offset;
          length = this.length;
          offset = 0;
        } else if (isFinite(offset)) {
          offset = offset >>> 0;
          if (isFinite(length)) {
            length = length >>> 0;
            if (encoding === void 0) encoding = "utf8";
          } else {
            encoding = length;
            length = void 0;
          }
        } else {
          throw new Error(
            "Buffer.write(string, encoding, offset[, length]) is no longer supported"
          );
        }
        const remaining = this.length - offset;
        if (length === void 0 || length > remaining) length = remaining;
        if (string.length > 0 && (length < 0 || offset < 0) || offset > this.length) {
          throw new RangeError("Attempt to write outside buffer bounds");
        }
        if (!encoding) encoding = "utf8";
        let loweredCase = false;
        for (; ; ) {
          switch (encoding) {
            case "hex":
              return hexWrite(this, string, offset, length);
            case "utf8":
            case "utf-8":
              return utf8Write(this, string, offset, length);
            case "ascii":
            case "latin1":
            case "binary":
              return asciiWrite(this, string, offset, length);
            case "base64":
              return base64Write(this, string, offset, length);
            case "ucs2":
            case "ucs-2":
            case "utf16le":
            case "utf-16le":
              return ucs2Write(this, string, offset, length);
            default:
              if (loweredCase) throw new TypeError("Unknown encoding: " + encoding);
              encoding = ("" + encoding).toLowerCase();
              loweredCase = true;
          }
        }
      };
      Buffer3.prototype.toJSON = function toJSON() {
        return {
          type: "Buffer",
          data: Array.prototype.slice.call(this._arr || this, 0)
        };
      };
      function base64Slice(buf, start, end) {
        if (start === 0 && end === buf.length) {
          return base64.fromByteArray(buf);
        } else {
          return base64.fromByteArray(buf.slice(start, end));
        }
      }
      function utf8Slice(buf, start, end) {
        end = Math.min(buf.length, end);
        const res = [];
        let i = start;
        while (i < end) {
          const firstByte = buf[i];
          let codePoint = null;
          let bytesPerSequence = firstByte > 239 ? 4 : firstByte > 223 ? 3 : firstByte > 191 ? 2 : 1;
          if (i + bytesPerSequence <= end) {
            let secondByte, thirdByte, fourthByte, tempCodePoint;
            switch (bytesPerSequence) {
              case 1:
                if (firstByte < 128) {
                  codePoint = firstByte;
                }
                break;
              case 2:
                secondByte = buf[i + 1];
                if ((secondByte & 192) === 128) {
                  tempCodePoint = (firstByte & 31) << 6 | secondByte & 63;
                  if (tempCodePoint > 127) {
                    codePoint = tempCodePoint;
                  }
                }
                break;
              case 3:
                secondByte = buf[i + 1];
                thirdByte = buf[i + 2];
                if ((secondByte & 192) === 128 && (thirdByte & 192) === 128) {
                  tempCodePoint = (firstByte & 15) << 12 | (secondByte & 63) << 6 | thirdByte & 63;
                  if (tempCodePoint > 2047 && (tempCodePoint < 55296 || tempCodePoint > 57343)) {
                    codePoint = tempCodePoint;
                  }
                }
                break;
              case 4:
                secondByte = buf[i + 1];
                thirdByte = buf[i + 2];
                fourthByte = buf[i + 3];
                if ((secondByte & 192) === 128 && (thirdByte & 192) === 128 && (fourthByte & 192) === 128) {
                  tempCodePoint = (firstByte & 15) << 18 | (secondByte & 63) << 12 | (thirdByte & 63) << 6 | fourthByte & 63;
                  if (tempCodePoint > 65535 && tempCodePoint < 1114112) {
                    codePoint = tempCodePoint;
                  }
                }
            }
          }
          if (codePoint === null) {
            codePoint = 65533;
            bytesPerSequence = 1;
          } else if (codePoint > 65535) {
            codePoint -= 65536;
            res.push(codePoint >>> 10 & 1023 | 55296);
            codePoint = 56320 | codePoint & 1023;
          }
          res.push(codePoint);
          i += bytesPerSequence;
        }
        return decodeCodePointsArray(res);
      }
      var MAX_ARGUMENTS_LENGTH = 4096;
      function decodeCodePointsArray(codePoints) {
        const len = codePoints.length;
        if (len <= MAX_ARGUMENTS_LENGTH) {
          return String.fromCharCode.apply(String, codePoints);
        }
        let res = "";
        let i = 0;
        while (i < len) {
          res += String.fromCharCode.apply(
            String,
            codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
          );
        }
        return res;
      }
      function asciiSlice(buf, start, end) {
        let ret = "";
        end = Math.min(buf.length, end);
        for (let i = start; i < end; ++i) {
          ret += String.fromCharCode(buf[i] & 127);
        }
        return ret;
      }
      function latin1Slice(buf, start, end) {
        let ret = "";
        end = Math.min(buf.length, end);
        for (let i = start; i < end; ++i) {
          ret += String.fromCharCode(buf[i]);
        }
        return ret;
      }
      function hexSlice(buf, start, end) {
        const len = buf.length;
        if (!start || start < 0) start = 0;
        if (!end || end < 0 || end > len) end = len;
        let out = "";
        for (let i = start; i < end; ++i) {
          out += hexSliceLookupTable[buf[i]];
        }
        return out;
      }
      function utf16leSlice(buf, start, end) {
        const bytes = buf.slice(start, end);
        let res = "";
        for (let i = 0; i < bytes.length - 1; i += 2) {
          res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256);
        }
        return res;
      }
      Buffer3.prototype.slice = function slice(start, end) {
        const len = this.length;
        start = ~~start;
        end = end === void 0 ? len : ~~end;
        if (start < 0) {
          start += len;
          if (start < 0) start = 0;
        } else if (start > len) {
          start = len;
        }
        if (end < 0) {
          end += len;
          if (end < 0) end = 0;
        } else if (end > len) {
          end = len;
        }
        if (end < start) end = start;
        const newBuf = this.subarray(start, end);
        Object.setPrototypeOf(newBuf, Buffer3.prototype);
        return newBuf;
      };
      function checkOffset(offset, ext, length) {
        if (offset % 1 !== 0 || offset < 0) throw new RangeError("offset is not uint");
        if (offset + ext > length) throw new RangeError("Trying to access beyond buffer length");
      }
      Buffer3.prototype.readUintLE = Buffer3.prototype.readUIntLE = function readUIntLE(offset, byteLength2, noAssert) {
        offset = offset >>> 0;
        byteLength2 = byteLength2 >>> 0;
        if (!noAssert) checkOffset(offset, byteLength2, this.length);
        let val = this[offset];
        let mul = 1;
        let i = 0;
        while (++i < byteLength2 && (mul *= 256)) {
          val += this[offset + i] * mul;
        }
        return val;
      };
      Buffer3.prototype.readUintBE = Buffer3.prototype.readUIntBE = function readUIntBE(offset, byteLength2, noAssert) {
        offset = offset >>> 0;
        byteLength2 = byteLength2 >>> 0;
        if (!noAssert) {
          checkOffset(offset, byteLength2, this.length);
        }
        let val = this[offset + --byteLength2];
        let mul = 1;
        while (byteLength2 > 0 && (mul *= 256)) {
          val += this[offset + --byteLength2] * mul;
        }
        return val;
      };
      Buffer3.prototype.readUint8 = Buffer3.prototype.readUInt8 = function readUInt8(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert) checkOffset(offset, 1, this.length);
        return this[offset];
      };
      Buffer3.prototype.readUint16LE = Buffer3.prototype.readUInt16LE = function readUInt16LE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert) checkOffset(offset, 2, this.length);
        return this[offset] | this[offset + 1] << 8;
      };
      Buffer3.prototype.readUint16BE = Buffer3.prototype.readUInt16BE = function readUInt16BE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert) checkOffset(offset, 2, this.length);
        return this[offset] << 8 | this[offset + 1];
      };
      Buffer3.prototype.readUint32LE = Buffer3.prototype.readUInt32LE = function readUInt32LE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert) checkOffset(offset, 4, this.length);
        return (this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16) + this[offset + 3] * 16777216;
      };
      Buffer3.prototype.readUint32BE = Buffer3.prototype.readUInt32BE = function readUInt32BE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert) checkOffset(offset, 4, this.length);
        return this[offset] * 16777216 + (this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3]);
      };
      Buffer3.prototype.readBigUInt64LE = defineBigIntMethod(function readBigUInt64LE(offset) {
        offset = offset >>> 0;
        validateNumber(offset, "offset");
        const first = this[offset];
        const last = this[offset + 7];
        if (first === void 0 || last === void 0) {
          boundsError(offset, this.length - 8);
        }
        const lo = first + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 24;
        const hi = this[++offset] + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + last * 2 ** 24;
        return BigInt(lo) + (BigInt(hi) << BigInt(32));
      });
      Buffer3.prototype.readBigUInt64BE = defineBigIntMethod(function readBigUInt64BE(offset) {
        offset = offset >>> 0;
        validateNumber(offset, "offset");
        const first = this[offset];
        const last = this[offset + 7];
        if (first === void 0 || last === void 0) {
          boundsError(offset, this.length - 8);
        }
        const hi = first * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + this[++offset];
        const lo = this[++offset] * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + last;
        return (BigInt(hi) << BigInt(32)) + BigInt(lo);
      });
      Buffer3.prototype.readIntLE = function readIntLE(offset, byteLength2, noAssert) {
        offset = offset >>> 0;
        byteLength2 = byteLength2 >>> 0;
        if (!noAssert) checkOffset(offset, byteLength2, this.length);
        let val = this[offset];
        let mul = 1;
        let i = 0;
        while (++i < byteLength2 && (mul *= 256)) {
          val += this[offset + i] * mul;
        }
        mul *= 128;
        if (val >= mul) val -= Math.pow(2, 8 * byteLength2);
        return val;
      };
      Buffer3.prototype.readIntBE = function readIntBE(offset, byteLength2, noAssert) {
        offset = offset >>> 0;
        byteLength2 = byteLength2 >>> 0;
        if (!noAssert) checkOffset(offset, byteLength2, this.length);
        let i = byteLength2;
        let mul = 1;
        let val = this[offset + --i];
        while (i > 0 && (mul *= 256)) {
          val += this[offset + --i] * mul;
        }
        mul *= 128;
        if (val >= mul) val -= Math.pow(2, 8 * byteLength2);
        return val;
      };
      Buffer3.prototype.readInt8 = function readInt8(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert) checkOffset(offset, 1, this.length);
        if (!(this[offset] & 128)) return this[offset];
        return (255 - this[offset] + 1) * -1;
      };
      Buffer3.prototype.readInt16LE = function readInt16LE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert) checkOffset(offset, 2, this.length);
        const val = this[offset] | this[offset + 1] << 8;
        return val & 32768 ? val | 4294901760 : val;
      };
      Buffer3.prototype.readInt16BE = function readInt16BE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert) checkOffset(offset, 2, this.length);
        const val = this[offset + 1] | this[offset] << 8;
        return val & 32768 ? val | 4294901760 : val;
      };
      Buffer3.prototype.readInt32LE = function readInt32LE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert) checkOffset(offset, 4, this.length);
        return this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16 | this[offset + 3] << 24;
      };
      Buffer3.prototype.readInt32BE = function readInt32BE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert) checkOffset(offset, 4, this.length);
        return this[offset] << 24 | this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3];
      };
      Buffer3.prototype.readBigInt64LE = defineBigIntMethod(function readBigInt64LE(offset) {
        offset = offset >>> 0;
        validateNumber(offset, "offset");
        const first = this[offset];
        const last = this[offset + 7];
        if (first === void 0 || last === void 0) {
          boundsError(offset, this.length - 8);
        }
        const val = this[offset + 4] + this[offset + 5] * 2 ** 8 + this[offset + 6] * 2 ** 16 + (last << 24);
        return (BigInt(val) << BigInt(32)) + BigInt(first + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 24);
      });
      Buffer3.prototype.readBigInt64BE = defineBigIntMethod(function readBigInt64BE(offset) {
        offset = offset >>> 0;
        validateNumber(offset, "offset");
        const first = this[offset];
        const last = this[offset + 7];
        if (first === void 0 || last === void 0) {
          boundsError(offset, this.length - 8);
        }
        const val = (first << 24) + // Overflow
        this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + this[++offset];
        return (BigInt(val) << BigInt(32)) + BigInt(this[++offset] * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + last);
      });
      Buffer3.prototype.readFloatLE = function readFloatLE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert) checkOffset(offset, 4, this.length);
        return ieee754.read(this, offset, true, 23, 4);
      };
      Buffer3.prototype.readFloatBE = function readFloatBE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert) checkOffset(offset, 4, this.length);
        return ieee754.read(this, offset, false, 23, 4);
      };
      Buffer3.prototype.readDoubleLE = function readDoubleLE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert) checkOffset(offset, 8, this.length);
        return ieee754.read(this, offset, true, 52, 8);
      };
      Buffer3.prototype.readDoubleBE = function readDoubleBE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert) checkOffset(offset, 8, this.length);
        return ieee754.read(this, offset, false, 52, 8);
      };
      function checkInt(buf, value, offset, ext, max, min) {
        if (!Buffer3.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance');
        if (value > max || value < min) throw new RangeError('"value" argument is out of bounds');
        if (offset + ext > buf.length) throw new RangeError("Index out of range");
      }
      Buffer3.prototype.writeUintLE = Buffer3.prototype.writeUIntLE = function writeUIntLE(value, offset, byteLength2, noAssert) {
        value = +value;
        offset = offset >>> 0;
        byteLength2 = byteLength2 >>> 0;
        if (!noAssert) {
          const maxBytes = Math.pow(2, 8 * byteLength2) - 1;
          checkInt(this, value, offset, byteLength2, maxBytes, 0);
        }
        let mul = 1;
        let i = 0;
        this[offset] = value & 255;
        while (++i < byteLength2 && (mul *= 256)) {
          this[offset + i] = value / mul & 255;
        }
        return offset + byteLength2;
      };
      Buffer3.prototype.writeUintBE = Buffer3.prototype.writeUIntBE = function writeUIntBE(value, offset, byteLength2, noAssert) {
        value = +value;
        offset = offset >>> 0;
        byteLength2 = byteLength2 >>> 0;
        if (!noAssert) {
          const maxBytes = Math.pow(2, 8 * byteLength2) - 1;
          checkInt(this, value, offset, byteLength2, maxBytes, 0);
        }
        let i = byteLength2 - 1;
        let mul = 1;
        this[offset + i] = value & 255;
        while (--i >= 0 && (mul *= 256)) {
          this[offset + i] = value / mul & 255;
        }
        return offset + byteLength2;
      };
      Buffer3.prototype.writeUint8 = Buffer3.prototype.writeUInt8 = function writeUInt8(value, offset, noAssert) {
        value = +value;
        offset = offset >>> 0;
        if (!noAssert) checkInt(this, value, offset, 1, 255, 0);
        this[offset] = value & 255;
        return offset + 1;
      };
      Buffer3.prototype.writeUint16LE = Buffer3.prototype.writeUInt16LE = function writeUInt16LE(value, offset, noAssert) {
        value = +value;
        offset = offset >>> 0;
        if (!noAssert) checkInt(this, value, offset, 2, 65535, 0);
        this[offset] = value & 255;
        this[offset + 1] = value >>> 8;
        return offset + 2;
      };
      Buffer3.prototype.writeUint16BE = Buffer3.prototype.writeUInt16BE = function writeUInt16BE(value, offset, noAssert) {
        value = +value;
        offset = offset >>> 0;
        if (!noAssert) checkInt(this, value, offset, 2, 65535, 0);
        this[offset] = value >>> 8;
        this[offset + 1] = value & 255;
        return offset + 2;
      };
      Buffer3.prototype.writeUint32LE = Buffer3.prototype.writeUInt32LE = function writeUInt32LE(value, offset, noAssert) {
        value = +value;
        offset = offset >>> 0;
        if (!noAssert) checkInt(this, value, offset, 4, 4294967295, 0);
        this[offset + 3] = value >>> 24;
        this[offset + 2] = value >>> 16;
        this[offset + 1] = value >>> 8;
        this[offset] = value & 255;
        return offset + 4;
      };
      Buffer3.prototype.writeUint32BE = Buffer3.prototype.writeUInt32BE = function writeUInt32BE(value, offset, noAssert) {
        value = +value;
        offset = offset >>> 0;
        if (!noAssert) checkInt(this, value, offset, 4, 4294967295, 0);
        this[offset] = value >>> 24;
        this[offset + 1] = value >>> 16;
        this[offset + 2] = value >>> 8;
        this[offset + 3] = value & 255;
        return offset + 4;
      };
      function wrtBigUInt64LE(buf, value, offset, min, max) {
        checkIntBI(value, min, max, buf, offset, 7);
        let lo = Number(value & BigInt(4294967295));
        buf[offset++] = lo;
        lo = lo >> 8;
        buf[offset++] = lo;
        lo = lo >> 8;
        buf[offset++] = lo;
        lo = lo >> 8;
        buf[offset++] = lo;
        let hi = Number(value >> BigInt(32) & BigInt(4294967295));
        buf[offset++] = hi;
        hi = hi >> 8;
        buf[offset++] = hi;
        hi = hi >> 8;
        buf[offset++] = hi;
        hi = hi >> 8;
        buf[offset++] = hi;
        return offset;
      }
      function wrtBigUInt64BE(buf, value, offset, min, max) {
        checkIntBI(value, min, max, buf, offset, 7);
        let lo = Number(value & BigInt(4294967295));
        buf[offset + 7] = lo;
        lo = lo >> 8;
        buf[offset + 6] = lo;
        lo = lo >> 8;
        buf[offset + 5] = lo;
        lo = lo >> 8;
        buf[offset + 4] = lo;
        let hi = Number(value >> BigInt(32) & BigInt(4294967295));
        buf[offset + 3] = hi;
        hi = hi >> 8;
        buf[offset + 2] = hi;
        hi = hi >> 8;
        buf[offset + 1] = hi;
        hi = hi >> 8;
        buf[offset] = hi;
        return offset + 8;
      }
      Buffer3.prototype.writeBigUInt64LE = defineBigIntMethod(function writeBigUInt64LE(value, offset = 0) {
        return wrtBigUInt64LE(this, value, offset, BigInt(0), BigInt("0xffffffffffffffff"));
      });
      Buffer3.prototype.writeBigUInt64BE = defineBigIntMethod(function writeBigUInt64BE(value, offset = 0) {
        return wrtBigUInt64BE(this, value, offset, BigInt(0), BigInt("0xffffffffffffffff"));
      });
      Buffer3.prototype.writeIntLE = function writeIntLE(value, offset, byteLength2, noAssert) {
        value = +value;
        offset = offset >>> 0;
        if (!noAssert) {
          const limit = Math.pow(2, 8 * byteLength2 - 1);
          checkInt(this, value, offset, byteLength2, limit - 1, -limit);
        }
        let i = 0;
        let mul = 1;
        let sub = 0;
        this[offset] = value & 255;
        while (++i < byteLength2 && (mul *= 256)) {
          if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
            sub = 1;
          }
          this[offset + i] = (value / mul >> 0) - sub & 255;
        }
        return offset + byteLength2;
      };
      Buffer3.prototype.writeIntBE = function writeIntBE(value, offset, byteLength2, noAssert) {
        value = +value;
        offset = offset >>> 0;
        if (!noAssert) {
          const limit = Math.pow(2, 8 * byteLength2 - 1);
          checkInt(this, value, offset, byteLength2, limit - 1, -limit);
        }
        let i = byteLength2 - 1;
        let mul = 1;
        let sub = 0;
        this[offset + i] = value & 255;
        while (--i >= 0 && (mul *= 256)) {
          if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
            sub = 1;
          }
          this[offset + i] = (value / mul >> 0) - sub & 255;
        }
        return offset + byteLength2;
      };
      Buffer3.prototype.writeInt8 = function writeInt8(value, offset, noAssert) {
        value = +value;
        offset = offset >>> 0;
        if (!noAssert) checkInt(this, value, offset, 1, 127, -128);
        if (value < 0) value = 255 + value + 1;
        this[offset] = value & 255;
        return offset + 1;
      };
      Buffer3.prototype.writeInt16LE = function writeInt16LE(value, offset, noAssert) {
        value = +value;
        offset = offset >>> 0;
        if (!noAssert) checkInt(this, value, offset, 2, 32767, -32768);
        this[offset] = value & 255;
        this[offset + 1] = value >>> 8;
        return offset + 2;
      };
      Buffer3.prototype.writeInt16BE = function writeInt16BE(value, offset, noAssert) {
        value = +value;
        offset = offset >>> 0;
        if (!noAssert) checkInt(this, value, offset, 2, 32767, -32768);
        this[offset] = value >>> 8;
        this[offset + 1] = value & 255;
        return offset + 2;
      };
      Buffer3.prototype.writeInt32LE = function writeInt32LE(value, offset, noAssert) {
        value = +value;
        offset = offset >>> 0;
        if (!noAssert) checkInt(this, value, offset, 4, 2147483647, -2147483648);
        this[offset] = value & 255;
        this[offset + 1] = value >>> 8;
        this[offset + 2] = value >>> 16;
        this[offset + 3] = value >>> 24;
        return offset + 4;
      };
      Buffer3.prototype.writeInt32BE = function writeInt32BE(value, offset, noAssert) {
        value = +value;
        offset = offset >>> 0;
        if (!noAssert) checkInt(this, value, offset, 4, 2147483647, -2147483648);
        if (value < 0) value = 4294967295 + value + 1;
        this[offset] = value >>> 24;
        this[offset + 1] = value >>> 16;
        this[offset + 2] = value >>> 8;
        this[offset + 3] = value & 255;
        return offset + 4;
      };
      Buffer3.prototype.writeBigInt64LE = defineBigIntMethod(function writeBigInt64LE(value, offset = 0) {
        return wrtBigUInt64LE(this, value, offset, -BigInt("0x8000000000000000"), BigInt("0x7fffffffffffffff"));
      });
      Buffer3.prototype.writeBigInt64BE = defineBigIntMethod(function writeBigInt64BE(value, offset = 0) {
        return wrtBigUInt64BE(this, value, offset, -BigInt("0x8000000000000000"), BigInt("0x7fffffffffffffff"));
      });
      function checkIEEE754(buf, value, offset, ext, max, min) {
        if (offset + ext > buf.length) throw new RangeError("Index out of range");
        if (offset < 0) throw new RangeError("Index out of range");
      }
      function writeFloat(buf, value, offset, littleEndian, noAssert) {
        value = +value;
        offset = offset >>> 0;
        if (!noAssert) {
          checkIEEE754(buf, value, offset, 4, 34028234663852886e22, -34028234663852886e22);
        }
        ieee754.write(buf, value, offset, littleEndian, 23, 4);
        return offset + 4;
      }
      Buffer3.prototype.writeFloatLE = function writeFloatLE(value, offset, noAssert) {
        return writeFloat(this, value, offset, true, noAssert);
      };
      Buffer3.prototype.writeFloatBE = function writeFloatBE(value, offset, noAssert) {
        return writeFloat(this, value, offset, false, noAssert);
      };
      function writeDouble(buf, value, offset, littleEndian, noAssert) {
        value = +value;
        offset = offset >>> 0;
        if (!noAssert) {
          checkIEEE754(buf, value, offset, 8, 17976931348623157e292, -17976931348623157e292);
        }
        ieee754.write(buf, value, offset, littleEndian, 52, 8);
        return offset + 8;
      }
      Buffer3.prototype.writeDoubleLE = function writeDoubleLE(value, offset, noAssert) {
        return writeDouble(this, value, offset, true, noAssert);
      };
      Buffer3.prototype.writeDoubleBE = function writeDoubleBE(value, offset, noAssert) {
        return writeDouble(this, value, offset, false, noAssert);
      };
      Buffer3.prototype.copy = function copy(target, targetStart, start, end) {
        if (!Buffer3.isBuffer(target)) throw new TypeError("argument should be a Buffer");
        if (!start) start = 0;
        if (!end && end !== 0) end = this.length;
        if (targetStart >= target.length) targetStart = target.length;
        if (!targetStart) targetStart = 0;
        if (end > 0 && end < start) end = start;
        if (end === start) return 0;
        if (target.length === 0 || this.length === 0) return 0;
        if (targetStart < 0) {
          throw new RangeError("targetStart out of bounds");
        }
        if (start < 0 || start >= this.length) throw new RangeError("Index out of range");
        if (end < 0) throw new RangeError("sourceEnd out of bounds");
        if (end > this.length) end = this.length;
        if (target.length - targetStart < end - start) {
          end = target.length - targetStart + start;
        }
        const len = end - start;
        if (this === target && typeof Uint8Array.prototype.copyWithin === "function") {
          this.copyWithin(targetStart, start, end);
        } else {
          Uint8Array.prototype.set.call(
            target,
            this.subarray(start, end),
            targetStart
          );
        }
        return len;
      };
      Buffer3.prototype.fill = function fill(val, start, end, encoding) {
        if (typeof val === "string") {
          if (typeof start === "string") {
            encoding = start;
            start = 0;
            end = this.length;
          } else if (typeof end === "string") {
            encoding = end;
            end = this.length;
          }
          if (encoding !== void 0 && typeof encoding !== "string") {
            throw new TypeError("encoding must be a string");
          }
          if (typeof encoding === "string" && !Buffer3.isEncoding(encoding)) {
            throw new TypeError("Unknown encoding: " + encoding);
          }
          if (val.length === 1) {
            const code = val.charCodeAt(0);
            if (encoding === "utf8" && code < 128 || encoding === "latin1") {
              val = code;
            }
          }
        } else if (typeof val === "number") {
          val = val & 255;
        } else if (typeof val === "boolean") {
          val = Number(val);
        }
        if (start < 0 || this.length < start || this.length < end) {
          throw new RangeError("Out of range index");
        }
        if (end <= start) {
          return this;
        }
        start = start >>> 0;
        end = end === void 0 ? this.length : end >>> 0;
        if (!val) val = 0;
        let i;
        if (typeof val === "number") {
          for (i = start; i < end; ++i) {
            this[i] = val;
          }
        } else {
          const bytes = Buffer3.isBuffer(val) ? val : Buffer3.from(val, encoding);
          const len = bytes.length;
          if (len === 0) {
            throw new TypeError('The value "' + val + '" is invalid for argument "value"');
          }
          for (i = 0; i < end - start; ++i) {
            this[i + start] = bytes[i % len];
          }
        }
        return this;
      };
      var errors = {};
      function E(sym, getMessage, Base) {
        errors[sym] = class NodeError extends Base {
          constructor() {
            super();
            Object.defineProperty(this, "message", {
              value: getMessage.apply(this, arguments),
              writable: true,
              configurable: true
            });
            this.name = `${this.name} [${sym}]`;
            this.stack;
            delete this.name;
          }
          get code() {
            return sym;
          }
          set code(value) {
            Object.defineProperty(this, "code", {
              configurable: true,
              enumerable: true,
              value,
              writable: true
            });
          }
          toString() {
            return `${this.name} [${sym}]: ${this.message}`;
          }
        };
      }
      E(
        "ERR_BUFFER_OUT_OF_BOUNDS",
        function(name) {
          if (name) {
            return `${name} is outside of buffer bounds`;
          }
          return "Attempt to access memory outside buffer bounds";
        },
        RangeError
      );
      E(
        "ERR_INVALID_ARG_TYPE",
        function(name, actual) {
          return `The "${name}" argument must be of type number. Received type ${typeof actual}`;
        },
        TypeError
      );
      E(
        "ERR_OUT_OF_RANGE",
        function(str, range, input) {
          let msg = `The value of "${str}" is out of range.`;
          let received = input;
          if (Number.isInteger(input) && Math.abs(input) > 2 ** 32) {
            received = addNumericalSeparator(String(input));
          } else if (typeof input === "bigint") {
            received = String(input);
            if (input > BigInt(2) ** BigInt(32) || input < -(BigInt(2) ** BigInt(32))) {
              received = addNumericalSeparator(received);
            }
            received += "n";
          }
          msg += ` It must be ${range}. Received ${received}`;
          return msg;
        },
        RangeError
      );
      function addNumericalSeparator(val) {
        let res = "";
        let i = val.length;
        const start = val[0] === "-" ? 1 : 0;
        for (; i >= start + 4; i -= 3) {
          res = `_${val.slice(i - 3, i)}${res}`;
        }
        return `${val.slice(0, i)}${res}`;
      }
      function checkBounds(buf, offset, byteLength2) {
        validateNumber(offset, "offset");
        if (buf[offset] === void 0 || buf[offset + byteLength2] === void 0) {
          boundsError(offset, buf.length - (byteLength2 + 1));
        }
      }
      function checkIntBI(value, min, max, buf, offset, byteLength2) {
        if (value > max || value < min) {
          const n = typeof min === "bigint" ? "n" : "";
          let range;
          if (byteLength2 > 3) {
            if (min === 0 || min === BigInt(0)) {
              range = `>= 0${n} and < 2${n} ** ${(byteLength2 + 1) * 8}${n}`;
            } else {
              range = `>= -(2${n} ** ${(byteLength2 + 1) * 8 - 1}${n}) and < 2 ** ${(byteLength2 + 1) * 8 - 1}${n}`;
            }
          } else {
            range = `>= ${min}${n} and <= ${max}${n}`;
          }
          throw new errors.ERR_OUT_OF_RANGE("value", range, value);
        }
        checkBounds(buf, offset, byteLength2);
      }
      function validateNumber(value, name) {
        if (typeof value !== "number") {
          throw new errors.ERR_INVALID_ARG_TYPE(name, "number", value);
        }
      }
      function boundsError(value, length, type) {
        if (Math.floor(value) !== value) {
          validateNumber(value, type);
          throw new errors.ERR_OUT_OF_RANGE(type || "offset", "an integer", value);
        }
        if (length < 0) {
          throw new errors.ERR_BUFFER_OUT_OF_BOUNDS();
        }
        throw new errors.ERR_OUT_OF_RANGE(
          type || "offset",
          `>= ${type ? 1 : 0} and <= ${length}`,
          value
        );
      }
      var INVALID_BASE64_RE = /[^+/0-9A-Za-z-_]/g;
      function base64clean(str) {
        str = str.split("=")[0];
        str = str.trim().replace(INVALID_BASE64_RE, "");
        if (str.length < 2) return "";
        while (str.length % 4 !== 0) {
          str = str + "=";
        }
        return str;
      }
      function utf8ToBytes(string, units) {
        units = units || Infinity;
        let codePoint;
        const length = string.length;
        let leadSurrogate = null;
        const bytes = [];
        for (let i = 0; i < length; ++i) {
          codePoint = string.charCodeAt(i);
          if (codePoint > 55295 && codePoint < 57344) {
            if (!leadSurrogate) {
              if (codePoint > 56319) {
                if ((units -= 3) > -1) bytes.push(239, 191, 189);
                continue;
              } else if (i + 1 === length) {
                if ((units -= 3) > -1) bytes.push(239, 191, 189);
                continue;
              }
              leadSurrogate = codePoint;
              continue;
            }
            if (codePoint < 56320) {
              if ((units -= 3) > -1) bytes.push(239, 191, 189);
              leadSurrogate = codePoint;
              continue;
            }
            codePoint = (leadSurrogate - 55296 << 10 | codePoint - 56320) + 65536;
          } else if (leadSurrogate) {
            if ((units -= 3) > -1) bytes.push(239, 191, 189);
          }
          leadSurrogate = null;
          if (codePoint < 128) {
            if ((units -= 1) < 0) break;
            bytes.push(codePoint);
          } else if (codePoint < 2048) {
            if ((units -= 2) < 0) break;
            bytes.push(
              codePoint >> 6 | 192,
              codePoint & 63 | 128
            );
          } else if (codePoint < 65536) {
            if ((units -= 3) < 0) break;
            bytes.push(
              codePoint >> 12 | 224,
              codePoint >> 6 & 63 | 128,
              codePoint & 63 | 128
            );
          } else if (codePoint < 1114112) {
            if ((units -= 4) < 0) break;
            bytes.push(
              codePoint >> 18 | 240,
              codePoint >> 12 & 63 | 128,
              codePoint >> 6 & 63 | 128,
              codePoint & 63 | 128
            );
          } else {
            throw new Error("Invalid code point");
          }
        }
        return bytes;
      }
      function asciiToBytes(str) {
        const byteArray = [];
        for (let i = 0; i < str.length; ++i) {
          byteArray.push(str.charCodeAt(i) & 255);
        }
        return byteArray;
      }
      function utf16leToBytes(str, units) {
        let c2, hi, lo;
        const byteArray = [];
        for (let i = 0; i < str.length; ++i) {
          if ((units -= 2) < 0) break;
          c2 = str.charCodeAt(i);
          hi = c2 >> 8;
          lo = c2 % 256;
          byteArray.push(lo);
          byteArray.push(hi);
        }
        return byteArray;
      }
      function base64ToBytes(str) {
        return base64.toByteArray(base64clean(str));
      }
      function blitBuffer(src, dst, offset, length) {
        let i;
        for (i = 0; i < length; ++i) {
          if (i + offset >= dst.length || i >= src.length) break;
          dst[i + offset] = src[i];
        }
        return i;
      }
      function isInstance(obj, type) {
        return obj instanceof type || obj != null && obj.constructor != null && obj.constructor.name != null && obj.constructor.name === type.name;
      }
      function numberIsNaN(obj) {
        return obj !== obj;
      }
      var hexSliceLookupTable = (function() {
        const alphabet = "0123456789abcdef";
        const table = new Array(256);
        for (let i = 0; i < 16; ++i) {
          const i16 = i * 16;
          for (let j = 0; j < 16; ++j) {
            table[i16 + j] = alphabet[i] + alphabet[j];
          }
        }
        return table;
      })();
      function defineBigIntMethod(fn) {
        return typeof BigInt === "undefined" ? BufferBigIntNotDefined : fn;
      }
      function BufferBigIntNotDefined() {
        throw new Error("BigInt not supported");
      }
    }
  });

  // node_modules/b4a/lib/ascii.js
  var require_ascii = __commonJS({
    "node_modules/b4a/lib/ascii.js"(exports, module) {
      function byteLength(string) {
        return string.length;
      }
      function toString(buffer) {
        const len = buffer.byteLength;
        let result = "";
        for (let i = 0; i < len; i++) {
          result += String.fromCharCode(buffer[i] & 127);
        }
        return result;
      }
      function write(buffer, string) {
        const len = buffer.byteLength;
        for (let i = 0; i < len; i++) {
          buffer[i] = string.charCodeAt(i);
        }
        return len;
      }
      module.exports = {
        byteLength,
        toString,
        write
      };
    }
  });

  // node_modules/b4a/lib/base64.js
  var require_base64 = __commonJS({
    "node_modules/b4a/lib/base64.js"(exports, module) {
      var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      var codes = new Uint8Array(256);
      for (let i = 0; i < alphabet.length; i++) {
        codes[alphabet.charCodeAt(i)] = i;
      }
      codes[
        /* - */
        45
      ] = 62;
      codes[
        /* _ */
        95
      ] = 63;
      function byteLength(string) {
        let len = string.length;
        if (string.charCodeAt(len - 1) === 61) len--;
        if (len > 1 && string.charCodeAt(len - 1) === 61) len--;
        return len * 3 >>> 2;
      }
      function toString(buffer) {
        const len = buffer.byteLength;
        let result = "";
        for (let i = 0; i < len; i += 3) {
          result += alphabet[buffer[i] >> 2] + alphabet[(buffer[i] & 3) << 4 | buffer[i + 1] >> 4] + alphabet[(buffer[i + 1] & 15) << 2 | buffer[i + 2] >> 6] + alphabet[buffer[i + 2] & 63];
        }
        if (len % 3 === 2) {
          result = result.substring(0, result.length - 1) + "=";
        } else if (len % 3 === 1) {
          result = result.substring(0, result.length - 2) + "==";
        }
        return result;
      }
      function write(buffer, string) {
        const len = buffer.byteLength;
        for (let i = 0, j = 0; j < len; i += 4) {
          const a = codes[string.charCodeAt(i)];
          const b = codes[string.charCodeAt(i + 1)];
          const c2 = codes[string.charCodeAt(i + 2)];
          const d = codes[string.charCodeAt(i + 3)];
          buffer[j++] = a << 2 | b >> 4;
          buffer[j++] = (b & 15) << 4 | c2 >> 2;
          buffer[j++] = (c2 & 3) << 6 | d & 63;
        }
        return len;
      }
      module.exports = {
        byteLength,
        toString,
        write
      };
    }
  });

  // node_modules/b4a/lib/hex.js
  var require_hex = __commonJS({
    "node_modules/b4a/lib/hex.js"(exports, module) {
      function byteLength(string) {
        return string.length >>> 1;
      }
      function toString(buffer) {
        const len = buffer.byteLength;
        buffer = new DataView(buffer.buffer, buffer.byteOffset, len);
        let result = "";
        let i = 0;
        for (let n = len - len % 4; i < n; i += 4) {
          result += buffer.getUint32(i).toString(16).padStart(8, "0");
        }
        for (; i < len; i++) {
          result += buffer.getUint8(i).toString(16).padStart(2, "0");
        }
        return result;
      }
      function write(buffer, string) {
        const len = buffer.byteLength;
        for (let i = 0; i < len; i++) {
          const a = hexValue(string.charCodeAt(i * 2));
          const b = hexValue(string.charCodeAt(i * 2 + 1));
          if (a === void 0 || b === void 0) {
            return i;
          }
          buffer[i] = a << 4 | b;
        }
        return len;
      }
      module.exports = {
        byteLength,
        toString,
        write
      };
      function hexValue(char) {
        if (char >= 48 && char <= 57) return char - 48;
        if (char >= 65 && char <= 70) return char - 65 + 10;
        if (char >= 97 && char <= 102) return char - 97 + 10;
      }
    }
  });

  // node_modules/b4a/lib/latin1.js
  var require_latin1 = __commonJS({
    "node_modules/b4a/lib/latin1.js"(exports, module) {
      function byteLength(string) {
        return string.length;
      }
      function toString(buffer) {
        const len = buffer.byteLength;
        let result = "";
        for (let i = 0; i < len; i++) {
          result += String.fromCharCode(buffer[i]);
        }
        return result;
      }
      function write(buffer, string) {
        const len = buffer.byteLength;
        for (let i = 0; i < len; i++) {
          buffer[i] = string.charCodeAt(i);
        }
        return len;
      }
      module.exports = {
        byteLength,
        toString,
        write
      };
    }
  });

  // node_modules/b4a/lib/utf8.js
  var require_utf8 = __commonJS({
    "node_modules/b4a/lib/utf8.js"(exports, module) {
      function byteLength(string) {
        let length = 0;
        for (let i = 0, n = string.length; i < n; i++) {
          const code = string.charCodeAt(i);
          if (code >= 55296 && code <= 56319 && i + 1 < n) {
            const code2 = string.charCodeAt(i + 1);
            if (code2 >= 56320 && code2 <= 57343) {
              length += 4;
              i++;
              continue;
            }
          }
          if (code <= 127) length += 1;
          else if (code <= 2047) length += 2;
          else length += 3;
        }
        return length;
      }
      var toString;
      if (typeof TextDecoder !== "undefined") {
        const decoder = new TextDecoder();
        toString = function toString2(buffer) {
          return decoder.decode(buffer);
        };
      } else {
        toString = function toString2(buffer) {
          const len = buffer.byteLength;
          let output = "";
          let i = 0;
          while (i < len) {
            let byte = buffer[i];
            if (byte <= 127) {
              output += String.fromCharCode(byte);
              i++;
              continue;
            }
            let bytesNeeded = 0;
            let codePoint = 0;
            if (byte <= 223) {
              bytesNeeded = 1;
              codePoint = byte & 31;
            } else if (byte <= 239) {
              bytesNeeded = 2;
              codePoint = byte & 15;
            } else if (byte <= 244) {
              bytesNeeded = 3;
              codePoint = byte & 7;
            }
            if (len - i - bytesNeeded > 0) {
              let k = 0;
              while (k < bytesNeeded) {
                byte = buffer[i + k + 1];
                codePoint = codePoint << 6 | byte & 63;
                k += 1;
              }
            } else {
              codePoint = 65533;
              bytesNeeded = len - i;
            }
            output += String.fromCodePoint(codePoint);
            i += bytesNeeded + 1;
          }
          return output;
        };
      }
      var write;
      if (typeof TextEncoder !== "undefined") {
        const encoder = new TextEncoder();
        write = function write2(buffer, string) {
          return encoder.encodeInto(string, buffer).written;
        };
      } else {
        write = function write2(buffer, string) {
          const len = buffer.byteLength;
          let i = 0;
          let j = 0;
          while (i < string.length) {
            const code = string.codePointAt(i);
            if (code <= 127) {
              if (j + 1 > len) break;
              buffer[j++] = code;
              i++;
              continue;
            }
            let count = 0;
            let bits = 0;
            if (code <= 2047) {
              count = 6;
              bits = 192;
            } else if (code <= 65535) {
              count = 12;
              bits = 224;
            } else if (code <= 2097151) {
              count = 18;
              bits = 240;
            }
            if (j + count / 6 + 1 > len) break;
            buffer[j++] = bits | code >> count;
            count -= 6;
            while (count >= 0) {
              buffer[j++] = 128 | code >> count & 63;
              count -= 6;
            }
            i += code >= 65536 ? 2 : 1;
          }
          return j;
        };
      }
      module.exports = {
        byteLength,
        toString,
        write
      };
    }
  });

  // node_modules/b4a/lib/utf16le.js
  var require_utf16le = __commonJS({
    "node_modules/b4a/lib/utf16le.js"(exports, module) {
      function byteLength(string) {
        return string.length * 2;
      }
      function toString(buffer) {
        const len = buffer.byteLength;
        let result = "";
        for (let i = 0; i < len - 1; i += 2) {
          result += String.fromCharCode(buffer[i] + buffer[i + 1] * 256);
        }
        return result;
      }
      function write(buffer, string) {
        const len = buffer.byteLength;
        let units = len;
        for (let i = 0; i < string.length; ++i) {
          if ((units -= 2) < 0) break;
          const c2 = string.charCodeAt(i);
          const hi = c2 >> 8;
          const lo = c2 % 256;
          buffer[i * 2] = lo;
          buffer[i * 2 + 1] = hi;
        }
        return len;
      }
      module.exports = {
        byteLength,
        toString,
        write
      };
    }
  });

  // node_modules/b4a/browser.js
  var require_browser = __commonJS({
    "node_modules/b4a/browser.js"(exports, module) {
      var ascii = require_ascii();
      var base64 = require_base64();
      var hex = require_hex();
      var latin1 = require_latin1();
      var utf8 = require_utf8();
      var utf16le = require_utf16le();
      var LE = new Uint8Array(Uint16Array.of(255).buffer)[0] === 255;
      function codecFor(encoding) {
        switch (encoding) {
          case "ascii":
            return ascii;
          case "base64":
            return base64;
          case "hex":
            return hex;
          case "binary":
          case "latin1":
            return latin1;
          case "utf8":
          case "utf-8":
          case void 0:
          case null:
            return utf8;
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return utf16le;
          default:
            throw new Error(`Unknown encoding '${encoding}'`);
        }
      }
      function isBuffer(value) {
        return value instanceof Uint8Array;
      }
      function isEncoding(encoding) {
        try {
          codecFor(encoding);
          return true;
        } catch {
          return false;
        }
      }
      function alloc(size, fill2, encoding) {
        const buffer = new Uint8Array(size);
        if (fill2 !== void 0) {
          exports.fill(buffer, fill2, 0, buffer.byteLength, encoding);
        }
        return buffer;
      }
      function allocUnsafe(size) {
        return new Uint8Array(size);
      }
      function allocUnsafeSlow(size) {
        return new Uint8Array(size);
      }
      function byteLength(string, encoding) {
        return codecFor(encoding).byteLength(string);
      }
      function compare(a, b) {
        if (a === b) return 0;
        const len = Math.min(a.byteLength, b.byteLength);
        a = new DataView(a.buffer, a.byteOffset, a.byteLength);
        b = new DataView(b.buffer, b.byteOffset, b.byteLength);
        let i = 0;
        for (let n = len - len % 4; i < n; i += 4) {
          const x = a.getUint32(i, LE);
          const y = b.getUint32(i, LE);
          if (x !== y) break;
        }
        for (; i < len; i++) {
          const x = a.getUint8(i);
          const y = b.getUint8(i);
          if (x < y) return -1;
          if (x > y) return 1;
        }
        return a.byteLength > b.byteLength ? 1 : a.byteLength < b.byteLength ? -1 : 0;
      }
      function concat(buffers, length) {
        if (length === void 0) {
          length = buffers.reduce((len, buffer) => len + buffer.byteLength, 0);
        }
        const result = new Uint8Array(length);
        let offset = 0;
        for (const buffer of buffers) {
          if (offset + buffer.byteLength > result.byteLength) {
            result.set(buffer.subarray(0, result.byteLength - offset), offset);
            return result;
          }
          result.set(buffer, offset);
          offset += buffer.byteLength;
        }
        return result;
      }
      function copy(source, target, targetStart = 0, sourceStart = 0, sourceEnd = source.byteLength) {
        if (targetStart < 0) targetStart = 0;
        if (targetStart >= target.byteLength) return 0;
        const targetLength = target.byteLength - targetStart;
        if (sourceStart < 0) sourceStart = 0;
        if (sourceStart >= source.byteLength) return 0;
        if (sourceEnd <= sourceStart) return 0;
        if (sourceEnd > source.byteLength) sourceEnd = source.byteLength;
        if (sourceEnd - sourceStart > targetLength) {
          sourceEnd = sourceStart + targetLength;
        }
        const sourceLength = sourceEnd - sourceStart;
        if (source === target) {
          target.copyWithin(targetStart, sourceStart, sourceEnd);
        } else {
          if (sourceStart !== 0 || sourceEnd !== source.byteLength) {
            source = source.subarray(sourceStart, sourceEnd);
          }
          target.set(source, targetStart);
        }
        return sourceLength;
      }
      function equals(a, b) {
        if (a === b) return true;
        if (a.byteLength !== b.byteLength) return false;
        return compare(a, b) === 0;
      }
      function fill(buffer, value, offset = 0, end = buffer.byteLength, encoding = "utf8") {
        if (typeof value === "string") {
          if (typeof offset === "string") {
            encoding = offset;
            offset = 0;
            end = buffer.byteLength;
          } else if (typeof end === "string") {
            encoding = end;
            end = buffer.byteLength;
          }
        } else if (typeof value === "number") {
          value = value & 255;
        } else if (typeof value === "boolean") {
          value = +value;
        }
        if (offset < 0) offset = 0;
        if (offset >= buffer.byteLength) return buffer;
        if (end <= offset) return buffer;
        if (end > buffer.byteLength) end = buffer.byteLength;
        if (typeof value === "number") return buffer.fill(value, offset, end);
        if (typeof value === "string") value = exports.from(value, encoding);
        const len = value.byteLength;
        for (let i = 0, n = end - offset; i < n; ++i) {
          buffer[i + offset] = value[i % len];
        }
        return buffer;
      }
      function from(value, encodingOrOffset, length) {
        if (typeof value === "string") return fromString(value, encodingOrOffset);
        if (Array.isArray(value)) return fromArray(value);
        if (ArrayBuffer.isView(value)) return fromBuffer(value);
        return fromArrayBuffer(value, encodingOrOffset, length);
      }
      function fromString(string, encoding) {
        const codec = codecFor(encoding);
        const buffer = new Uint8Array(codec.byteLength(string));
        codec.write(buffer, string);
        return buffer;
      }
      function fromArray(array) {
        const buffer = new Uint8Array(array.length);
        buffer.set(array);
        return buffer;
      }
      function fromBuffer(buffer) {
        const copy2 = new Uint8Array(buffer.byteLength);
        copy2.set(buffer);
        return copy2;
      }
      function fromArrayBuffer(arrayBuffer, byteOffset, length) {
        return new Uint8Array(arrayBuffer, byteOffset, length);
      }
      function includes(buffer, value, byteOffset, encoding) {
        return indexOf(buffer, value, byteOffset, encoding) !== -1;
      }
      function indexOf(buffer, value, byteOffset, encoding) {
        return bidirectionalIndexOf(
          buffer,
          value,
          byteOffset,
          encoding,
          true
          /* first */
        );
      }
      function lastIndexOf(buffer, value, byteOffset, encoding) {
        return bidirectionalIndexOf(
          buffer,
          value,
          byteOffset,
          encoding,
          false
          /* last */
        );
      }
      function bidirectionalIndexOf(buffer, value, byteOffset, encoding, first) {
        if (buffer.byteLength === 0) return -1;
        if (typeof byteOffset === "string") {
          encoding = byteOffset;
          byteOffset = 0;
        } else if (byteOffset === void 0) {
          byteOffset = first ? 0 : buffer.length - 1;
        } else if (byteOffset < 0) {
          byteOffset += buffer.byteLength;
        }
        if (byteOffset >= buffer.byteLength) {
          if (first) return -1;
          else byteOffset = buffer.byteLength - 1;
        } else if (byteOffset < 0) {
          if (first) byteOffset = 0;
          else return -1;
        }
        if (typeof value === "string") {
          value = from(value, encoding);
        } else if (typeof value === "number") {
          value = value & 255;
          if (first) {
            return buffer.indexOf(value, byteOffset);
          } else {
            return buffer.lastIndexOf(value, byteOffset);
          }
        }
        if (value.byteLength === 0) return -1;
        if (first) {
          let foundIndex = -1;
          for (let i = byteOffset; i < buffer.byteLength; i++) {
            if (buffer[i] === value[foundIndex === -1 ? 0 : i - foundIndex]) {
              if (foundIndex === -1) foundIndex = i;
              if (i - foundIndex + 1 === value.byteLength) return foundIndex;
            } else {
              if (foundIndex !== -1) i -= i - foundIndex;
              foundIndex = -1;
            }
          }
        } else {
          if (byteOffset + value.byteLength > buffer.byteLength) {
            byteOffset = buffer.byteLength - value.byteLength;
          }
          for (let i = byteOffset; i >= 0; i--) {
            let found = true;
            for (let j = 0; j < value.byteLength; j++) {
              if (buffer[i + j] !== value[j]) {
                found = false;
                break;
              }
            }
            if (found) return i;
          }
        }
        return -1;
      }
      function swap(buffer, n, m) {
        const i = buffer[n];
        buffer[n] = buffer[m];
        buffer[m] = i;
      }
      function swap16(buffer) {
        const len = buffer.byteLength;
        if (len % 2 !== 0) {
          throw new RangeError("Buffer size must be a multiple of 16-bits");
        }
        for (let i = 0; i < len; i += 2) swap(buffer, i, i + 1);
        return buffer;
      }
      function swap32(buffer) {
        const len = buffer.byteLength;
        if (len % 4 !== 0) {
          throw new RangeError("Buffer size must be a multiple of 32-bits");
        }
        for (let i = 0; i < len; i += 4) {
          swap(buffer, i, i + 3);
          swap(buffer, i + 1, i + 2);
        }
        return buffer;
      }
      function swap64(buffer) {
        const len = buffer.byteLength;
        if (len % 8 !== 0) {
          throw new RangeError("Buffer size must be a multiple of 64-bits");
        }
        for (let i = 0; i < len; i += 8) {
          swap(buffer, i, i + 7);
          swap(buffer, i + 1, i + 6);
          swap(buffer, i + 2, i + 5);
          swap(buffer, i + 3, i + 4);
        }
        return buffer;
      }
      function toBuffer(buffer) {
        return buffer;
      }
      function toString(buffer, encoding = "utf8", start = 0, end = buffer.byteLength) {
        if (arguments.length === 1) return utf8.toString(buffer);
        if (arguments.length === 2) return codecFor(encoding).toString(buffer);
        if (start < 0) start = 0;
        if (start >= buffer.byteLength) return "";
        if (end <= start) return "";
        if (end > buffer.byteLength) end = buffer.byteLength;
        if (start !== 0 || end !== buffer.byteLength) {
          buffer = buffer.subarray(start, end);
        }
        return codecFor(encoding).toString(buffer);
      }
      function write(buffer, string, offset = 0, length = buffer.byteLength, encoding) {
        if (arguments.length === 2) return utf8.write(buffer, string);
        if (typeof offset === "string") {
          encoding = offset;
          offset = 0;
          length = buffer.byteLength;
        } else if (typeof length === "string") {
          encoding = length;
          length = buffer.byteLength - offset;
        }
        length = Math.min(length, exports.byteLength(string, encoding));
        let start = offset;
        if (start < 0) start = 0;
        if (start >= buffer.byteLength) return 0;
        let end = offset + length;
        if (end <= start) return 0;
        if (end > buffer.byteLength) end = buffer.byteLength;
        if (start !== 0 || end !== buffer.byteLength) {
          buffer = buffer.subarray(start, end);
        }
        return codecFor(encoding).write(buffer, string);
      }
      function readDoubleBE(buffer, offset = 0) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        return view.getFloat64(offset, false);
      }
      function readDoubleLE(buffer, offset = 0) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        return view.getFloat64(offset, true);
      }
      function readFloatBE(buffer, offset = 0) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        return view.getFloat32(offset, false);
      }
      function readFloatLE(buffer, offset = 0) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        return view.getFloat32(offset, true);
      }
      function readInt32BE(buffer, offset = 0) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        return view.getInt32(offset, false);
      }
      function readInt32LE(buffer, offset = 0) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        return view.getInt32(offset, true);
      }
      function readUInt32BE(buffer, offset = 0) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        return view.getUint32(offset, false);
      }
      function readUInt32LE(buffer, offset = 0) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        return view.getUint32(offset, true);
      }
      function writeDoubleBE(buffer, value, offset = 0) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        view.setFloat64(offset, value, false);
        return offset + 8;
      }
      function writeDoubleLE(buffer, value, offset = 0) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        view.setFloat64(offset, value, true);
        return offset + 8;
      }
      function writeFloatBE(buffer, value, offset = 0) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        view.setFloat32(offset, value, false);
        return offset + 4;
      }
      function writeFloatLE(buffer, value, offset = 0) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        view.setFloat32(offset, value, true);
        return offset + 4;
      }
      function writeInt32BE(buffer, value, offset = 0) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        view.setInt32(offset, value, false);
        return offset + 4;
      }
      function writeInt32LE(buffer, value, offset = 0) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        view.setInt32(offset, value, true);
        return offset + 4;
      }
      function writeUInt32BE(buffer, value, offset = 0) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        view.setUint32(offset, value, false);
        return offset + 4;
      }
      function writeUInt32LE(buffer, value, offset = 0) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        view.setUint32(offset, value, true);
        return offset + 4;
      }
      module.exports = exports = {
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
    "node_modules/compact-encoding/endian.js"(exports) {
      var LE = exports.LE = new Uint8Array(new Uint16Array([255]).buffer)[0] === 255;
      exports.BE = !LE;
    }
  });

  // node_modules/compact-encoding/raw.js
  var require_raw = __commonJS({
    "node_modules/compact-encoding/raw.js"(exports, module) {
      var b4a2 = require_browser();
      var { BE } = require_endian();
      exports = module.exports = {
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
      var buffer = exports.buffer = {
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
      exports.binary = {
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
      exports.arraybuffer = {
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
      var uint8array = exports.uint8array = typedarray(Uint8Array);
      exports.uint16array = typedarray(Uint16Array, b4a2.swap16);
      exports.uint32array = typedarray(Uint32Array, b4a2.swap32);
      exports.int8array = typedarray(Int8Array);
      exports.int16array = typedarray(Int16Array, b4a2.swap16);
      exports.int32array = typedarray(Int32Array, b4a2.swap32);
      exports.biguint64array = typedarray(BigUint64Array, b4a2.swap64);
      exports.bigint64array = typedarray(BigInt64Array, b4a2.swap64);
      exports.float32array = typedarray(Float32Array, b4a2.swap32);
      exports.float64array = typedarray(Float64Array, b4a2.swap64);
      function string(encoding) {
        return {
          preencode(state, s) {
            state.end += b4a2.byteLength(s, encoding);
          },
          encode(state, s) {
            state.start += b4a2.write(state.buffer, s, state.start, encoding);
          },
          decode(state) {
            const s = b4a2.toString(state.buffer, encoding, state.start);
            state.start = state.end;
            return s;
          }
        };
      }
      var utf8 = exports.string = exports.utf8 = string("utf-8");
      exports.ascii = string("ascii");
      exports.hex = string("hex");
      exports.base64 = string("base64");
      exports.ucs2 = exports.utf16le = string("utf16le");
      exports.array = function array(enc) {
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
      exports.json = {
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
      exports.ndjson = {
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
    "node_modules/compact-encoding/lexint.js"(exports, module) {
      module.exports = {
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
    "node_modules/compact-encoding/index.js"(exports) {
      var b4a2 = require_browser();
      var { BE } = require_endian();
      exports.state = function(start = 0, end = 0, buffer2 = null) {
        return { start, end, buffer: buffer2 };
      };
      var raw = exports.raw = require_raw();
      var uint = exports.uint = {
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
      var uint8 = exports.uint8 = {
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
      var uint16 = exports.uint16 = {
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
      var uint24 = exports.uint24 = {
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
      var uint32 = exports.uint32 = {
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
      var uint40 = exports.uint40 = {
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
      var uint48 = exports.uint48 = {
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
      var uint56 = exports.uint56 = {
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
      var uint64 = exports.uint64 = {
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
      var int = exports.int = zigZagInt(uint);
      exports.int8 = zigZagInt(uint8);
      exports.int16 = zigZagInt(uint16);
      exports.int24 = zigZagInt(uint24);
      exports.int32 = zigZagInt(uint32);
      exports.int40 = zigZagInt(uint40);
      exports.int48 = zigZagInt(uint48);
      exports.int56 = zigZagInt(uint56);
      exports.int64 = zigZagInt(uint64);
      var biguint64 = exports.biguint64 = {
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
      exports.bigint64 = zigZagBigInt(biguint64);
      var biguint = exports.biguint = {
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
      exports.bigint = zigZagBigInt(biguint);
      exports.lexint = require_lexint();
      exports.float32 = {
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
      exports.float64 = {
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
      var buffer = exports.buffer = {
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
      exports.binary = {
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
      exports.arraybuffer = {
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
      var uint8array = exports.uint8array = typedarray(Uint8Array);
      exports.uint16array = typedarray(Uint16Array, b4a2.swap16);
      exports.uint32array = typedarray(Uint32Array, b4a2.swap32);
      exports.int8array = typedarray(Int8Array);
      exports.int16array = typedarray(Int16Array, b4a2.swap16);
      exports.int32array = typedarray(Int32Array, b4a2.swap32);
      exports.biguint64array = typedarray(BigUint64Array, b4a2.swap64);
      exports.bigint64array = typedarray(BigInt64Array, b4a2.swap64);
      exports.float32array = typedarray(Float32Array, b4a2.swap32);
      exports.float64array = typedarray(Float64Array, b4a2.swap64);
      function string(encoding) {
        return {
          preencode(state, s) {
            const len = b4a2.byteLength(s, encoding);
            uint.preencode(state, len);
            state.end += len;
          },
          encode(state, s) {
            const len = b4a2.byteLength(s, encoding);
            uint.encode(state, len);
            b4a2.write(state.buffer, s, state.start, encoding);
            state.start += len;
          },
          decode(state) {
            const len = uint.decode(state);
            if (state.end - state.start < len) throw new Error("Out of bounds");
            return b4a2.toString(
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
                b4a2.write(state.buffer, s, state.start, n, encoding);
                state.start += n;
              },
              decode(state) {
                if (state.end - state.start < n) throw new Error("Out of bounds");
                return b4a2.toString(
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
      var utf8 = exports.string = exports.utf8 = string("utf-8");
      exports.ascii = string("ascii");
      exports.hex = string("hex");
      exports.base64 = string("base64");
      exports.ucs2 = exports.utf16le = string("utf16le");
      exports.bool = {
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
      var fixed = exports.fixed = function fixed2(n) {
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
      exports.fixed32 = fixed(32);
      exports.fixed64 = fixed(64);
      exports.array = function array(enc) {
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
      exports.frame = function frame(enc) {
        const dummy = exports.state();
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
      exports.date = {
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
      exports.json = {
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
      exports.ndjson = {
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
      exports.none = {
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
        exports.none,
        exports.bool,
        exports.string,
        exports.buffer,
        exports.uint,
        exports.int,
        exports.float64,
        anyArray,
        anyObject,
        exports.date
      ];
      var any = exports.any = {
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
      var port = exports.port = uint16;
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
      var ipv4 = exports.ipv4 = {
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
      exports.ipv4Address = address(ipv4, 4);
      var ipv6 = exports.ipv6 = {
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
      exports.ipv6Address = address(ipv6, 6);
      var ip = exports.ip = {
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
      exports.ipAddress = {
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
      var record = exports.record = function(keyEncoding, valueEncoding) {
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
      exports.stringRecord = record(utf8, utf8);
      function getType(o) {
        if (o === null || o === void 0) return 0;
        if (typeof o === "boolean") return 1;
        if (typeof o === "string") return 2;
        if (b4a2.isBuffer(o)) return 3;
        if (typeof o === "number") {
          if (Number.isInteger(o)) return o >= 0 ? 4 : 5;
          return 6;
        }
        if (Array.isArray(o)) return 7;
        if (o instanceof Date) return 9;
        if (typeof o === "object") return 8;
        throw new Error("Unsupported type for " + o);
      }
      exports.from = function from(enc) {
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
      exports.encode = function encode(enc, m) {
        const state = exports.state();
        enc.preencode(state, m);
        state.buffer = b4a2.allocUnsafe(state.end);
        enc.encode(state, m);
        return state.buffer;
      };
      exports.decode = function decode(enc, buffer2) {
        return enc.decode(exports.state(0, buffer2.byteLength, buffer2));
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
    "node_modules/compact-encoding-struct/bitfield.js"(exports, module) {
      var c2 = require_compact_encoding();
      module.exports = {
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
    "node_modules/compact-encoding-struct/index.js"(exports, module) {
      var c2 = require_compact_encoding();
      var bitfield = require_bitfield();
      module.exports = {
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
      module.exports.flag = {
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

  // client-entry.mjs
  var import_buffer = __toESM(require_buffer(), 1);

  // node_modules/pear-request/dist/requests.js
  var import_compact_encoding = __toESM(require_compact_encoding(), 1);
  var import_compact_encoding_struct = __toESM(require_compact_encoding_struct(), 1);
  var import_b4a = __toESM(require_browser(), 1);
  var import_compact_encoding2 = __toESM(require_compact_encoding(), 1);
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
  function create(pipe) {
    const pendingRequests = {};
    class PearRequestUpload {
      events = {};
      addEventListener(event, callback) {
        this.events[event] = callback;
      }
    }
    class PearRequest {
      method;
      url;
      mimeType;
      readyState = 0;
      headers = {};
      events = {};
      _responseHeaders;
      _response;
      status;
      statusText;
      static _pendingRequests = {};
      onload;
      getAllResponseHeaders() {
        return {
          ...this._responseHeaders
        };
      }
      get response() {
        if (!this._response) {
          return null;
        }
        if (this.mimeType === "application/json") {
          return JSON.parse(import_b4a.default.toString(this._response, "utf-8"));
        } else if (this.mimeType?.startsWith("text/")) {
          return import_b4a.default.toString(this._response, "utf-8");
        } else {
          return this._response;
        }
      }
      get responseText() {
        return this._response?.toString("utf-8");
      }
      get responseType() {
        return this.mimeType;
      }
      open(method, url) {
        this.method = method;
        this.url = url;
        this.readyState = 1;
      }
      send(body) {
        const id = crypto.randomUUID();
        this.readyState = 2;
        pendingRequests[id] = this;
        const buff = !body ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(body, "utf-8");
        pipe.write(import_compact_encoding2.default.encode(requestEncoding, {
          id,
          method: this.method,
          url: this.url,
          body: buff
        }));
      }
      upload = new PearRequestUpload();
      overrideMimeType(mimeType) {
        this.mimeType = mimeType;
      }
      setRequestHeader(header2, value) {
        this.headers[header2] = value;
      }
      addEventListener(event, callback) {
        this.events[event] = callback;
      }
    }
    let incomingBuffer = Buffer.alloc(0);
    let expectedLength = 0;
    pipe.on("data", (data) => {
      incomingBuffer = Buffer.concat([incomingBuffer, Buffer.from(data)]);
      try {
        if (incomingBuffer.length < 4) {
          return;
        }
        if (expectedLength === 0) {
          const length = import_compact_encoding2.default.decode(import_compact_encoding2.default.uint32, incomingBuffer.subarray(0, 4));
          expectedLength = length;
          incomingBuffer = incomingBuffer.subarray(4);
        }
        if (incomingBuffer.length < expectedLength) {
          return;
        }
        const { id, body, headers } = import_compact_encoding2.default.decode(responseEncoding, incomingBuffer);
        const pendingRequest = pendingRequests[id];
        if (pendingRequest) {
          pendingRequest._response = pendingRequest._response ? Buffer.concat([pendingRequest._response, body]) : body;
          pendingRequest.status = 200;
          pendingRequest.statusText = "OK";
          pendingRequest._responseHeaders = headers;
          pendingRequest.readyState = 4;
          pendingRequest["onload"]?.();
        }
        incomingBuffer = Buffer.alloc(0);
        expectedLength = 0;
      } catch (error) {
        console.error("Error decoding header", error);
      }
    });
    return PearRequest;
  }

  // client-entry.mjs
  if (!globalThis.Buffer) globalThis.Buffer = import_buffer.Buffer;
  globalThis.createPearRequest = create;
})();
/*! Bundled license information:

ieee754/index.js:
  (*! ieee754. BSD-3-Clause License. Feross Aboukhadijeh <https://feross.org/opensource> *)

buffer/index.js:
  (*!
   * The buffer module from node.js, for the browser.
   *
   * @author   Feross Aboukhadijeh <https://feross.org>
   * @license  MIT
   *)
*/
