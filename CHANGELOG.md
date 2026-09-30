# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-01

First release.

### Added

- `LinePay` client for the LINE Pay Online API v4: `requestPayment`,
  `checkPaymentRequest`, `confirm`, `capture`, `void`, `refund`,
  `getPaymentDetails`, and pre-approved payments (`preapproved.check`,
  `preapproved.pay`, `preapproved.discard`).
- Request signing over the exact bytes sent, with a fresh nonce per call.
- Lossless JSON parsing: 19-digit transaction IDs are strings, never
  rounded numbers.
- `LinePayApiError` with a handling `category` for every result code,
  `LinePayUnknownOutcomeError` (with `movesMoney`) for timeouts and unusable
  replies, `LinePayValidationError` for requests rejected locally.
- `validatePaymentRequest`, `readRedirectParams`, `resultCodeInfo`,
  `createSignature`, `parseLossless`.
- ESM and CommonJS builds with type declarations; Node.js 20+.
- Live tests against the LINE Pay sandbox and an end-to-end sandbox script.

[Unreleased]: https://github.com/jianan1104/linepay-v4/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jianan1104/linepay-v4/releases/tag/v0.1.0
