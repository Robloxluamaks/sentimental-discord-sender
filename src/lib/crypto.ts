// Browser-only. Password-based AES-GCM for encrypting stored profiles.
// Do NOT import from server code.

const enc = new TextEncoder();
const dec = new TextDecoder();

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(password) as BufferSource, "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 210_000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function b64(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}
function ub64(s: string): Uint8Array {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

export type EncryptedBlob = { v: 1; alg: "AES-GCM"; salt: string; iv: string; ct: string };

export function isEncryptedBlob(x: unknown): x is EncryptedBlob {
  return !!x && typeof x === "object" && (x as EncryptedBlob).alg === "AES-GCM" && (x as EncryptedBlob).v === 1;
}

export async function encryptJSON(data: unknown, password: string): Promise<EncryptedBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    enc.encode(JSON.stringify(data)) as BufferSource,
  );
  return { v: 1, alg: "AES-GCM", salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

export async function decryptJSON<T = unknown>(blob: EncryptedBlob, password: string): Promise<T> {
  const salt = ub64(blob.salt);
  const iv = ub64(blob.iv);
  const key = await deriveKey(password, salt);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ub64(blob.ct) as BufferSource,
  );
  return JSON.parse(dec.decode(pt)) as T;
}