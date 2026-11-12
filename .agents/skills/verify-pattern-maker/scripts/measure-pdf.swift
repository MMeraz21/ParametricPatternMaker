// macOS only: an independent second opinion on a PDF's true scale, using PDFKit as the renderer.
// The scale proof that runs everywhere is the vitest case in src/core/posterPdf.test.ts; journeys skip this off macOS.
//
//   swift measure-pdf.swift <file.pdf> <pageIndex> <dpi> <xMm> <yMm>
//
// Renders the page, then from (xMm, yMm) inside a stroked square walks left, right, up and down to the lines around it,
// and prints the square's centre-to-centre width and height in mm as JSON.
import AppKit
import Foundation
import PDFKit

let args = CommandLine.arguments
guard args.count == 6, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])), let pageIndex = Int(args[2]), let dpi = Double(args[3]),
  let xMm = Double(args[4]), let yMm = Double(args[5]), let page = doc.page(at: pageIndex)
else {
  FileHandle.standardError.write("usage: measure-pdf.swift <file.pdf> <pageIndex> <dpi> <xMm> <yMm>\n".data(using: .utf8)!)
  exit(2)
}
let box = page.bounds(for: .mediaBox)
let width = Int((box.width * dpi / 72).rounded())
let height = Int((box.height * dpi / 72).rounded())
let rep = NSBitmapImageRep(
  bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
  colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
let context = NSGraphicsContext(bitmapImageRep: rep)!
let cg = context.cgContext
cg.setFillColor(NSColor.white.cgColor)
cg.fill(CGRect(x: 0, y: 0, width: width, height: height))
cg.scaleBy(x: CGFloat(dpi / 72), y: CGFloat(dpi / 72))
page.draw(with: .mediaBox, to: cg)
context.flushGraphics()

let pxPerMm = dpi / 25.4
func dark(_ x: Int, _ y: Int) -> Bool {
  guard x >= 0, y >= 0, x < width, y < height, let color = rep.colorAt(x: x, y: y) else { return false }
  return color.redComponent < 0.5
}
/// From `start`, the first dark run along `step`, as (first, last) pixel.
func line(from start: (Int, Int), step: (Int, Int)) -> (Int, Int)? {
  var (x, y) = start
  var steps = 0
  while !dark(x, y) {
    x += step.0
    y += step.1
    steps += 1
    if steps > 4000 { return nil }
  }
  let first = step.0 != 0 ? x : y
  while dark(x + step.0, y + step.1) {
    x += step.0
    y += step.1
  }
  return (first, step.0 != 0 ? x : y)
}
let start = (Int((xMm * pxPerMm).rounded()), Int((yMm * pxPerMm).rounded()))
guard let left = line(from: start, step: (-1, 0)), let right = line(from: start, step: (1, 0)), let top = line(from: start, step: (0, -1)),
  let bottom = line(from: start, step: (0, 1))
else {
  print("{\"error\":\"no square around the point\"}")
  exit(1)
}
let centre = { (run: (Int, Int)) -> Double in Double(run.0 + run.1) / 2 }
let squareWidth = (centre(right) - centre(left)) / pxPerMm
let squareHeight = (centre(bottom) - centre(top)) / pxPerMm
print("{\"width\":\(squareWidth),\"height\":\(squareHeight),\"mmPerPixel\":\(1 / pxPerMm)}")
