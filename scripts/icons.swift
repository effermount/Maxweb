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
        NSGradient(starting: NSColor(srgbRed: 0.22, green: 0.28, blue: 0.62, alpha: 1), ending: NSColor(srgbRed: 0.07, green: 0.10, blue: 0.24, alpha: 1))!.draw(in: tile, angle: -70)
    }
    // A geometric M, without speech bubbles or dots resembling another messenger.
    let mark = NSBezierPath()
    let points = [NSPoint(x: 236, y: 300), NSPoint(x: 236, y: 724), NSPoint(x: 328, y: 724), NSPoint(x: 512, y: 486), NSPoint(x: 696, y: 724), NSPoint(x: 788, y: 724), NSPoint(x: 788, y: 300), NSPoint(x: 674, y: 300), NSPoint(x: 674, y: 526), NSPoint(x: 512, y: 326), NSPoint(x: 350, y: 526), NSPoint(x: 350, y: 300)]
    mark.move(to: points[0]); for point in points.dropFirst() { mark.line(to: point) }; mark.close()
    if tray {
        NSColor.black.setFill(); mark.fill()
    } else {
        NSColor.white.setFill(); mark.fill()
        let accent = NSBezierPath(roundedRect: NSRect(x: 674, y: 214, width: 114, height: 36), xRadius: 18, yRadius: 18)
        NSColor(srgbRed: 0.35, green: 0.88, blue: 0.84, alpha: 1).setFill(); accent.fill()
    }
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
text("Maxweb", y: 323, font: .systemFont(ofSize: 28, weight: .bold), color: NSColor(srgbRed: 0.18, green: 0.12, blue: 0.30, alpha: 1))
let captionColor = NSColor(srgbRed: 0.48, green: 0.44, blue: 0.55, alpha: 1)
text("Перетащите Maxweb в «Программы»", y: 291, font: .systemFont(ofSize: 14), color: captionColor)
text("→", y: 201, font: .systemFont(ofSize: 36, weight: .light), color: NSColor(srgbRed: 0.56, green: 0.41, blue: 0.78, alpha: 1))
text("APPLE SILICON  ·  macOS 13+", y: 56, font: .systemFont(ofSize: 10, weight: .medium), color: captionColor)
text("После установки откройте Maxweb и войдите в MAX", y: 30, font: .systemFont(ofSize: 11), color: captionColor)
NSGraphicsContext.restoreGraphicsState()
background.size = NSSize(width: 600, height: 420)
try background.representation(using: .png, properties: [:])!.write(to: assets.appendingPathComponent("dmg-background.png"))
print("Generated app and menu bar icons")
