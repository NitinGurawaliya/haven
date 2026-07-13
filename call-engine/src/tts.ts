import axios from "axios";

const SARVAM_HEADERS = {
  "api-subscription-key": process.env.SARVAM_KEY,
  "Content-Type": "application/json",
};

async function toDevanagari(text: string): Promise<string> {
  try {
    const response = await axios.post(
      "https://api.sarvam.ai/transliterate",
      {
        input: text,
        source_language_code: "en-IN",
        target_language_code: "hi-IN",
      },
      { headers: SARVAM_HEADERS }
    );

    return response.data.transliterated_text || response.data.output || text;
  } catch {
    return text;
  }
}

export async function textToSpeech(text: string): Promise<Buffer> {
  if (!process.env.SARVAM_KEY) {
    throw new Error("SARVAM_KEY is not set in .env");
  }

  const devanagariText = await toDevanagari(text);

  const response = await axios.post(
    "https://api.sarvam.ai/text-to-speech",
    {
      inputs: [devanagariText],
      target_language_code: "hi-IN",
      speaker: "anushka",
      model: "bulbul:v2",
      enable_preprocessing: true,
      pace: 1.0,
    },
    { headers: SARVAM_HEADERS }
  );

  const audio = response.data?.audios?.[0];
  if (!audio) {
    throw new Error("Sarvam TTS returned no audio");
  }

  return Buffer.from(audio, "base64");
}
