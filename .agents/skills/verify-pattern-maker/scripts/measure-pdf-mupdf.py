"""Measure the test square on page A1 of an exported PDF with MuPDF, on any OS.

Setup once, outside the repo:  python3 -m venv <dir> && <dir>/bin/pip install pymupdf numpy
Run:  <dir>/bin/python measure-pdf-mupdf.py <file.pdf> <side mm: 50 or 50.8>
Prints the square from MuPDF's vector interpreter (every matrix applied) and from a 1200 dpi raster
(stroke centre to stroke centre), checks the text is upright, and exits 1 if anything is off by more than 0.1 mm.
"""
import sys

import fitz
import numpy as np

MM = 72 / 25.4
path, want = sys.argv[1], float(sys.argv[2])
page = fitz.open(path)[0]
is_square = lambda d: (
    d.get('width') and abs(d['width'] / MM - 0.35) < 1e-3
    and ([i[0] for i in d['items']] == ['re'] or (d.get('closePath') and all(i[0] == 'l' for i in d['items'])))
    and abs(d['rect'].width - d['rect'].height) < 1 and page.rect.contains(d['rect'])
)
squares = [d['rect'] for d in page.get_drawings() if is_square(d)]
if len(squares) != 1:
    sys.exit(f'expected one test square on page 1, found {len(squares)}')
r = squares[0]
vector = (r.width / MM, r.height / MM)

dpi = 1200
pix = page.get_pixmap(matrix=fitz.Matrix(dpi / 72, dpi / 72), clip=fitz.Rect(r.x0 - 10, r.y0 - 10, r.x1 + 10, r.y1 + 10), colorspace=fitz.csGRAY)
ink = 255 - np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width).astype(float)


def span(profile):
    idx = np.where(profile > profile.max() * 0.5)[0]
    runs = np.split(idx, np.where(np.diff(idx) > 1)[0] + 1)
    return (np.average(runs[-1], weights=profile[runs[-1]]) - np.average(runs[0], weights=profile[runs[0]])) * 25.4 / dpi


raster = (span(ink.sum(axis=0)), span(ink.sum(axis=1)))
upright = any('measure' in s['text'] and tuple(line['dir']) == (1.0, 0.0) for b in page.get_text('dict')['blocks'] for line in b.get('lines', []) for s in line['spans'])
print(f'MuPDF {fitz.VersionFitz} (PyMuPDF {fitz.VersionBind}): page {page.rect.width / MM:.3f} x {page.rect.height / MM:.3f} mm')
print(f'  vector square {vector[0]:.6f} x {vector[1]:.6f} mm, raster {dpi} dpi {raster[0]:.3f} x {raster[1]:.3f} mm, want {want}; text upright: {upright}')
ok = upright and all(abs(v - want) <= 0.1 for v in (*vector, *raster))
sys.exit(0 if ok else 1)
