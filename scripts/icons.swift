import AppKit
import Foundation

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let assets = root.appendingPathComponent("assets")
try FileManager.default.createDirectory(at: assets, withIntermediateDirectories: true)

func render(size: Int, tray: Bool = false) throws -> Data {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    let context = NSGraphicsContext.current!.cgContext
    context.scaleBy(x: CGFloat(size) / 1024, y: CGFloat(size) / 1024)
    if !tray {
        let tile = NSBezierPath(roundedRect: NSRect(x: 48, y: 48, width: 928, height: 928), xRadius: 218, yRadius: 218)
        NSGradient(colors: [NSColor(srgbRed: 0.64, green: 0.48, blue: 0.92, alpha: 1), NSColor(srgbRed: 0.50, green: 0.33, blue: 0.87, alpha: 1), NSColor(srgbRed: 0.27, green: 0.20, blue: 0.42, alpha: 1)])!.draw(in: tile, angle: -65)
    }
    // One open cloud contour: airy, legible at small sizes, with a conversation tail.
    // Coordinates are shared with the inline sidebar mark (SVG flips the Y axis).
    let mark = NSBezierPath()
    mark.move(to: NSPoint(x: 592, y: 350))
    mark.line(to: NSPoint(x: 347, y: 350))
    mark.curve(to: NSPoint(x: 217, y: 478), controlPoint1: NSPoint(x: 272, y: 350), controlPoint2: NSPoint(x: 217, y: 407))
    mark.curve(to: NSPoint(x: 327, y: 605), controlPoint1: NSPoint(x: 217, y: 544), controlPoint2: NSPoint(x: 264, y: 597))
    mark.curve(to: NSPoint(x: 499, y: 740), controlPoint1: NSPoint(x: 345, y: 687), controlPoint2: NSPoint(x: 414, y: 740))
    mark.curve(to: NSPoint(x: 671, y: 609), controlPoint1: NSPoint(x: 584, y: 740), controlPoint2: NSPoint(x: 654, y: 687))
    mark.curve(to: NSPoint(x: 807, y: 471), controlPoint1: NSPoint(x: 747, y: 604), controlPoint2: NSPoint(x: 807, y: 546))
    mark.curve(to: NSPoint(x: 695, y: 350), controlPoint1: NSPoint(x: 807, y: 404), controlPoint2: NSPoint(x: 761, y: 350))
    mark.line(to: NSPoint(x: 633, y: 290))
    mark.lineWidth = tray ? 76 : 58
    mark.lineCapStyle = .round; mark.lineJoinStyle = .round
    (tray ? NSColor.black : NSColor(srgbRed: 0.98, green: 0.97, blue: 1, alpha: 1)).setStroke()
    mark.stroke()
    NSGraphicsContext.restoreGraphicsState()
    return bitmap.representation(using: .png, properties: [:])!
}
try render(size: 1024).write(to: assets.appendingPathComponent("icon.png"))
try render(size: 22, tray: true).write(to: assets.appendingPathComponent("trayTemplate.png"))
try render(size: 44, tray: true).write(to: assets.appendingPathComponent("trayTemplate@2x.png"))
let iconset = assets.appendingPathComponent("icon.iconset")
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
for base in [16, 32, 128, 256, 512] {
    try render(size: base).write(to: iconset.appendingPathComponent("icon_\(base)x\(base).png"))
    try render(size: base * 2).write(to: iconset.appendingPathComponent("icon_\(base)x\(base)@2x.png"))
}
let process = Process(); process.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
process.arguments = ["-c", "icns", iconset.path, "-o", assets.appendingPathComponent("icon.icns").path]
try process.run(); process.waitUntilExit()
guard process.terminationStatus == 0 else { fatalError("iconutil failed") }
try FileManager.default.removeItem(at: iconset)

let background = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1200, pixelsHigh: 840, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: background)
NSGraphicsContext.current!.cgContext.scaleBy(x: 2, y: 2)
NSColor(srgbRed: 0.965, green: 0.957, blue: 0.988, alpha: 1).setFill()
NSRect(x: 0, y: 0, width: 600, height: 420).fill()
func text(_ value: String, y: CGFloat, font: NSFont, color: NSColor) {
    let paragraph = NSMutableParagraphStyle(); paragraph.alignment = .center
    (value as NSString).draw(in: NSRect(x: 30, y: y, width: 540, height: 40), withAttributes: [.font: font, .foregroundColor: color, .paragraphStyle: paragraph])
}
text("Обла", y: 323, font: .systemFont(ofSize: 28, weight: .bold), color: NSColor(srgbRed: 0.18, green: 0.12, blue: 0.30, alpha: 1))
let captionColor = NSColor(srgbRed: 0.48, green: 0.44, blue: 0.55, alpha: 1)
text("Перетащите «Обла» в «Программы»", y: 291, font: .systemFont(ofSize: 14), color: captionColor)
text("→", y: 201, font: .systemFont(ofSize: 36, weight: .light), color: NSColor(srgbRed: 0.56, green: 0.41, blue: 0.78, alpha: 1))
text("INTEL + APPLE SILICON  ·  macOS 13+", y: 56, font: .systemFont(ofSize: 10, weight: .medium), color: captionColor)
text("Все разговоры — в одном месте", y: 30, font: .systemFont(ofSize: 11), color: captionColor)
NSGraphicsContext.restoreGraphicsState()
background.size = NSSize(width: 600, height: 420)
try background.representation(using: .png, properties: [:])!.write(to: assets.appendingPathComponent("dmg-background.png"))
print("Generated app and menu bar icons")
