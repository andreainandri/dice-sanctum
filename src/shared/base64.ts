// Bytes in base64 e ritorno, con `btoa` e `atob`: ci sono nel browser e in Node.

export function inBase64(bytes: Uint8Array): string {
  let binario = '';
  const PEZZO = 0x8000;
  for (let i = 0; i < bytes.length; i += PEZZO) binario += String.fromCharCode(...bytes.subarray(i, i + PEZZO));
  return btoa(binario);
}

/** Lancia se il testo non è base64. */
export function daBase64(testo: string): Uint8Array {
  const binario = atob(testo);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}
