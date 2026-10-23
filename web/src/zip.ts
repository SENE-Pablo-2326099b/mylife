/**
 * Lecture d'une archive .zip dans le navigateur, sans bibliothèque : l'annuaire central, puis chaque
 * fichier voulu, décompressé par le navigateur (DecompressionStream « deflate-raw »). Suffisant pour
 * l'export de données Spotify (fichiers stockés ou compressés, moins de 4 Go, sans chiffrement).
 */

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);

export interface ZipEntry {
  name: string;
  read: () => Promise<string>;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function listZip(file: Blob): Promise<ZipEntry[]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // Fin de l'annuaire central : signature 0x06054b50, dans les 64 Ko de la fin (commentaire éventuel).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (u32(view, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Ce fichier n’est pas une archive .zip lisible.');
  const count = u16(view, eocd + 10);
  let p = u32(view, eocd + 16);
  const names = new TextDecoder();
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (u32(view, p) !== 0x02014b50) throw new Error('Archive .zip abîmée.');
    const method = u16(view, p + 10);
    const flags = u16(view, p + 8);
    const size = u32(view, p + 20);
    const nameLen = u16(view, p + 28);
    const extraLen = u16(view, p + 30);
    const commentLen = u16(view, p + 32);
    const local = u32(view, p + 42);
    const name = names.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    out.push({
      name,
      read: async () => {
        if (flags & 1) throw new Error('Archive chiffrée : impossible à lire.');
        const start = local + 30 + u16(view, local + 26) + u16(view, local + 28);
        const raw = buf.subarray(start, start + size);
        const bytes = method === 0 ? raw : method === 8 ? await inflate(raw) : null;
        if (!bytes) throw new Error('Compression non prise en charge.');
        return new TextDecoder().decode(bytes);
      },
    });
  }
  return out;
}
