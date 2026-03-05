import Vision
import AppKit

guard CommandLine.arguments.count > 1 else {
    fputs("Usage: vision-ocr <image-path>\n", stderr)
    exit(1)
}

let imagePath = CommandLine.arguments[1]
let url = URL(fileURLWithPath: imagePath)

guard let image = NSImage(contentsOf: url),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fputs("Error: Could not load image at \(imagePath)\n", stderr)
    exit(1)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true

let handler = VNImageRequestHandler(cgImage: cgImage)

do {
    try handler.perform([request])
} catch {
    fputs("Error: OCR failed — \(error.localizedDescription)\n", stderr)
    exit(1)
}

let results = request.results ?? []
for observation in results {
    if let candidate = observation.topCandidates(1).first {
        print(candidate.string)
    }
}
