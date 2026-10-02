# Adapted from mcreader-v2, tts/app/__init__.py (Adam's rule, 2 October 2026: only speech code is reused).
"""AI Write's speech server: reading aloud with Breeze TTS 2, and dictation with Parakeet or Whisper.

The code ships with AI Write. Everything it downloads (its Python environments, packages and models) lives
in the speech folder of AI Write's user data, which AI Write passes in AIWRITE_SPEECH_HOME: never in the
app's own folder, a world folder or a backup.
"""

__version__ = "1.0.0"
