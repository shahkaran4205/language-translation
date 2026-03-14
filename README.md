# Live Lingo

A Next.js app for realtime speech translation with live captions, speech synthesis, and multi-device rooms.

## Features
- Language selection for input and output.
- Live speech-to-text with interim and final transcripts.
- On-screen translations and optional voice playback.
- Voice selection, auto-speak, and mute controls.
- Room mode using WebSockets for multi-device translation.
- Typed input fallback for no-mic environments.
- Latency indicator, room status, and transcript history.

## Getting started
```bash
npm install
npm run dev
```

## Translation provider
The default translation provider is a stub that echoes the text. Configure one of the providers below.

### Gemini
```bash
set TRANSLATE_PROVIDER=gemini
set GEMINI_API_KEY=YOUR_KEY
set GEMINI_MODEL=gemini-2.5-flash
```

### LibreTranslate
```bash
set TRANSLATE_PROVIDER=libre
set LIBRETRANSLATE_URL=http://localhost:5000
```

## Notes
- Speech recognition and synthesis are browser features. Use Chrome for best results.
- WebSockets are in-memory; rooms reset on server restart.
- For production, add auth, logging, and moderation.
