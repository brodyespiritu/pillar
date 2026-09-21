// The three videos faststart.test.mjs reads, made from nothing: a plain animated test card drawn
// frame by frame (no footage, nobody's pictures), then finished by macOS's own avconvert — the same
// exporter cameras and screen recorders use, so the files are laid out the way real uploads are.
//
//   cd tests/fixtures && swift make-clips.swift
//
//   clip.mp4   MP4, index first   (what a phone that optimizes for sharing sends)
//   slow.mp4   MP4, index last    (--disableFastStart: what most cameras and recorders write)
//   slow.mov   MOV, index last
//
// All three are 400×258, 16 seconds, H.264; the suite checks those facts, so keep them.
import AVFoundation
import CoreGraphics
import Foundation

let W = 400, H = 258, FPS: Int32 = 30, SECONDS = 16
let FRAMES = Int(FPS) * SECONDS
let source = FileManager.default.temporaryDirectory.appendingPathComponent("test-card-\(getpid()).mov")
try? FileManager.default.removeItem(at: source)

let writer = try AVAssetWriter(outputURL: source, fileType: .mov)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
  AVVideoCodecKey: AVVideoCodecType.h264,
  AVVideoWidthKey: W,
  AVVideoHeightKey: H,
  AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 250_000],
])
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
  kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
  kCVPixelBufferWidthKey as String: W,
  kCVPixelBufferHeightKey as String: H,
])
writer.add(input)
guard writer.startWriting() else { fatalError("can't start writing: \(String(describing: writer.error))") }
writer.startSession(atSourceTime: .zero)

/// hue, saturation, value (0…1) → colour
func hsv(_ h: Double, _ s: Double, _ v: Double) -> CGColor {
  let h6 = (h - floor(h)) * 6, f = h6 - floor(h6)
  let p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s)
  let (r, g, b) = [(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)][Int(h6) % 6]
  return CGColor(red: r, green: g, blue: b, alpha: 1)
}

for frame in 0..<FRAMES {
  while !input.isReadyForMoreMediaData { usleep(2_000) }
  var made: CVPixelBuffer?
  CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &made)
  guard let buffer = made else { fatalError("no pixel buffer for frame \(frame)") }
  CVPixelBufferLockBaseAddress(buffer, [])
  let cg = CGContext(data: CVPixelBufferGetBaseAddress(buffer), width: W, height: H, bitsPerComponent: 8,
                     bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: CGColorSpaceCreateDeviceRGB(),
                     bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue)!
  let t = Double(frame) / Double(FPS)

  // a slow wash through the hues
  cg.setFillColor(hsv(t / Double(SECONDS), 0.35, 0.9))
  cg.fill(CGRect(x: 0, y: 0, width: W, height: H))
  // colour bars drifting right
  for bar in 0..<8 {
    let x = (Double(bar) * 57 + t * 40).truncatingRemainder(dividingBy: 456) - 56
    cg.setFillColor(hsv(Double(bar) / 8, 0.8, 0.95))
    cg.fill(CGRect(x: x, y: 110, width: 50, height: 120))
  }
  // a checker strip scrolling left, for fine detail
  let shift = Int(t * 24) % 16
  cg.setFillColor(CGColor(gray: 0.15, alpha: 1))
  for col in 0..<54 {
    for row in 0..<3 where (col + row) % 2 == 0 {
      cg.fill(CGRect(x: col * 8 - shift, y: 70 + row * 8, width: 8, height: 8))
    }
  }
  // a ball bouncing about
  cg.setFillColor(CGColor(gray: 1, alpha: 1))
  cg.fillEllipse(in: CGRect(x: 20 + 340 * abs(sin(t * 0.9)), y: 130 + 80 * abs(cos(t * 1.7)), width: 36, height: 36))
  // and how far along it is
  cg.setFillColor(CGColor(gray: 0.1, alpha: 1))
  cg.fill(CGRect(x: 0, y: 0, width: Double(W) * Double(frame + 1) / Double(FRAMES), height: 10))

  CVPixelBufferUnlockBaseAddress(buffer, [])
  guard adaptor.append(buffer, withPresentationTime: CMTime(value: CMTimeValue(frame), timescale: FPS)) else {
    fatalError("frame \(frame) refused: \(String(describing: writer.error))")
  }
}
input.markAsFinished()
let written = DispatchSemaphore(value: 0)
writer.finishWriting { written.signal() }
written.wait()
guard writer.status == .completed else { fatalError("writing failed: \(String(describing: writer.error))") }

// finished the way real uploads arrive
for (preset, name, indexLast) in [("PresetMediumQuality", "clip.mp4", false),
                                  ("PresetMediumQuality", "slow.mp4", true),
                                  ("Preset1280x720", "slow.mov", true)] {
  let avconvert = Process()
  avconvert.executableURL = URL(fileURLWithPath: "/usr/bin/avconvert")
  avconvert.arguments = ["--preset", preset, "--source", source.path, "--output", name, "--replace"]
    + (indexLast ? ["--disableFastStart"] : [])
  try avconvert.run()
  avconvert.waitUntilExit()
  guard avconvert.terminationStatus == 0 else { fatalError("avconvert couldn't make \(name)") }
  print("made \(name)")
}
try? FileManager.default.removeItem(at: source)
