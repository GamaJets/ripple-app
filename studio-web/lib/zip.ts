// A zip writer, written out by hand because a zip is not worth a dependency.
//
// The export produces eleven files, and handing them over one browser download
// at a time is not handing over a bundle: the gym gets eleven loose objects in
// their Downloads folder, in whatever order the browser felt like, with the
// README and the manifest — the two files that say what is MISSING from the
// record — as indistinguishable from the rest as everything else. Chromium also
// throttles a burst of programmatic downloads and silently drops the tail, so
// the old loop had to pause between files and still could not promise that all
// eleven arrived. One archive either arrives or does not.
//
// The format below is the 1989 original: local header, data, central directory,
// end-of-central-directory. No zip64, because zip64 only matters past 4 GiB or
// 65,535 entries and this bundle is eleven text files; `zipSync` throws rather
// than writing a truncated archive if a gym ever manages to break that, since a
// zip that unpacks to a short file is worse than no zip.
//
// Compression is DEFLATE via the platform's own CompressionStream where the
// browser has it (CSV compresses about tenfold), and STORE where it does not.
// Both are legal zips that every unpacker reads; the only difference is size.

/** One member of the archive. `text` is encoded UTF-8, BOM and all. */
export interface ZipEntry {
  name: string;
  text: string;
}

/* ── CRC-32, which the format requires per entry ───────────────────────────── */

// Built once on first use rather than at module load: this file is imported by
// a page that may never reach the download button.
let CRC_TABLE: Uint32Array | null = null;

function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}

function crc32(bytes: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ── DEFLATE, if the browser brought one ───────────────────────────────────── */

/**
 * Raw DEFLATE with no zlib wrapper, which is what zip method 8 wants.
 *
 * Returns null — rather than throwing — when the platform has no
 * CompressionStream or the stream refuses, so the caller falls back to STORE.
 * A bigger archive is a fine outcome; a failed export is not.
 */
async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
  const CS = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream;
  if (typeof CS !== 'function') return null;
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CS('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/* ── the archive ───────────────────────────────────────────────────────────── */

/** DOS date and time, which is what a zip header stores. Seconds are halved and
 *  years count from 1980 — both are the format's, not ours. */
function dosStamp(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const U32_MAX = 0xffffffff;

/**
 * Build a zip of `entries`, returned as a Blob ready to hand to a download.
 *
 * Throws if the archive would need zip64. That is a real refusal rather than a
 * best effort: the alternative is an archive whose sizes have wrapped, which
 * unpacks to files that are quietly the wrong length.
 */
export async function zip(entries: ZipEntry[], at: Date = new Date()): Promise<Blob> {
  if (entries.length > 0xffff) {
    throw new Error(`A zip without zip64 holds 65,535 files; this bundle has ${entries.length}.`);
  }

  const enc = new TextEncoder();
  const { time, date } = dosStamp(at);

  // Written in one pass: each entry's local header and payload go into `parts`
  // while its central-directory record is built alongside, because the central
  // record needs the byte offset the local header started at.
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = enc.encode(e.name);
    const raw = enc.encode(e.text);
    const crc = crc32(raw);

    const deflated = await deflateRaw(raw);
    // Only worth it if it actually got smaller. A tiny or already-dense file
    // can deflate LARGER, and storing it then is both smaller and simpler.
    const useDeflate = deflated !== null && deflated.length < raw.length;
    const body = useDeflate ? (deflated as Uint8Array) : raw;
    const method = useDeflate ? 8 : 0;

    if (raw.length > U32_MAX || body.length > U32_MAX || offset > U32_MAX) {
      throw new Error(`${e.name} is too large for a zip without zip64.`);
    }

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // local file header signature
    local.setUint16(4, 20, true); // version needed: 2.0
    local.setUint16(6, 0x0800, true); // bit 11: the filename is UTF-8
    local.setUint16(8, method, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true); // no extra field

    parts.push(new Uint8Array(local.buffer), name, body);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true); // central directory header signature
    dir.setUint16(4, 20, true); // version made by
    dir.setUint16(6, 20, true); // version needed
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, method, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, date, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, body.length, true);
    dir.setUint32(24, raw.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint16(30, 0, true); // extra field length
    dir.setUint16(32, 0, true); // file comment length
    dir.setUint16(34, 0, true); // disk number start
    dir.setUint16(36, 0, true); // internal attributes
    dir.setUint32(38, 0, true); // external attributes
    dir.setUint32(42, offset, true);

    central.push(new Uint8Array(dir.buffer), name);
    offset += 30 + name.length + body.length;
  }

  const centralStart = offset;
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  if (centralStart > U32_MAX || centralSize > U32_MAX) {
    throw new Error('This bundle is too large for a zip without zip64.');
  }

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central directory signature
  end.setUint16(4, 0, true); // this disk
  end.setUint16(6, 0, true); // the disk the central directory starts on
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, centralStart, true);
  end.setUint16(20, 0, true); // no archive comment

  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], {
    type: 'application/zip',
  });
}
