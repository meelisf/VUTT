# -*- coding: utf-8 -*-
"""
Qwen3-VL-8B peenhäälestatud mudeli kasutamine hulgijäreldamiseks (optimeeritud variant).

Lisatud:
- Loomulik sorteerimine (natsorted), et fail_2.jpg tuleks enne fail_10.jpg.
- Kontroll, kas vastav .txt väljundfail juba eksisteerib -> sellised failid jäetakse vahele.
- FAILIDE_LIMIIT: maksimaalne arv uusi faile, mida selles jooksus töödeldakse.
- PAUS iga N töödeldud faili järel GPU jahutamiseks.
- Logid: mitu faili leiti, mitu on juba olemas, mitu jääb teha.
"""

import os
import argparse
os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"

import time
import gc
import torch
from PIL import Image as PILImage
from tqdm import tqdm
from natsort import natsorted
from unsloth import FastVisionModel

# --- 1. SEADISTUS (ARGUMENTIDEST) ---

parser = argparse.ArgumentParser(description="Qwen3-VL-8B hulgijäreldamine")
parser.add_argument("directory", help="Kataloogi teekond, kus pildid asuvad (ja kuhu salvestatakse tekstid)")
parser.add_argument("--model", default="/home/mf/Dokumendid/LLM/qwen-treening/qwen-ocr-finetuned-greek", help="Mudeli kausta teekond")

args = parser.parse_args()

MODEL_PATH = args.model
IMAGES_INPUT_DIR = args.directory
TEXT_OUTPUT_DIR = args.directory

MAX_SIDE = 2048  # proovi 1536, vajadusel 1280 või 1024 kui mälu on ikka kitsas

BATCH_SIZE = 3  # kohanda vastavalt VRAM-ile, 2-ga töötab ilusasti.

# Kui sul on 14k pilti, vali siia nt 200, 500, 1000 jne (vastavalt kui palju korraga tahad teha)
FAILIDE_LIMIIT = 3000

# Paus iga N uue töödeldud faili järel
PAUS_IGA_N_FAILI_JAREL = 50
PAUSI_KESTUS_SEKUNDITES = 60  # nt 60 sekundit; muuda vastavalt vajadusele

PROMPT = """**Task:** You are an expert OCR assistant specializing in historical documents. Your task is to transcribe the text from the provided image with maximum accuracy.

**Instructions:**
1.  Transcribe all **complete** pages of text, ignoring any pages that are cut off.
2.  If two pages are present, use `[LEFT PAGE]` and `[RIGHT PAGE]` markers.
3.  Preserve original line breaks and hyphenation.
4.  **Handle Historical Characters with Extreme Precision:** This is the most critical part of your task.
    *   **Long S (`ſ`):** The long s (`ſ`) is used frequently. Distinguish it carefully from `f`.
    *   **Long S Ligatures:** Pay exceptionally close attention to ligatures involving the long s. These are often misidentified.
        *   **`ſſ` ligature:** As in the word `aſſumtione`.
        *   **`ſi` ligature:** Often mistaken for `fi`. For example, `tameſi`, not `tametfi`.
        *   **`ſt` ligature:** As in the word `Chriſtus`.
    *   **Other Ligatures:** Preserve all other ligatures like `æ` and `œ`.
5.  Transcribe in the original language (Latin, Greek, etc.). **Do not translate.**
6.  Note page numbers if visible (e.g., `[PAGE 179]`).
7. If an individual character is visually uncertain, prefer:
   - the historically and orthographically more probable variant;
   - not random noise (e.g., a broken "o" should not immediately become "c").

8. Pay particular attention to:
   - distinguishing "ſ" and "f" only when you are certain about the shape of the stroke and the presence of the crossbar;
   - when in doubt, prefer "ſ" in positions where it is linguistically and historically expected.

9. Do not add, remove, or creatively alter words. Make only the most probable decision based on the language and orthography of the given period.

**Output Format:** Plain text within a single Markdown code block."""

# --- 1.1 Kontrollid ja väljundkaust ---

if not os.path.exists(MODEL_PATH):
    raise FileNotFoundError(f"Treenitud mudeli kausta ei leitud asukohast: {MODEL_PATH}")
if not os.path.exists(IMAGES_INPUT_DIR):
    raise FileNotFoundError(f"Testpiltide kausta ei leitud asukohast: {IMAGES_INPUT_DIR}")
os.makedirs(TEXT_OUTPUT_DIR, exist_ok=True)

# --- 2. MUDELI LAADIMINE ---

if not torch.cuda.is_available():
    raise RuntimeError("CUDA ei ole saadaval. Järeldamiseks on vaja GPU-d.")

print(f"Laen peenhäälestatud mudelit asukohast: {MODEL_PATH}...")

model, tokenizer = FastVisionModel.from_pretrained(
    model_name=MODEL_PATH,
    load_in_4bit=True,
)

tokenizer.truncation = False
FastVisionModel.for_inference(model)
model.eval()
print("Mudel on järeldamiseks valmis.")

# --- 3. ABIFUNKTSIOONID ---

def build_chat_template():
    """
    Chat-template on konstantne (ainult PROMPT + üks pilt).
    """
    base_messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": PROMPT},
                {"type": "image"},
            ],
        }
    ]
    tpl = tokenizer.apply_chat_template(
        base_messages,
        add_generation_prompt=True,
        tokenize=False,
    )
    return tpl

CHAT_TEMPLATE = build_chat_template()

def strip_prompt_from_output(text: str) -> str:
    """
    Eemaldab PROMPT-i ja tüüpilised chat-märgendid väljundist.
    """
    if PROMPT in text:
        text = text.split(PROMPT, 1)[-1]
    markers = ["</assistant>", "<|assistant|>", "<|im_start|>assistant", "assistant\n"]
    for m in markers:
        if m in text:
            text = text.split(m, 1)[-1]
    return text.strip()

def resize_long_side(img, max_side=MAX_SIDE):
    w, h = img.size
    scale = min(max_side / max(w, h), 1.0)
    if scale < 1.0:
        new_size = (int(w * scale), int(h * scale))
        return img.resize(new_size, resample=PILImage.LANCZOS)
    return img

# --- 4. PILDIFAILIDE KOGUMINE JA FILTREERIMINE ---

# Leia kõik pildid (vajadusel lisa teisi laiendeid)
all_image_files = [
    f for f in os.listdir(IMAGES_INPUT_DIR)
    if f.lower().endswith((".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"))
]

# Loomulik sorteerimine
all_image_files = natsorted(all_image_files)

if not all_image_files:
    print("Ühtegi pilti ei leitud. Lõpetan.")
    raise SystemExit

# Filtreerime välja need, millele VÄLJUND juba olemas
pending_files = []
already_done = 0

for f in all_image_files:
    base_name = os.path.splitext(f)[0]
    out_path = os.path.join(TEXT_OUTPUT_DIR, f"{base_name}.txt")
    if os.path.exists(out_path):
        already_done += 1
    else:
        pending_files.append(f)

print(f"Kokku leitud pilte: {len(all_image_files)}")
print(f"Juba olemasolevaid transkriptsioone: {already_done}")
print(f"Uusi töödeldavaid pilte (potentsiaalselt): {len(pending_files)}")

if not pending_files:
    print("Kõik pildid on juba töödeldud. Midagi uut teha ei ole.")
    raise SystemExit

# Rakendame FAILIDE_LIMIIT'i
if FAILIDE_LIMIIT is not None and FAILIDE_LIMIIT > 0:
    pending_files = pending_files[:FAILIDE_LIMIIT]

print(f"Selles jooksus töödeldakse maksimaalselt: {len(pending_files)} faili.")

# Jagame allesjäänud failid BATCH_IDEKS
batches = [
    pending_files[i:i + BATCH_SIZE]
    for i in range(0, len(pending_files), BATCH_SIZE)
]

# --- 5. PAKKIDE TÖÖTLEMINE ---

processed_in_this_run = 0

for batch_index, batch_filenames in enumerate(batches, start=1):

    # PAUS: kontrolli enne iga batchi (välja arvatud esimene), kas on aeg puhata
    if (
        processed_in_this_run > 0 and
        processed_in_this_run % PAUS_IGA_N_FAILI_JAREL == 0
    ):
        print(
            f"\n--- PAUS ---\n"
            f"Töödeldud {processed_in_this_run} faili selles jooksus. "
            f"Paus {PAUSI_KESTUS_SEKUNDITES} sekundit GPU jahutamiseks."
        )
        time.sleep(PAUSI_KESTUS_SEKUNDITES)
        print(">>> Paus lõppenud. Jätkan tööd.\n")

    print(
        f"\n=== Töötlen batchi {batch_index}/{len(batches)}; "
        f"failid {processed_in_this_run + 1} kuni "
        f"{min(processed_in_this_run + len(batch_filenames), len(pending_files))} "
        f"kokku {len(pending_files)}-st ==="
    )

    try:
        images_to_test = []

        # Laeme pildid
        for filename in batch_filenames:
            image_path = os.path.join(IMAGES_INPUT_DIR, filename)

            # Turvakontroll: kui väljund tekib vahepeal, ära tee topelt
            base_name = os.path.splitext(filename)[0]
            output_txt_path = os.path.join(TEXT_OUTPUT_DIR, f"{base_name}.txt")
            if os.path.exists(output_txt_path):
                print(f"[SKIP] {filename} -> väljund juba olemas.")
                continue

            with PILImage.open(image_path) as img:
                img = img.convert("RGB")
                img = resize_long_side(img)  # väiksemaks
                images_to_test.append((filename, img))

        # Kui pärast filtreerimist pole midagi selles batchis teha, liigu edasi
        if not images_to_test:
            continue

        # Sisendtekstid (üks template iga pildi kohta)
        full_input_texts = [CHAT_TEMPLATE] * len(images_to_test)

        # Eemaldame piltide listist ainult PIL-objektid tokeniseerimiseks
        pil_images = [img for _, img in images_to_test]

        # Tokeniseerimine
        inputs = tokenizer(
            pil_images,
            full_input_texts,
            add_special_tokens=False,
            return_tensors="pt",
            padding=True,
        ).to("cuda")

        print(f"   -> Alustan genereerimist: {len(images_to_test)} pilti batchis.")

        # Generatsioon
        with torch.no_grad():
            outputs = model.generate(
                **inputs,
                max_new_tokens=3000,    # isegi 2500 jääb topeltlehtedel väheks!
                do_sample=False,
                temperature=0.0,
                top_p=1.0,
                top_k=50,
                use_cache=True,        # vähendab mälu kasutust
            )
        print("   -> Genereerimine lõpetatud, dekodeerin...")
        # Dekodeerimine
        decoded_texts = tokenizer.batch_decode(
            outputs,
            skip_special_tokens=True,
        )

        # Väljundite salvestamine
        for (filename, _), raw_text in zip(images_to_test, decoded_texts):
            response_text = strip_prompt_from_output(raw_text)

            base_name = os.path.splitext(filename)[0]
            output_txt_path = os.path.join(TEXT_OUTPUT_DIR, f"{base_name}.txt")

            with open(output_txt_path, "w", encoding="utf-8") as f:
                f.write(f"{filename}\n")
                f.write(response_text)

            processed_in_this_run += 1

        # Mälu koristus
        del inputs
        del outputs
        del decoded_texts
        del pil_images
        del images_to_test
        gc.collect()
        torch.cuda.empty_cache()

    except Exception as e:
        print(f"\n!!! Viga paki töötlemisel (alates failist '{batch_filenames[0]}'): {e}")

print(
    f"\nTöö lõpetatud! Selles jooksus töödeldi {processed_in_this_run} faili. "
    f"Transkriptsioonid on salvestatud kausta: {TEXT_OUTPUT_DIR}"
)
