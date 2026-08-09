// Random-access ZIP reader for very large packages.
//
// JSZip loads an entire archive into memory, which is fine for a deck export
// but not for a whole-collection .colpkg — a 1.1 GB file has to sit in RAM in
// full before a single card can be read, and reading it twice is what made
// imports fail outright.
//
// A ZIP is designed for random access: a directory at the end lists every
// entry's offset. Reading that directory, then slicing out only the handful of
// entries actually wanted, keeps peak memory at roughly the size of the
// largest single entry. Blob.slice() doesn't touch the disk until awaited, and
// DecompressionStream inflates natively.

export interface ZipEntry {
  name: string;
  /** 0 = stored, 8 = deflate */
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  /** offset of the local file header */
  headerOffset: number;
}

const EOCD_SIG = 0x06054b50;
const EOCD64_LOCATOR_SIG = 0x07064b50;
const EOCD64_SIG = 0x06064b50;
const CENTRAL_SIG = 0x02014b50;

/** True when this browser can inflate natively; without it we fall back. */
export function supportsBlobZip(): boolean {
  return typeof DecompressionStream === "function" && typeof Blob !== "undefined";
}

async function sliceBytes(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

export class BlobZip {
  private blob: Blob;
  readonly entries: Map<string, ZipEntry>;

  private constructor(blob: Blob, entries: Map<string, ZipEntry>) {
    this.blob = blob;
    this.entries = entries;
  }

  static async open(blob: Blob): Promise<BlobZip> {
    const size = blob.size;
    // The end-of-central-directory record sits in the last 22 bytes plus an
    // optional comment of up to 64 KB.
    const tailLen = Math.min(size, 0x10000 + 22);
    const tail = await sliceBytes(blob, size - tailLen, size);
    const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);

    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tailView.getUint32(i, true) === EOCD_SIG) {
        eocd = i;
        break;
      }
    }
    if (eocd === -1) throw new Error("Not a ZIP file (no end-of-directory record).");

    let entryCount = tailView.getUint16(eocd + 10, true);
    let cdSize = tailView.getUint32(eocd + 12, true);
    let cdOffset = tailView.getUint32(eocd + 16, true);

    // ZIP64: any of those fields maxed out means the real values live in the
    // ZIP64 record, which large collections do hit.
    if (cdOffset === 0xffffffff || cdSize === 0xffffffff || entryCount === 0xffff) {
      let locator = -1;
      for (let i = eocd - 20; i >= 0; i--) {
        if (tailView.getUint32(i, true) === EOCD64_LOCATOR_SIG) {
          locator = i;
          break;
        }
      }
      if (locator === -1) throw new Error("ZIP64 directory not found.");
      const eocd64Offset = Number(tailView.getBigUint64(locator + 8, true));
      const rec = await sliceBytes(blob, eocd64Offset, eocd64Offset + 56);
      const recView = new DataView(rec.buffer, rec.byteOffset, rec.byteLength);
      if (recView.getUint32(0, true) !== EOCD64_SIG) {
        throw new Error("Malformed ZIP64 directory.");
      }
      entryCount = Number(recView.getBigUint64(32, true));
      cdSize = Number(recView.getBigUint64(40, true));
      cdOffset = Number(recView.getBigUint64(48, true));
    }

    const cd = await sliceBytes(blob, cdOffset, cdOffset + cdSize);
    const cdView = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
    const decoder = new TextDecoder();
    const entries = new Map<string, ZipEntry>();

    let p = 0;
    for (let i = 0; i < entryCount && p + 46 <= cd.length; i++) {
      if (cdView.getUint32(p, true) !== CENTRAL_SIG) break;
      const method = cdView.getUint16(p + 10, true);
      let compressedSize = cdView.getUint32(p + 20, true);
      let uncompressedSize = cdView.getUint32(p + 24, true);
      const nameLen = cdView.getUint16(p + 28, true);
      const extraLen = cdView.getUint16(p + 30, true);
      const commentLen = cdView.getUint16(p + 32, true);
      let headerOffset = cdView.getUint32(p + 42, true);
      const name = decoder.decode(cd.subarray(p + 46, p + 46 + nameLen));

      // Oversized fields are stored in the ZIP64 extra block, in this order.
      if (
        uncompressedSize === 0xffffffff ||
        compressedSize === 0xffffffff ||
        headerOffset === 0xffffffff
      ) {
        let e = p + 46 + nameLen;
        const extraEnd = e + extraLen;
        while (e + 4 <= extraEnd) {
          const id = cdView.getUint16(e, true);
          const len = cdView.getUint16(e + 2, true);
          if (id === 0x0001) {
            let q = e + 4;
            if (uncompressedSize === 0xffffffff) {
              uncompressedSize = Number(cdView.getBigUint64(q, true));
              q += 8;
            }
            if (compressedSize === 0xffffffff) {
              compressedSize = Number(cdView.getBigUint64(q, true));
              q += 8;
            }
            if (headerOffset === 0xffffffff) {
              headerOffset = Number(cdView.getBigUint64(q, true));
            }
            break;
          }
          e += 4 + len;
        }
      }

      entries.set(name, {
        name,
        method,
        compressedSize,
        uncompressedSize,
        headerOffset,
      });
      p += 46 + nameLen + extraLen + commentLen;
    }

    return new BlobZip(blob, entries);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** Reads and inflates one entry. Only this entry's bytes enter memory. */
  async read(name: string): Promise<Uint8Array | null> {
    const entry = this.entries.get(name);
    if (!entry) return null;

    // The local header repeats the name/extra lengths, and only it is
    // trustworthy for where the data actually starts.
    const header = await sliceBytes(
      this.blob,
      entry.headerOffset,
      entry.headerOffset + 30
    );
    const hv = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const nameLen = hv.getUint16(26, true);
    const extraLen = hv.getUint16(28, true);
    const dataStart = entry.headerOffset + 30 + nameLen + extraLen;
    const dataEnd = dataStart + entry.compressedSize;

    if (entry.method === 0) {
      return sliceBytes(this.blob, dataStart, dataEnd);
    }
    if (entry.method !== 8) {
      throw new Error(`Unsupported compression in "${name}" (method ${entry.method}).`);
    }

    const stream = this.blob
      .slice(dataStart, dataEnd)
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"));
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value as Uint8Array);
      total += (value as Uint8Array).length;
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }
}
