# -*- coding: utf-8 -*-
"""
AUTO-OCR kataloogi jälgimise teenus – Qwen3.5-9B peenhäälestatud mudel

Jälgib kataloogi /home/mf/Dokumendid/LLM/AUTO-OCR rekursiivselt.
Iga pildi (.jpg/.png/...) jaoks, millel puudub kõrvalolev .txt fail,
käivitatakse OCR ja tulemus salvestatakse sama nimega .txt faili.
PDF-id pakitakse kõigepealt piltide kaustaks lahti.

Teenuse haldamine:
  sudo systemctl start ocr-service
  sudo systemctl stop ocr-service
  sudo systemctl status ocr-service
  journalctl -u ocr-service -f
"""

import os
import sys
import time
import logging
import signal
import torch
import gc
import re
import unicodedata
import shutil
from typing import Optional
from pathlib import Path
from datetime import datetime
from PIL import Image as PILImage
from pdf2image import convert_from_path
from unsloth import FastVisionModel
from natsort import natsorted
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "scripts"))
from prompt import INSTRUCTION

# --- 0. LOGIMINE JA SIGNAALID ---

SCRIPT_DIR = Path(__file__).resolve().parent
LOG_FILE = SCRIPT_DIR / "ocr-service.log"

class FlushFileHandler(logging.FileHandler):
    """FileHandler, mis flushibi iga kirje järel – logid jõuavad kohe faili."""
    def emit(self, record):
        super().emit(record)
        self.flush()

root_logger = logging.getLogger()
root_logger.handlers = []

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        FlushFileHandler(str(LOG_FILE), encoding="utf-8"),
        logging.StreamHandler(sys.stdout)
    ],
    force=True
)
logger = logging.getLogger(__name__)

shutdown_requested = False

def signal_handler(signum, frame):
    global shutdown_requested
    logger.info(f"Sain signaali {signum}, peatan...")
    shutdown_requested = True

signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)

# Vigaste PDF-ide meeldejätmine (vältimaks korduvaid ebaõnnestunud katseid)
failed_pdfs = set()

# --- 1. SEADISTUS ---

BASE_OCR_KAUST = "/home/mf/Dokumendid/LLM/AUTO-OCR"

# Iga tüübi jaoks eraldi alamkaust ja mudel
MODEL_CONFIGS = {
    "print": "models/qwen3.5-ocr-lora",
    "hand":  "models/qwen3.5-ocr-kurrent-20260602",
}

BATCH_SIZE = 3

PDF_DPI = 300

EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}

# Instruktsioon – identne treenimisega (train.py / train_stage2.py)
# Vana instruktsioon (markdown formaat, enne VUTT XML-ile \u00FCleminekut):
# INSTRUCTION_OLD = """You are an expert OCR assistant for historical documents.
#
# Instructions:
# 1. Transcribe the entire page from the provided image.
# 2. Preserve original line breaks and hyphenation:
#    - Antiqua hyphenation: - (regular hyphen), e.g. coa-cervare
#    - Fraktur/Gothic hyphenation: \u2E17 (double hyphen), e.g. Ge\u2E17witter
# 3. Do not translate; keep the original language (Latin, Greek, German, Estonian, etc.).
# 4. Ligatures:
#    - \u00E6, \u00C6, \u0153, \u0152 \u2013 transcribe exactly as they are
#    - st, ff, fi, fl and other typographic ligatures \u2013 write out as separate letters
# 5. Umlauts and diacritics:
#    - \u00F6, \u00E4, \u00FC, \u00F5 \u2013 always use modern form
#    - u\u0364, o\u0364, a\u0364 (letter + superscript e) \u2013 transcribe as \u00FC, \u00F6, \u00E4
#    - \u00E5, \u00C5 (Swedish) \u2013 keep as is
#    - \u0169, \u00F1, \u00F5 \u2013 keep as is (tilde preserved)
# 6. Special characters:
#    - \u017F (long s) \u2013 transcribe as \u017F
#    - \u00DF (double s) \u2013 transcribe as \u00DF
# 7. Abbreviations:
#    - que abbreviation (\uA757 etc.) \u2013 write as q;
#    - -us abbreviation (\uA770) \u2013 may be expanded
# 8. Signature marks (quire numbers): place at the very end, e.g. A 3
# 9. Page breaks: if the image contains a double-page spread, mark the page break between pages with --lk--.
#
# Return only the exact transcription as plain text."""

# --- 2. MUDELI LAADIMINE ---

logger.info("=== Käivitan In-Place OCR Teenuse (Qwen3.5-9B) ===")
logger.info(f"Baaskaust: {BASE_OCR_KAUST}")
logger.info(f"Mudelid: {MODEL_CONFIGS}")
logger.info(f"Logi fail: {LOG_FILE}")

if not torch.cuda.is_available():
    logger.error("CUDA puudub!")
    raise RuntimeError("CUDA puudub!")

# Laisk mudeli haldus — laadime ainult kui vaja, vahetame tüübivahel
_current_model_type = None  # type: Optional[str]
model = None
tokenizer = None


def _setup_tokenizer(tok):
    tok.image_processor.size = {
        "longest_edge": 5_120_000,
        "shortest_edge": tok.image_processor.size.get("shortest_edge", 65536),
    }
    if tok.chat_template and "enable_thinking" in tok.chat_template:
        tok.chat_template = tok.chat_template.replace(
            "enable_thinking=True", "enable_thinking=False"
        )
    return tok


def ensure_model(model_type: str):
    """Laadib mudeli kui pole laetud või tüüp on muutunud."""
    global _current_model_type, model, tokenizer

    if _current_model_type == model_type:
        return

    if model is not None:
        logger.info(f"Vabastab mudeli '{_current_model_type}'...")
        del model
        del tokenizer
        model = None
        tokenizer = None
        _current_model_type = None
        gc.collect()
        torch.cuda.empty_cache()
        logger.info("Mudel vabastatud.")

    model_path = MODEL_CONFIGS[model_type]
    logger.info(f"Laen mudelit '{model_type}': {model_path} ...")
    m, tok = FastVisionModel.from_pretrained(
        model_name=model_path,
        load_in_4bit=True,
    )
    tok = _setup_tokenizer(tok)
    FastVisionModel.for_inference(m)
    model = m
    tokenizer = tok
    _current_model_type = model_type
    logger.info(f"Mudel '{model_type}' laetud.")

# --- 3. ABIFUNKTSIOONID ---

def get_chat_template():
    return tokenizer.apply_chat_template(
        [{"role": "user", "content": [
            {"type": "text", "text": INSTRUCTION},
            {"type": "image"},
        ]}],
        add_generation_prompt=True, tokenize=False,
        enable_thinking=False,
    )

def strip_output(text: str) -> str:
    """
    Eemaldab mudeli väljundist süsteemi artefaktid:
    - <think>...</think> plokid (Qwen3.5 reasoning tokenid)
    - assistendi markerid
    - markdown koodiplokid
    """
    # Eemalda <think>...</think> plokid (sh tühjad)
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    # Lõika kõik, mis enne assistendi vastust
    for marker in ["</assistant>", "<|assistant|>", "<|im_start|>assistant", "assistant\n"]:
        if marker in text:
            text = text.split(marker, 1)[-1]
    # Eemalda markdown koodiplokid kui peaks esinema
    text = re.sub(r"^```[a-z]*\n?", "", text.strip())
    text = re.sub(r"\n?```$", "", text)
    return text.strip()

def sanitize_filename(name: str) -> str:
    """
    Teisendab failinime ASCII-sõbralikuks:
    - Normaliseerib unicode (ä→a, ß→ss, jne)
    - Asendab tühikud alakriipsuga
    - Eemaldab erimärgid
    """
    name = unicodedata.normalize("NFD", name)
    name = "".join(c for c in name if unicodedata.category(c) != "Mn")
    name = name.replace("ß", "ss")
    name = name.replace(" ", "_")
    name = re.sub(r"[^a-zA-Z0-9_\-.]", "", name)
    name = re.sub(r"_+", "_", name)
    return name.strip("_")

def wait_for_file_stable(file_path, check_interval=2, stable_count=2):
    """
    Ootab kuni fail on stabiilne (suurus ei muutu).
    Kasulik suurte failide kopeerimise ootamiseks.
    """
    path = Path(file_path)
    if not path.exists():
        return False

    last_size = -1
    stable_checks = 0

    while stable_checks < stable_count:
        if shutdown_requested:
            return False
        try:
            current_size = path.stat().st_size
        except OSError:
            return False
        if current_size == last_size:
            stable_checks += 1
        else:
            stable_checks = 0
            last_size = current_size
        if stable_checks < stable_count:
            time.sleep(check_interval)

    return True

def expand_pdf(pdf_path):
    """
    Pakib PDF lahti samanimelisse kausta.
    Nt: raamat.pdf → kaust raamat/ → raamat_pg_001.jpg, raamat_pg_002.jpg, ...
    Vigased PDF-id teisaldatakse VIGASED/ kausta.
    """
    pdf_path = Path(pdf_path)

    if str(pdf_path) in failed_pdfs:
        return

    if not wait_for_file_stable(pdf_path):
        logger.info(f"PDF {pdf_path.name} pole veel stabiilne, jätan vahele...")
        return

    safe_name = sanitize_filename(pdf_path.stem)
    output_dir = pdf_path.parent / safe_name

    if output_dir.exists() and any(output_dir.iterdir()):
        return

    logger.info(f"Leidsin PDFi: {pdf_path.name}. Pakin lahti kausta: {output_dir.name}...")
    output_dir.mkdir(exist_ok=True)

    try:
        images = convert_from_path(str(pdf_path), dpi=PDF_DPI, fmt="jpg")
        for i, img in enumerate(images):
            fname = output_dir / f"{safe_name}_pg_{i+1:03d}.jpg"
            img.save(fname, "JPEG", quality=95)
        logger.info(f"PDF lahti pakitud: {len(images)} lehte.")
    except Exception as e:
        logger.error(f"Viga PDF lahtipakkimisel {pdf_path}: {e}")
        failed_pdfs.add(str(pdf_path))
        vigased_dir = Path(BASE_OCR_KAUST) / "VIGASED"
        vigased_dir.mkdir(exist_ok=True)
        try:
            dest = vigased_dir / pdf_path.name
            shutil.move(str(pdf_path), str(dest))
            logger.info(f"Vigane PDF teisaldatud: {dest}")
            if output_dir.exists() and not any(output_dir.iterdir()):
                output_dir.rmdir()
        except Exception as move_err:
            logger.error(f"Ei suutnud vigast PDF-i teisaldada: {move_err}")

def process_batch(batch_items):
    """
    Töötleb ühe batchi pilte.
    batch_items: list tuple'itest (pildi_täistee, txt_väljundi_täistee)

    Pildi suuruse piiramine käib tokenizer.image_processor kaudu (5M px),
    käsitsi resize'i pole vaja – image_processor skaleerib automaatselt.
    """
    if not batch_items:
        return

    images_pil = []
    valid_items = []

    for img_path, txt_path in batch_items:
        try:
            img = PILImage.open(img_path).convert("RGB")
            images_pil.append(img)
            valid_items.append((img_path, txt_path))
        except Exception as e:
            logger.error(f"Viga pildi avamisel {img_path}: {e}")

    if not images_pil:
        return

    chat_template = get_chat_template()
    inputs = tokenizer(
        images_pil,
        [chat_template] * len(images_pil),
        add_special_tokens=False,
        return_tensors="pt",
        padding=True,
    ).to("cuda")

    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=4096,
            do_sample=False,
            use_cache=True,
        )

    decoded_texts = tokenizer.batch_decode(outputs, skip_special_tokens=True)

    for i, raw_text in enumerate(decoded_texts):
        _, txt_out_path = valid_items[i]
        clean_text = strip_output(raw_text)
        if not clean_text.strip():
            logger.warning(f"Tühi väljund: {os.path.basename(txt_out_path)} — mudel ei genereerinud teksti")
        with open(txt_out_path, "w", encoding="utf-8") as f:
            f.write(clean_text)
        logger.info(f"Transkribeeritud: {os.path.basename(txt_out_path)}")

    for img in images_pil:
        img.close()
    del inputs, outputs, decoded_texts, images_pil
    torch.cuda.empty_cache()

# --- 4. PEAMINE TÖÖTSÜKKEL ---

HEARTBEAT_INTERVAL = 60

def main_loop():
    last_heartbeat = time.time()

    # Loo alamkaustad kui puuduvad
    for mt in MODEL_CONFIGS:
        Path(BASE_OCR_KAUST, mt).mkdir(parents=True, exist_ok=True)

    while not shutdown_requested:
        # 1. Paki lahti PDF-id mõlemas alamkaustas
        for mt in MODEL_CONFIGS:
            scan_root = Path(BASE_OCR_KAUST, mt)
            for pdf in list(scan_root.rglob("*.pdf")):
                if shutdown_requested:
                    break
                expand_pdf(pdf)

        # 2. Kogu töötlemata pildid tüübi järgi
        tasks_by_type: dict = {mt: [] for mt in MODEL_CONFIGS}

        for mt in MODEL_CONFIGS:
            scan_root = Path(BASE_OCR_KAUST, mt)
            candidates = natsorted(
                [f for f in scan_root.rglob("*")
                 if f.suffix.lower() in EXTENSIONS and f.is_file()],
                key=lambda x: str(x)
            )
            tasks_by_type[mt] = [
                (str(img), str(img.with_suffix(".txt")))
                for img in candidates
                if not img.with_suffix(".txt").exists()
            ]

        total = sum(len(v) for v in tasks_by_type.values())

        # 3. Töötle tüüp-tüübi kaupa (minimeerib mudeli vahetusi)
        if total > 0:
            logger.info(f"Leidsin {total} pilti ({', '.join(f'{mt}:{len(tasks_by_type[mt])}' for mt in MODEL_CONFIGS)}).")
            for mt, tasks in tasks_by_type.items():
                if not tasks or shutdown_requested:
                    continue
                ensure_model(mt)
                for i in range(0, len(tasks), BATCH_SIZE):
                    if shutdown_requested:
                        break
                    batch = tasks[i:i + BATCH_SIZE]
                    logger.info(f"[{mt}] Töötlen {i+1}–{min(i+BATCH_SIZE, len(tasks))} / {len(tasks)}")
                    process_batch(batch)
                    gc.collect()
            logger.info("Kõik hetke tööd tehtud. Ootan uusi...")
            last_heartbeat = time.time()
        else:
            if time.time() - last_heartbeat >= HEARTBEAT_INTERVAL:
                logger.info("Heartbeat: teenus töötab, ootan uusi faile...")
                last_heartbeat = time.time()

        time.sleep(5)

    logger.info("Teenus peatatud.")

if __name__ == "__main__":
    try:
        main_loop()
    except KeyboardInterrupt:
        logger.info("Skript peatatud (Ctrl+C).")
    except Exception as e:
        logger.exception(f"Kriitiline viga: {e}")
        sys.exit(1)
