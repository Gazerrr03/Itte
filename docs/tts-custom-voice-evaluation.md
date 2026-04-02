# Custom Voice & Open Audio Resource Evaluation (Issue #7)

## Goal

Provide a practical shortlist for the next milestone: custom voice support beyond browser TTS.

## Managed vendor options

- OpenAI TTS: high quality hosted option, no self-hosted custom cloning in this milestone.
- Azure Speech (Custom Neural Voice): enterprise path with consent and review workflow.
- Google Cloud TTS (Instant Custom Voice): managed custom voice with policy requirements.

## Open-source candidates

- Coqui TTS (XTTS family): strong community and multilingual support; verify model license before commercial use.
- OpenVoice: practical cloning path for experimentation; evaluate quality and guardrails.
- Piper: efficient local inference; better fit for fixed voices than cloning-heavy flows.

## Open audio data sources to evaluate

- Common Voice (multilingual crowd-sourced data)
- LibriTTS (clean English speech corpus)
- VCTK (multi-speaker accented English)
- LJSpeech (single-speaker baseline)

## Risk checklist

- Legal consent proof for cloned voices
- Anti-abuse controls (voice impersonation policy, moderation workflow)
- License compatibility for model + dataset + generated output
- PII retention policy for uploaded voice samples

## Recommended next step

Run a small technical spike with one managed provider and one open-source stack, then compare:

1. latency
2. naturalness
3. cost
4. legal/compliance overhead
