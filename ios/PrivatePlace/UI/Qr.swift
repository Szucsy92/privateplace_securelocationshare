import SwiftUI
import AVFoundation
import CoreImage.CIFilterBuiltins

struct QrImage: View {
    let text: String
    var body: some View {
        let f = CIFilter.qrCodeGenerator(); f.message = Data(text.utf8); f.correctionLevel = "M"
        let ctx = CIContext()
        if let out = f.outputImage?.transformed(by: CGAffineTransform(scaleX: 10, y: 10)), let cg = ctx.createCGImage(out, from: out.extent) {
            Image(decorative: cg, scale: 1).interpolation(.none).resizable().scaledToFit().padding(8).background(Color.white)
        }
    }
}

/// QR-beolvasó (AVFoundation metadata output).
struct QrScanner: UIViewRepresentable {
    var onCode: (String) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(onCode) }
    func makeUIView(context: Context) -> PreviewView {
        let v = PreviewView(); let s = AVCaptureSession()
        if let dev = AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: dev), s.canAddInput(input) { s.addInput(input) }
        let out = AVCaptureMetadataOutput()
        if s.canAddOutput(out) { s.addOutput(out); out.setMetadataObjectsDelegate(context.coordinator, queue: .main); out.metadataObjectTypes = [.qr] }
        v.previewLayer.session = s; v.previewLayer.videoGravity = .resizeAspectFill
        context.coordinator.session = s
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
