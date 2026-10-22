// Runs squeezePdf in a Web Worker so the page stays responsive.
// Message in:  { id, bytes: ArrayBuffer, options, wasm?: ArrayBuffer }
// Message out: { id, ok: true, pdf: ArrayBuffer } | { id, ok: false, error: string }
import { squeezePdf } from './squeeze.mjs';

self.onmessage = async (event) => {
  const { id, bytes, options, wasm } = event.data;
  try {
    const pdf = await squeezePdf(new Uint8Array(bytes), { ...options, wasmBinary: wasm });
    self.postMessage({ id, ok: true, pdf: pdf.buffer }, [pdf.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message || String(err) });
  }
};
