import AppKit
import CoreImage
import CoreVideo
import Foundation
import Vision

guard CommandLine.arguments.count == 3 else {
  fputs("Usage: remove-person-background <input> <output>\n", stderr)
  exit(64)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])

guard let sourceImage = CIImage(contentsOf: inputURL) else {
  fputs("Unable to read input image\n", stderr)
  exit(65)
}

let handler = VNImageRequestHandler(url: inputURL, options: [:])
let request = VNGenerateForegroundInstanceMaskRequest()
do {
  try handler.perform([request])
} catch {
  fputs("Vision segmentation failed: \(error)\n", stderr)
  exit(66)
}

guard let observation = request.results?.first else {
  fputs("Vision did not find a foreground person\n", stderr)
  exit(67)
}

let maskBuffer: CVPixelBuffer
do {
  maskBuffer = try observation.generateScaledMaskForImage(
    forInstances: observation.allInstances,
    from: handler
  )
} catch {
  fputs("Vision could not scale the foreground mask: \(error)\n", stderr)
  exit(67)
}

let scaledMask = CIImage(cvPixelBuffer: maskBuffer)
  // Soften the one-pixel instance-mask edge without changing the subject.
  .applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: 0.45])
  .cropped(to: sourceImage.extent)

let transparent = CIImage(color: .clear).cropped(to: sourceImage.extent)
let cutout = sourceImage
  .applyingFilter(
    "CIBlendWithMask",
    parameters: [
      kCIInputBackgroundImageKey: transparent,
      kCIInputMaskImageKey: scaledMask,
    ]
  )
  .cropped(to: sourceImage.extent)

let context = CIContext(options: [.useSoftwareRenderer: false])
let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!

do {
  try context.writePNGRepresentation(
    of: cutout,
    to: outputURL,
    format: .RGBA8,
    colorSpace: colorSpace
  )
} catch {
  fputs("Unable to write PNG: \(error)\n", stderr)
  exit(68)
}
