// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "MantisScreenCapture",
  platforms: [
    .macOS(.v13)
  ],
  products: [
    .executable(name: "mantis-screen-capture", targets: ["MantisScreenCapture"])
  ],
  targets: [
    .executableTarget(name: "MantisScreenCapture")
  ]
)
