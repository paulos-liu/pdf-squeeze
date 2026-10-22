import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { squeezePdf, buildArgs } from '../src/squeeze.mjs';

const fixture = (name) => new Uint8Array(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const hasTool = (name) => {
  try {
    execFileSync('which', [name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const skipUnless = (tool) => (hasTool(tool) ? false : `${tool} (poppler) is not installed`);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-squeeze-'));
const writeOut = (name, bytes) => {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, bytes);
  return file;
};
const text = (file) => execFileSync('pdftotext', [file, '-'], { encoding: 'utf8' });

test('buildArgs uses the site defaults and passes the quality as a percentage', () => {
  const args = buildArgs();
  assert.ok(args.includes('-dColorImageResolution=96'));
  assert.ok(args.includes('-dColorImageQFactorPct=40'));
  assert.equal(args.at(-1), 'input.pdf');
});

test('buildArgs rejects out-of-range options', () => {
  assert.throws(() => buildArgs({ dpi: 0 }), RangeError);
  assert.throws(() => buildArgs({ dpi: 96.5 }), RangeError);
  assert.throws(() => buildArgs({ qFactor: 0 }), RangeError);
  assert.throws(() => buildArgs({ qFactor: 1.5 }), RangeError);
});

test('rejects input that is not a PDF', async () => {
  await assert.rejects(squeezePdf(new TextEncoder().encode('hello')), /not a PDF/);
});

test('scanned page: output is a PDF and much smaller than the input', async () => {
  const input = fixture('scan-300dpi.pdf');
  const out = await squeezePdf(input, { dpi: 96, qFactor: 0.4 });
  assert.equal(new TextDecoder().decode(out.slice(0, 4)), '%PDF');
  assert.ok(out.length < input.length / 5, `output ${out.length} bytes vs input ${input.length}`);
});

test('scanned page: image is downsampled to the requested dpi', { skip: skipUnless('pdfimages') }, async () => {
  for (const dpi of [96, 150]) {
    const file = writeOut(`scan-${dpi}.pdf`, await squeezePdf(fixture('scan-300dpi.pdf'), { dpi }));
    const row = execFileSync('pdfimages', ['-list', file], { encoding: 'utf8' }).trim().split('\n').at(-1).trim().split(/\s+/);
    assert.equal(Number(row[3]), Math.round((2550 * dpi) / 300), `width at ${dpi} dpi`);
  }
});

test('lower quality factor gives a larger file', async () => {
  const input = fixture('scan-300dpi.pdf');
  const small = (await squeezePdf(input, { qFactor: 0.76 })).length;
  const medium = (await squeezePdf(input, { qFactor: 0.4 })).length;
  const large = (await squeezePdf(input, { qFactor: 0.15 })).length;
  assert.ok(small < medium && medium < large, `sizes ${small} < ${medium} < ${large}`);
});

test('text pages: page count and text are kept, including non-embedded base-14 fonts', { skip: skipUnless('pdfinfo') || skipUnless('pdftotext') }, async () => {
  const file = writeOut('text.pdf', await squeezePdf(fixture('text-base14.pdf')));
  assert.equal(execFileSync('pdfinfo', [file], { encoding: 'utf8' }).match(/^Pages:\s+(\d+)/m)[1], '2');
  const extracted = text(file);
  assert.match(extracted, /Helvetica body text, page one\./);
  assert.match(extracted, /Times-Roman line on page two\./);
});

test('accepts the wasm bytes from the caller instead of loading them itself', async () => {
  const wasmBinary = new Uint8Array(fs.readFileSync(new URL('../dist/gpdf.wasm', import.meta.url)));
  const out = await squeezePdf(fixture('text-base14.pdf'), { wasmBinary });
  assert.equal(new TextDecoder().decode(out.slice(0, 4)), '%PDF');
});

test('the module can be run more than once in one process', async () => {
  const a = await squeezePdf(fixture('text-base14.pdf'));
  const b = await squeezePdf(fixture('text-base14.pdf'));
  assert.ok(a.length > 0 && b.length > 0);
});

test('a damaged PDF that Ghostscript can repair still compresses, keeping its text', { skip: skipUnless('pdftotext') }, async () => {
  const file = writeOut('damaged.pdf', await squeezePdf(fixture('text-damaged.pdf')));
  assert.match(text(file), /Helvetica body text, page two\./);
});

test('a corrupt PDF rejects with a compression error', async () => {
  const corrupt = new TextEncoder().encode('%PDF-1.4\n%garbage that is not a document\n');
  await assert.rejects(squeezePdf(corrupt), /compression failed/);
});
