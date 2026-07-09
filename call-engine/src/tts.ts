import axios from "axios";

export async function textToSpeech(text: string): Promise<Buffer> {
  const response = await axios.post(
    "https://api.sarvam.ai/text-to-speech",
    {
      inputs: [text],
      target_language_code: "hi-IN",
      speaker: "anushka",
      model: "bulbul:v2",
      enable_preprocessing: true,
      pace: 1.0,
    },
    {
      headers: {
        "api-subscription-key": process.env.SARVAM_KEY,
        "Content-Type": "application/json",
      },
    }
  );

  return Buffer.from(response.data.audios[0], "base64");
}