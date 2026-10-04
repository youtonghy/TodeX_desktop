// swift-tools-version: 6.2
import PackageDescription

// TodeX's Computer Use helper: a JSON-lines stdio process the desktop's main
// process starts. Accessibility reading, background presses and text
// insertion use the system Accessibility API directly; pointer, wheel, key
// chords and app lifecycle come from Peekaboo (MIT, pinned).
let package = Package(
    name: "TodexComputer",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "todex-computer", targets: ["todex-computer"]),
    ],
    dependencies: [
        .package(url: "https://github.com/openclaw/Peekaboo.git", exact: "4.7.0"),
    ],
    targets: [
        .target(name: "TodexComputerCore"),
        .executableTarget(
            name: "todex-computer",
            dependencies: [
                "TodexComputerCore",
                .product(name: "PeekabooAutomationKit", package: "Peekaboo"),
                .product(name: "PeekabooFoundation", package: "Peekaboo"),
            ]),
        .testTarget(name: "TodexComputerCoreTests", dependencies: ["TodexComputerCore"]),
    ])
