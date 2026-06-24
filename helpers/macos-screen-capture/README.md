# Mantis Screen Capture for macOS

Version: `0.1.0`

This is an optional menu bar helper for screenshots. The browser extension remains the main Mantis
product for DOM extraction. Use this helper only when the source is an image or screenshot rather
than a web page DOM.

## What It Does

- Runs as a small menu bar item.
- Registers `Cmd+Shift+M` for interactive screenshot capture.
- Uses macOS `screencapture` to capture the selected region.
- Runs Apple Vision OCR locally.
- Passes the OCR result through `mantis.js` with `Mantis.fromImage()`.
- Saves `.png` and `.md` files to `~/Documents/Mantis Captures`.
- Copies the Markdown to the clipboard.

The helper does not upload images or Markdown. Node is only invoked during capture so Mantis can
normalize the OCR text; it is not part of the always-on menu bar process.

## Requirements

- macOS 13 or later
- Swift toolchain / Xcode command line tools
- Node.js on `PATH`
- Screen Recording permission when macOS asks for it

## Run

From this directory:

```sh
swift run mantis-screen-capture
```

The first launch shows setup instructions. After that, use the menu bar item or press `Cmd+Shift+M`.

Check the helper version:

```sh
swift run mantis-screen-capture -- --version
node mantis-normalize.js --version
```

## Build A Release Binary

```sh
swift build -c release
.build/release/mantis-screen-capture
```

Keep the binary in this repo checkout, or set `MANTIS_HELPER_ROOT` to this directory before launch,
so the app can find `mantis-normalize.js` and the root `mantis.js`.

For an always-on setup, add the release binary as a macOS login item or wrap it in a LaunchAgent.
That packaging is intentionally separate from this first helper so the checked-in tool stays small.

## Output

Each capture creates:

- `mantis-YYYYMMDD-HHMMSS.png`
- `mantis-YYYYMMDD-HHMMSS.md`

Markdown frontmatter includes `captureMode: "image"`, `helperVersion`, `visionEngine`,
`ocrLineCount`, confidence, hashes, and the normal Mantis source-safety note.

## Limits

Apple Vision OCR extracts visible text. It does not understand charts, diagrams, color intent, or
design quality. The Markdown is useful for text-heavy screenshots and light UI captures; visual
comparison and diagram understanding should be added as separate features.
