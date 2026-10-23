"""Pre-render the scripted demo lines with an open Indic TTS model, on a free GPU.

Run this in Google Colab (Runtime -> Change runtime type -> T4 GPU), not on a laptop:

    !pip install -q git+https://github.com/huggingface/parler-tts.git soundfile
    # upload tools/demo_lines.json (made by `npm run voice:lines` in web/)
    !python prerender_demo_voice.py demo_lines.json out/

Model: ai4bharat/indic-parler-tts (https://huggingface.co/ai4bharat/indic-parler-tts).
The model page is gated: accept its terms with your Hugging Face account and run
`huggingface-cli login` first. Check the licence on the model card before you
publish audio (it was listed as Apache-2.0 when this script was written), and keep
the model name and licence next to any audio you commit.

The voices are synthetic (a text description picks the speaker). No real person's
voice is recorded or cloned. Output: out/<id>.wav plus out/SOURCE.txt.
"""
import json
import pathlib
import sys

MODEL = "ai4bharat/indic-parler-tts"
DESCRIPTION = {
    "hi-IN": "Divya speaks slowly and warmly in a calm, close-sounding recording with very clear audio.",
    "mr-IN": "Sanjana speaks slowly and warmly in a calm, close-sounding recording with very clear audio.",
    "en-IN": "Mary speaks slowly and warmly with an Indian English accent in a calm, very clear recording.",
}


def main(lines_path: str, out_dir: str) -> None:
    import soundfile as sf
    import torch
    from parler_tts import ParlerTTSForConditionalGeneration
    from transformers import AutoTokenizer

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = ParlerTTSForConditionalGeneration.from_pretrained(MODEL).to(device)
    tok = AutoTokenizer.from_pretrained(MODEL)
    desc_tok = AutoTokenizer.from_pretrained(model.config.text_encoder._name_or_path)

    out = pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    lines = json.loads(pathlib.Path(lines_path).read_text(encoding="utf-8"))
    for line in lines:
        desc = DESCRIPTION.get(line["lang"], DESCRIPTION["hi-IN"])
        d = desc_tok(desc, return_tensors="pt").to(device)
        p = tok(line["text"], return_tensors="pt").to(device)
        audio = model.generate(input_ids=d.input_ids, attention_mask=d.attention_mask,
                               prompt_input_ids=p.input_ids, prompt_attention_mask=p.attention_mask)
        sf.write(out / f"{line['id']}.wav", audio.cpu().numpy().squeeze(), model.config.sampling_rate)
        print("wrote", line["id"])
    (out / "SOURCE.txt").write_text(
        f"Synthetic speech generated with {MODEL} from tools/demo_lines.json.\n"
        "Licence: see the model card. No real person's voice was recorded or cloned.\n", encoding="utf-8")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: prerender_demo_voice.py demo_lines.json out_dir")
    main(sys.argv[1], sys.argv[2])
