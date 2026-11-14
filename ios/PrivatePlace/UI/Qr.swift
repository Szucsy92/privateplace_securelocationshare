import SwiftUI
import AVFoundation

/// A webes RoundedQRCode portja: lekerekített adatmodulok és sarokszemek; hibajavítás: M.
struct RoundedQr: View {
    var value: String; var color: Color
    var body: some View {
        let cells = QrMatrix.make(value)
        Canvas { ctx, size in
            let n = cells.count; guard n > 0 else { return }
            let u = size.width / CGFloat(n)
            func inFinder(_ x: Int, _ y: Int) -> Bool { (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7) }
            var path = Path()
            for y in 0..<n { for x in 0..<n where cells[y][x] && !inFinder(x, y) {
                path.addRoundedRect(in: CGRect(x: (CGFloat(x) + 0.04) * u, y: (CGFloat(y) + 0.04) * u, width: 0.92 * u, height: 0.92 * u), cornerSize: CGSize(width: 0.32 * u, height: 0.32 * u)) } }
            ctx.fill(path, with: .color(color))
            var f = Path()
            for (fx, fy) in [(0, 0), (n - 7, 0), (0, n - 7)] {
                func rr(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ r: CGFloat) { f.addRoundedRect(in: CGRect(x: x * u, y: y * u, width: w * u, height: w * u), cornerSize: CGSize(width: r * u, height: r * u)) }
                rr(CGFloat(fx), CGFloat(fy), 7, 2); rr(CGFloat(fx) + 1, CGFloat(fy) + 1, 5, 1.2); rr(CGFloat(fx) + 2, CGFloat(fy) + 2, 3, 0.9)
            }
            ctx.fill(f, with: .color(color), style: FillStyle(eoFill: true))
        }.aspectRatio(1, contentMode: .fit)
    }
}

/// QR-mátrix a rendszer CIQRCodeGenerator-ából (M hibajavítás): a kimeneti kép 1 pixel/modul.
enum QrMatrix {
    static func make(_ text: String) -> [[Bool]] {
        guard let f = CIFilter(name: "CIQRCodeGenerator") else { return [] }
        f.setValue(Data(text.utf8), forKey: "inputMessage"); f.setValue("M", forKey: "inputCorrectionLevel")
        guard let img = f.outputImage, let cg = CIContext().createCGImage(img, from: img.extent) else { return [] }
        let w = cg.width, h = cg.height
        var pixels = [UInt8](repeating: 0, count: w * h * 4)
        let ctx = CGContext(data: &pixels, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        ctx?.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        return (0..<h).map { y in (0..<w).map { x in pixels[(y * w + x) * 4] < 128 } }
    }
}

/// QR-beolvasó: négyzetes, 1,5 rem lekerekítés, középen világító keret.
struct QrScanner: View {
    @Environment(\.pal) private var pal
    var onCode: (String) -> Void
    var body: some View {
        ZStack { ScannerView(onCode: onCode); RoundedRectangle(cornerRadius: 20).stroke(pal.primary, lineWidth: 2).padding(.all, 0).scaleEffect(0.64) }
            .aspectRatio(1, contentMode: .fit).background(Color(hex: "#0C1018")).clipShape(RoundedRectangle(cornerRadius: 24)).overlay(RoundedRectangle(cornerRadius: 24).stroke(pal.glassEdge, lineWidth: 1))
    }
}
struct ScannerView: UIViewRepresentable {
    var onCode: (String) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(onCode) }
    func makeUIView(context: Context) -> PreviewView {
        let v = PreviewView(); let s = AVCaptureSession()
        if let dev = AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: dev), s.canAddInput(input) { s.addInput(input) }
        let out = AVCaptureMetadataOutput()
        if s.canAddOutput(out) { s.addOutput(out); out.setMetadataObjectsDelegate(context.coordinator, queue: .main); out.metadataObjectTypes = [.qr] }
        v.previewLayer.session = s; v.previewLayer.videoGravity = .resizeAspectFill; context.coordinator.session = s
        DispatchQueue.global(qos: .userInitiated).async { s.startRunning() }
        return v
    }
    func updateUIView(_ uiView: PreviewView, context: Context) {}
    static func dismantleUIView(_ uiView: PreviewView, coordinator: Coordinator) { coordinator.session?.stopRunning() }
    final class PreviewView: UIView { override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }; var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer } }
    final class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate {
        var session: AVCaptureSession?; let cb: (String) -> Void; var done = false
        init(_ cb: @escaping (String) -> Void) { self.cb = cb }
        func metadataOutput(_ o: AVCaptureMetadataOutput, didOutput objs: [AVMetadataObject], from c: AVCaptureConnection) {
            if !done, let s = (objs.first as? AVMetadataMachineReadableCodeObject)?.stringValue { done = true; cb(s) }
        }
    }
}
