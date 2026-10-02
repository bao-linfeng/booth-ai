import { Readable } from 'node:stream';
import { crc32 } from 'node:zlib';

export interface ZipEntry {
  name: string;
  /** Opened lazily, one entry at a time, so idle storage connections are never held open. */
  open(): Promise<AsyncIterable<Uint8Array> | Iterable<Uint8Array>>;
}

// General purpose flags: bit 3 = sizes/CRC follow in a data descriptor, bit 11 = UTF-8 file names.
const FLAGS = 0x0808;
const VERSION = 20;
const MAX_UINT32 = 0xffffffff;

function dosDateTime(date: Date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: (Math.max(date.getFullYear() - 1980, 0) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

async function* storedZip(entries: ZipEntry[], modified: Date): AsyncGenerator<Buffer> {
  if (entries.length > 0xffff) throw new Error('Too many ZIP entries');
  const { time, date } = dosDateTime(modified);
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(FLAGS, 6);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt16LE(name.length, 26);
    yield local;
    yield name;

    let crc = 0;
    let size = 0;
    for await (const chunk of await entry.open()) {
      crc = crc32(chunk, crc);
      size += chunk.byteLength;
      if (offset + size > MAX_UINT32) throw new Error('ZIP64 archives are not supported');
      yield Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    }
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(size, 8);
    descriptor.writeUInt32LE(size, 12);
    yield descriptor;

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(VERSION, 4);
    header.writeUInt16LE(VERSION, 6);
    header.writeUInt16LE(FLAGS, 8);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(date, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(size, 20);
    header.writeUInt32LE(size, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);
    offset += local.length + name.length + size + descriptor.length;
  }
  const centralSize = central.reduce((total, part) => total + part.length, 0);
  if (offset + centralSize > MAX_UINT32) throw new Error('ZIP64 archives are not supported');
  yield* central;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  yield end;
}

/**
 * Streams an uncompressed (STORE) ZIP archive. Memory use is bounded by a single chunk regardless of entry size.
 * A failing entry destroys the stream, leaving the client with a truncated, unreadable archive.
 */
export function storedZipStream(entries: ZipEntry[], modified = new Date()): Readable {
  return Readable.from(storedZip(entries, modified), { objectMode: false });
}
