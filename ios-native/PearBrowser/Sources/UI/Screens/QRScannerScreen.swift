//  PearBrowser — QRScannerScreen.swift
//
//  SwiftUI mirror of app/screens/QRScannerScreen.tsx. Uses AVFoundation's
//  built-in QR metadata recognition (no Vision framework needed — the
//  metadata object types cover `.qr` out of the box).
//
//  Validates scanned payloads: accepts hyper:// URLs, bare 52-64 char hex
//  keys (auto-prefixed with hyper://), and https://…p2phiverelay… relay
//  gateway URLs.

import SwiftUI
import AVFoundation

struct QRScannerScreen: View {
    let onScan: (String) -> Void
    let onClose: () -> Void

    @State private var permission: AVAuthorizationStatus = AVCaptureDevice.authorizationStatus(for: .video)
    @State private var scanned = false
    @State private var invalidToast: String? = nil

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            switch permission {
            case .authorized:
                authorizedView
            case .notDetermined:
                requestView
            case .denied, .restricted:
                deniedView
            @unknown default:
                deniedView
            }
        }
    }

    @ViewBuilder
    private var authorizedView: some View {
        CameraView(
            onCodeScanned: { code in handleCode(code) },
            enabled: !scanned
        )
        .ignoresSafeArea()
        .overlay(overlay)
    }

    private var overlay: some View {
        VStack {
            HStack {
                Spacer()
                Button(action: onClose) {
                    Text("Close")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16).padding(.vertical, 8)
                        .background(Color.black.opacity(0.6), in: Capsule())
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 20).padding(.top, 60)

            Spacer()

            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .stroke(PearColors.accent, lineWidth: 3)
                    .frame(width: 250, height: 250)
                if let invalidToast {
                    Text(invalidToast)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .background(Color.black.opacity(0.7), in: Capsule())
                }
            }

            Spacer()

            Text("Point at a QR code with a hyper:// address")
                .font(.system(size: 14))
                .foregroundStyle(.white)
                .padding(.horizontal, 20).padding(.vertical, 10)
                .background(Color.black.opacity(0.6), in: Capsule())
                .padding(.bottom, 80)
        }
    }

    private var requestView: some View {
        VStack(spacing: 16) {
            Text("Camera Access")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(PearColors.textPrimary)
            Text("PearBrowser needs camera access to scan QR codes containing hyper:// addresses.")
                .font(.system(size: 15))
                .foregroundStyle(PearColors.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            Button("Grant Access") {
                AVCaptureDevice.requestAccess(for: .video) { granted in
                    Task { @MainActor in
                        permission = granted ? .authorized : .denied
                    }
                }
            }
            .font(.system(size: 16, weight: .bold))
            .foregroundStyle(PearColors.bg)
            .padding(.horizontal, 24).padding(.vertical, 12)
            .background(PearColors.accent, in: RoundedRectangle(cornerRadius: 12))
            Button("Cancel", action: onClose)
                .font(.system(size: 14))
                .foregroundStyle(PearColors.textSecondary)
        }
    }

    private var deniedView: some View {
        VStack(spacing: 16) {
            Text("Camera not available")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(PearColors.textPrimary)
            Text("Enable camera access in Settings to scan QR codes.")
                .font(.system(size: 15))
                .foregroundStyle(PearColors.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            Button("Close", action: onClose)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(PearColors.bg)
                .padding(.horizontal, 24).padding(.vertical, 12)
                .background(PearColors.accent, in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private func handleCode(_ raw: String) {
        guard !scanned else { return }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)

        if trimmed.hasPrefix("hyper://") || trimmed.hasPrefix("pear://") || trimmed.hasPrefix("hyperbee://") {
            scanned = true
            onScan(trimmed)
            return
        }
        if trimmed.range(of: "^[a-f0-9]{52,64}$", options: [.regularExpression, .caseInsensitive]) != nil {
            scanned = true
            onScan("hyper://\(trimmed)")
            return
        }
        if trimmed.hasPrefix("https://") && trimmed.contains("p2phiverelay") {
            scanned = true
            onScan(trimmed)
            return
        }

        invalidToast = "Not a hyper:// QR"
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            invalidToast = nil
        }
    }
}

// MARK: - UIKit camera view wrapping AVCaptureSession

private struct CameraView: UIViewRepresentable {
    let onCodeScanned: (String) -> Void
    let enabled: Bool

    func makeUIView(context: Context) -> CameraUIView { CameraUIView(onCodeScanned: onCodeScanned) }
    func updateUIView(_ uiView: CameraUIView, context: Context) { uiView.setEnabled(enabled) }
}

private final class CameraUIView: UIView, AVCaptureMetadataOutputObjectsDelegate {
    private let session = AVCaptureSession()
    private let previewLayer = AVCaptureVideoPreviewLayer()
    private let onCodeScanned: (String) -> Void
    private var sessionEnabled = true

    init(onCodeScanned: @escaping (String) -> Void) {
        self.onCodeScanned = onCodeScanned
        super.init(frame: .zero)
        backgroundColor = .black
        layer.addSublayer(previewLayer)
        configure()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) not implemented") }

    override func layoutSubviews() {
        super.layoutSubviews()
        previewLayer.frame = bounds
    }

    func setEnabled(_ enabled: Bool) {
        sessionEnabled = enabled
        if enabled && !session.isRunning {
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in self?.session.startRunning() }
        } else if !enabled && session.isRunning {
            session.stopRunning()
        }
    }

    private func configure() {
        session.beginConfiguration()
        session.sessionPreset = .high

        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else {
            session.commitConfiguration()
            return
        }
        session.addInput(input)

        let output = AVCaptureMetadataOutput()
        if session.canAddOutput(output) {
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = [.qr]
        }
        session.commitConfiguration()

        previewLayer.session = session
        previewLayer.videoGravity = .resizeAspectFill

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.session.startRunning()
        }
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput,
                        didOutput metadataObjects: [AVMetadataObject],
                        from connection: AVCaptureConnection) {
        guard sessionEnabled else { return }
        for object in metadataObjects {
            if let readable = object as? AVMetadataMachineReadableCodeObject,
               readable.type == .qr,
               let value = readable.stringValue {
                onCodeScanned(value)
                return
            }
        }
    }
}
