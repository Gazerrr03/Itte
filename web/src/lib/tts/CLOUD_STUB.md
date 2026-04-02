# Cloud TTS Stub (Milestone v1)

This directory exposes a provider contract (`TTSProvider`) and a cloud stub implementation.

Current behavior:

- `browser` engine: fully functional via Web Speech API
- `cloud` engine: intentionally disabled and returns a clear error message

Integration point for next milestone:

1. Implement a real cloud provider class in this directory
2. Keep `TTSProvider` method signatures unchanged
3. Switch `createTTSProvider("cloud")` to the real provider
4. Keep `TTSManager` logic untouched to preserve UI behavior
