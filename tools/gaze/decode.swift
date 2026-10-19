import AVFoundation
import AppKit
// every frame of the video as JPEG: frames.swift <video> <outdir> <maxWidth>
let a = CommandLine.arguments
let asset = AVURLAsset(url: URL(fileURLWithPath: a[1]))
let reader = try! AVAssetReader(asset: asset)
let tr = asset.tracks(withMediaType: .video).first!
let out = AVAssetReaderTrackOutput(track: tr, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
reader.add(out); reader.startReading()
let maxW = CGFloat(Double(a[3]) ?? 1920)
var i = 0
let ctx = CIContext()
while let sb = out.copyNextSampleBuffer(), let pb = CMSampleBufferGetImageBuffer(sb) {
  var ci = CIImage(cvPixelBuffer: pb)
  let s = min(1, maxW / ci.extent.width)
  if s < 1 { ci = ci.transformed(by: CGAffineTransform(scaleX: s, y: s)) }
  let cg = ctx.createCGImage(ci, from: ci.extent)!
  let rep = NSBitmapImageRep(cgImage: cg)
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(a[2])/\(String(format: "%03d", i)).png"))
  i += 1
}
print("frames", i)
