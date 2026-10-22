// Compresses a PDF in memory with Ghostscript's pdfwrite (GhostPDL 10.09, built to WebAssembly).
import createGhostPDF from '../dist/gpdf.mjs';

const MIN_DPI = 36;
const MAX_DPI = 600;

// Builds the argument list for the WebAssembly build.
// qFactor is the JPEG quality factor used by Ghostscript: lower is better quality, higher is smaller.
export function buildArgs({ dpi = 96, qFactor = 0.4 } = {}) {
  if (!Number.isInteger(dpi) || dpi < MIN_DPI || dpi > MAX_DPI) {
    throw new RangeError(`dpi must be an integer from ${MIN_DPI} to ${MAX_DPI}`);
  }
  if (typeof qFactor !== 'number' || !(qFactor >= 0.01 && qFactor <= 1)) {
    throw new RangeError('qFactor must be a number from 0.01 to 1');
  }
  const qPct = Math.round(qFactor * 100);
  return [
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.7',
    '-dNOPAUSE',
    '-dBATCH',
    '-sOutputFile=output.pdf',
    '-dDownsampleColorImages=true',
    '-dDownsampleGrayImages=true',
    '-dColorImageDownsampleType=/Bicubic',
    '-dGrayImageDownsampleType=/Bicubic',
    `-dColorImageResolution=${dpi}`,
    `-dGrayImageResolution=${dpi}`,
    '-dPassThroughJPEGImages=false',
    '-dAutoFilterColorImages=false',
    '-dAutoFilterGrayImages=false',
    '-dColorImageFilter=/DCTEncode',
    '-dGrayImageFilter=/DCTEncode',
    `-dColorImageQFactorPct=${qPct}`,
    `-dGrayImageQFactorPct=${qPct}`,
    'input.pdf',
  ];
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // "%PDF"

function startsWithPdfMagic(bytes) {
  return bytes.length >= 4 && PDF_MAGIC.every((b, i) => bytes[i] === b);
}

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new TypeError('input must be a Uint8Array or ArrayBuffer');
}

// Resolves with the compressed PDF as a Uint8Array. Rejects if the input is not a PDF or compression fails.
// options.wasmBinary (optional) is the gpdf.wasm bytes, for when the caller has already fetched them.
export async function squeezePdf(input, options = {}) {
  const bytes = toBytes(input);
  if (!startsWithPdfMagic(bytes)) {
    throw new TypeError('input is not a PDF (missing %PDF header)');
  }
  const args = buildArgs(options);
  const logs = [];
  let output = null;
  const mod = {
    arguments: args,
    ...(options.wasmBinary ? { wasmBinary: options.wasmBinary } : {}),
    print: (text) => logs.push(String(text)),
    printErr: (text) => logs.push(String(text)),
    preRun: [() => mod.FS.writeFile('input.pdf', bytes)],
    postRun: [() => {
      try {
        output = mod.FS.readFile('output.pdf').slice();
      } catch {
        output = null;
      }
    }],
  };
  try {
    await createGhostPDF(mod);
  } catch (err) {
    throw new Error(`compression failed: ${err.message || err}`, { cause: err });
  }
  // Ghostscript reports a failed run with this message, even when it still writes a blank PDF.
  const failed = logs.some((line) => line.includes('interpreter exited with error code'));
  if (failed || !output || !startsWithPdfMagic(output)) {
    throw new Error(`compression failed: ${logs.slice(-5).join(' | ') || 'no output produced'}`);
  }
  return output;
}
