#!/usr/bin/env swift
// Renders the SF Symbol "bus.fill" into the app's icon assets.
// Run from the repo root or apps/mobile/:  swift apps/mobile/scripts/generate-icon.swift

import AppKit
import CoreGraphics
import Foundation

// MARK: - Config

let assetsDir = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()        // scripts/
    .deletingLastPathComponent()        // apps/mobile/
    .appendingPathComponent("assets/images")

let brandColor = NSColor(srgbRed: 0x1E / 255.0, green: 0x88 / 255.0, blue: 0xE5 / 255.0, alpha: 1.0)
let glyphColor = NSColor.white
let symbolName = "bus.fill"

// MARK: - Helpers

func loadSymbol() -> NSImage {
    let config = NSImage.SymbolConfiguration(pointSize: 800, weight: .semibold)
        .applying(.preferringMonochrome())
    guard
        let base = NSImage(systemSymbolName: symbolName, accessibilityDescription: nil),
        let configured = base.withSymbolConfiguration(config)
    else {
        FileHandle.standardError.write("Failed to load SF Symbol \(symbolName).\n".data(using: .utf8)!)
        exit(1)
    }
    return configured
}

func render(size: Int, background: NSColor?, glyphScale: CGFloat) -> Data {
    let pixels = CGFloat(size)
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: size,
        pixelsHigh: size,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 32
    )!

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

    let canvas = NSRect(x: 0, y: 0, width: pixels, height: pixels)
    if let bg = background {
        bg.setFill()
        canvas.fill()
    } else {
        NSColor.clear.setFill()
        canvas.fill(using: .copy)
    }

    let symbol = loadSymbol()
    let glyphSize = symbol.size
    let target = pixels * glyphScale
    let scale = min(target / glyphSize.width, target / glyphSize.height)
    let drawSize = NSSize(width: glyphSize.width * scale, height: glyphSize.height * scale)
    let drawRect = NSRect(
        x: (pixels - drawSize.width) / 2,
        y: (pixels - drawSize.height) / 2,
        width: drawSize.width,
        height: drawSize.height
    )

    // Tint the symbol white by drawing it as a mask through the glyph color.
    if let cg = NSGraphicsContext.current?.cgContext, let symbolCG = symbol.cgImage(forProposedRect: nil, context: nil, hints: nil) {
        cg.saveGState()
        cg.clip(to: drawRect, mask: symbolCG)
        glyphColor.setFill()
        cg.fill(drawRect)
        cg.restoreGState()
    }

    NSGraphicsContext.restoreGraphicsState()

    guard let png = rep.representation(using: .png, properties: [:]) else {
        FileHandle.standardError.write("Failed to encode PNG.\n".data(using: .utf8)!)
        exit(1)
    }
    return png
}

func write(_ data: Data, to name: String) {
    let url = assetsDir.appendingPathComponent(name)
    do {
        try data.write(to: url, options: .atomic)
        print("wrote \(url.path) (\(data.count) bytes)")
    } catch {
        FileHandle.standardError.write("Failed to write \(name): \(error)\n".data(using: .utf8)!)
        exit(1)
    }
}

// MARK: - Generate

write(render(size: 1024, background: brandColor, glyphScale: 0.62), to: "icon.png")
write(render(size: 1024, background: nil,         glyphScale: 0.55), to: "adaptive-icon.png")
write(render(size: 1024, background: nil,         glyphScale: 0.55), to: "splash-icon.png")
write(render(size: 48,   background: brandColor, glyphScale: 0.70), to: "favicon.png")
