# pdf-squeeze

Shrink PDFs in the browser or in Node.js. Images are downsampled and re-encoded as JPEG, and fonts are kept or referenced, so the page count and text survive. The compressor is Ghostscript's `pdfwrite` (GhostPDL 10.09) compiled to WebAssembly.

License: AGPL-3.0-or-later. See [LICENSE](LICENSE) and [NOTICE](NOTICE). The WebAssembly build includes GhostPDL, so the corresponding source is the pinned GhostPDL commit plus `patches/` and `scripts/`.

## Usage

```js
import { squeezePdf } from 'pdf-squeeze';

const input = new Uint8Array(await file.arrayBuffer());
const smaller = await squeezePdf(input, { dpi: 96, qFactor: 0.4 });
```

Options:

| Option    | Default | Meaning |
|-----------|---------|---------|
| `dpi`     | `96`    | Maximum resolution for color and gray images, from 36 to 600. Images above this are downsampled. |
| `qFactor` | `0.4`   | JPEG quality factor, from 0.01 to 1. Lower is better quality and a larger file. Higher is smaller and lower quality. |

The function resolves with a `Uint8Array` and rejects if the input is not a PDF or compression fails.

The optional `wasmBinary` option takes the bytes of `dist/gpdf.wasm`. Pass it when your page has already fetched the file, for example to show download progress. Otherwise the module loads the file itself.

### In a browser

Run it in a Web Worker so the page stays responsive. The worker in `src/worker.mjs` takes `{ id, bytes, options }` and replies with `{ id, ok, pdf }` or `{ id, ok: false, error }`:

```js
const worker = new Worker(new URL('pdf-squeeze/worker', import.meta.url), { type: 'module' });
```

## What it does and does not do

- Downsamples color and gray images to `dpi`, and re-encodes them as JPEG with `qFactor`.
- Keeps the page count and text. Fonts are not re-encoded.
- Uses the bundled base-14 fonts (Times, Helvetica, Courier, Symbol, ZapfDingbats) when a PDF refers to them without embedding them. Other non-embedded fonts are substituted, and CJK text is not supported because the CMaps and CID fonts are left out.
- Output differs from older Ghostscript releases. Sizes for text-heavy PDFs can be larger than Ghostscript 9.26 produces.

## Tests

```sh
npm test
```

The tests use synthetic fixtures in `test/fixtures` (generate them with `python3 test/make-fixtures.py`). The downsampling and text checks need poppler (`pdfimages`, `pdfinfo`, `pdftotext`) and are skipped without it.

## Rebuilding the WebAssembly

`scripts/build.sh` clones GhostPDL at the pinned commit, applies `patches/ghostpdl-qfactor.patch`, and builds `dist/gpdf.mjs` and `dist/gpdf.wasm`. It needs git, make, autoconf, automake, libtool, node, and a host C compiler (set `HOST_CC`). It downloads the Emscripten SDK. The build used Emscripten 6.0.13 (`EMSDK_VERSION` defaults to `latest`). `dist/BUILD-INFO.txt` records the versions and hashes.

## Changes from upstream GhostPDL

- Adds `ColorImageQFactorPct` and `GrayImageQFactorPct`. These set the JPEG quality for `ColorImageDict` and `GrayImageDict` from the command line, so the page no longer needs a PostScript `-c` argument.
- The PDF resource set is trimmed to the base-14 fonts, the font map, and the CID font map.
- The build exports a `createGhostPDF` module factory with `FS` available, so it runs in browsers and Node.
