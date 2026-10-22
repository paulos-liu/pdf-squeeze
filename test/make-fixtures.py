# Generates the test fixtures. Run: python3 test/make-fixtures.py
import os, random
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'fixtures')
os.makedirs(OUT, exist_ok=True)

# 1. Scanned-style page: one 8.5x11in image at 300 ppi, saved as a PDF (no text).
random.seed(1)
img = Image.new('RGB', (2550, 3300), 'white')
d = ImageDraw.Draw(img)
for y in range(0, 3300, 6):
    d.line([(0, y), (2550, y)], fill=(200 + random.randint(0, 40),) * 3)
for i in range(60):
    x, y = random.randint(0, 2400), random.randint(0, 3200)
    d.text((x, y), 'Lorem ipsum dolor sit amet', fill=(20, 20, 20))
img.save(os.path.join(OUT, 'scan-300dpi.pdf'), 'PDF', resolution=300.0)

# 2. Two-page text document using non-embedded base-14 fonts (Helvetica, Times-Roman).
def pdf_from_objects(objects):
    out = b'%PDF-1.4\n'
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f'{i} 0 obj\n'.encode() + body + b'\nendobj\n'
    xref = len(out)
    out += f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode()
    for off in offsets:
        out += f'{off:010d} 00000 n \n'.encode()
    out += f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    return out

def stream(text):
    return b'<< /Length %d >>\nstream\n' % len(text) + text + b'\nendstream'

page1 = b'BT /F1 18 Tf 72 720 Td (Helvetica body text, page one.) Tj ET\nBT /F2 12 Tf 72 690 Td (Times-Roman line on page one.) Tj ET'
page2 = b'BT /F1 18 Tf 72 720 Td (Helvetica body text, page two.) Tj ET\nBT /F2 12 Tf 72 690 Td (Times-Roman line on page two.) Tj ET'
objs = [
    b'<< /Type /Catalog /Pages 2 0 R >>',
    b'<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 6 0 R /F2 7 0 R >> >> >>',
    stream(page1),
    b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 8 0 R /Resources << /Font << /F1 6 0 R /F2 7 0 R >> >> >>',
    b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    b'<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>',
    stream(page2),
]
data = pdf_from_objects(objs)
with open(os.path.join(OUT, 'text-base14.pdf'), 'wb') as f:
    f.write(data)

# 3. The same document with its cross-reference table cut off. Ghostscript repairs it.
with open(os.path.join(OUT, 'text-damaged.pdf'), 'wb') as f:
    f.write(data[:data.index(b'xref\n')])
print('fixtures written to', OUT)
