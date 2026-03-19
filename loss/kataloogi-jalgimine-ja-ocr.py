# -*- coding: utf-8 -*-
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
from pathlib import Path
from datetime import datetime
from PIL import Image as PILImage
from pdf2image import convert_from_path
from unsloth import FastVisionModel
from natsort import natsorted

# --- 0. LOGIMINE JA SIGNAALID ---

SCRIPT_DIR = Path(__file__).resolve().parent
LOG_FILE = SCRIPT_DIR / "ocr-service.log"

# Flush-iga FileHandler, et logid kohe faili jõuaksid
class FlushFileHandler(logging.FileHandler):
    def emit(self, record):
        super().emit(record)
        self.flush()

# Eemalda olemasolevad handlerid (juhuks kui reimport)
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
    force=True  # Kirjuta üle varasemad seadistused
)
logger = logging.getLogger(__name__)

# Graceful shutdown
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

# Kaust, mida jälgida (skript vaatab ka selle alamkaustadesse)
JALGITAV_KAUST = "/home/mf/Dokumendid/LLM/AUTO-OCR"

MODEL_PATH = "qwen-ocr-finetuned-greek"

# RTX 5090 (32GB) on väga võimas. Võime olla agressiivsed.
BATCH_SIZE = 4          # Mitu pilti korraga mälus töödeldakse
MAX_SIDE = 2048         # Pildi pikem külg (LLM näeb paremini detaile suurelt)
PDF_DPI = 300           # PDF -> JPG kvaliteet

# Toetatud pildiformaadid
EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}

# Ajaloolise teksti prompt
PROMPT = """**Task:** You are an expert OCR assistant specializing in historical documents. Your task is to transcribe the text from the provided image with maximum accuracy.

**Instructions:**
1.  Transcribe all **complete** pages of text.
2.  If two pages are present, use `[LEFT PAGE]` and `[RIGHT PAGE]` markers.
3.  Preserve original line breaks and hyphenation.
4.  **Handle Historical Characters with Extreme Precision:**
    *   **Long S (`ſ`):** Distinguish it carefully from `f`.
    *   **Ligatures:** Pay attention to `ſſ`, `ſi`, `ſt`, `æ`, `œ`.
5.  Transcribe in the original language. **Do not translate.**
6.  Note page numbers if visible.
7.  Do not add, remove, or creatively alter words.

**Output Format:** Plain text within a single Markdown code block."""

# --- 2. MUDELI LAADIMINE ---

logger.info("=== Käivitan In-Place OCR Teenuse ===")
logger.info(f"Jälgin kausta: {JALGITAV_KAUST}")
logger.info(f"Logi fail: {LOG_FILE}")

if not torch.cuda.is_available():
    logger.error("CUDA puudub!")
    raise RuntimeError("CUDA puudub!")

logger.info(f"Laen mudelit: {MODEL_PATH} ...")
model, tokenizer = FastVisionModel.from_pretrained(
    model_name=MODEL_PATH,
    load_in_4bit=True,
)
FastVisionModel.for_inference(model)
logger.info("Mudel laetud ja ootel.")

# --- 3. ABIFUNKTSIOONID ---

def get_chat_template():
    return tokenizer.apply_chat_template(
        [{"role": "user", "content": [{"type": "text", "text": PROMPT}, {"type": "image"}]}],
        add_generation_prompt=True, tokenize=False
    )

CHAT_TEMPLATE = get_chat_template()

def strip_output(text: str) -> str:
    markers = [PROMPT, "</assistant>", "<|assistant|>", "<|im_start|>assistant", "assistant\n"]
    for m in markers:
        if m in text:
            text = text.split(m, 1)[-1]
    return text.strip().strip("```")

def sanitize_filename(name: str) -> str:
    """
    Teisendab failinime ASCII-sõbralikuks:
    - Asendab tühikud alakriipsuga
    - Normaliseerib unicode (ä->a, ß->ss, jne)
    - Eemaldab erimärgid
    """
    # Unicode normaliseerimine (NFD lahutab täpitähed osadeks)
    name = unicodedata.normalize('NFD', name)
    # Eemalda diakriitikud (combining marks)
    name = ''.join(c for c in name if unicodedata.category(c) != 'Mn')
    # Erikäsitlus saksa ß -> ss
    name = name.replace('ß', 'ss')
    # Asenda tühikud alakriipsuga
    name = name.replace(' ', '_')
    # Jäta alles ainult ASCII tähed, numbrid, alakriips, sidekriips, punkt
    name = re.sub(r'[^a-zA-Z0-9_\-.]', '', name)
    # Eemalda mitu järjestikust alakriipsu
    name = re.sub(r'_+', '_', name)
    return name.strip('_')

def wait_for_file_stable(file_path, check_interval=2, stable_count=2):
    """
    Ootab kuni fail on stabiilne (suurus ei muutu).
    Kasulik suurte failide kopeerimise ootamiseks.
    
    Args:
        file_path: Faili tee
        check_interval: Mitu sekundit oodata kontrollide vahel
        stable_count: Mitu korda peab suurus sama olema, et lugeda stabiilseks
    
    Returns:
        True kui fail on stabiilne, False kui faili pole või shutdown
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
    Kui leiame PDF-i, tekitame samanimelise kausta ja paneme pildid sinna.
    Nt: raamat.pdf -> kaust 'raamat' -> raamat_001.jpg, raamat_002.jpg
    Vigased PDF-id teisaldatakse VIGASED/ kausta.
    """
    pdf_path = Path(pdf_path)
    
    # Jäta vahele juba ebaõnnestunud PDF-id
    if str(pdf_path) in failed_pdfs:
        return
    
    # Oota kuni fail on stabiilne (kopeerimine lõppenud)
    if not wait_for_file_stable(pdf_path):
        logger.info(f"PDF {pdf_path.name} pole veel stabiilne, jätan vahele...")
        return
    
    # Sanitseeri kausta ja failide nimi
    safe_name = sanitize_filename(pdf_path.stem)
    output_dir = pdf_path.parent / safe_name
    
    # Kui kaust on juba olemas ja seal on pilte, siis eeldame, et on juba lahti pakitud
    # (Väldime korduvat lahtipakkimist iga tsükkel)
    if output_dir.exists() and any(output_dir.iterdir()):
        return

    logger.info(f"Leidsin PDFi: {pdf_path.name}. Pakin lahti kausta: {output_dir.name}...")
    output_dir.mkdir(exist_ok=True)
    
    try:
        images = convert_from_path(str(pdf_path), dpi=PDF_DPI, fmt='jpg')
        for i, img in enumerate(images):
            # Salvestame saniteeritud nimega: raamat_pg_001.jpg
            fname = output_dir / f"{safe_name}_pg_{i+1:03d}.jpg"
            img.save(fname, "JPEG", quality=95)
        logger.info(f"PDF lahti pakitud: {len(images)} lehte.")
    except Exception as e:
        logger.error(f"Viga PDF lahtipakkimisel {pdf_path}: {e}")
        failed_pdfs.add(str(pdf_path))
        
        # Teisalda vigane PDF VIGASED kausta
        vigased_dir = Path(JALGITAV_KAUST) / "VIGASED"
        vigased_dir.mkdir(exist_ok=True)
        try:
            dest = vigased_dir / pdf_path.name
            shutil.move(str(pdf_path), str(dest))
            logger.info(f"Vigane PDF teisaldatud: {dest}")
            # Eemalda tühi kaust kui see loodi
            if output_dir.exists() and not any(output_dir.iterdir()):
                output_dir.rmdir()
        except Exception as move_err:
            logger.error(f"Ei suutnud vigast PDF-i teisaldada: {move_err}")

def process_batch(batch_items):
    """
    Võtab sisse listi tuple'itest: (pildi_täistee, txt_väljundi_täistee)
    """
    if not batch_items: return

    images_pil = []
    valid_items = []

    # 1. Piltide laadimine
    for img_path, txt_path in batch_items:
        try:
            img = PILImage.open(img_path).convert("RGB")
            
            # Resize ainult siis kui väga suur (mälu kokkuhoid, kuigi 5090 kannatab palju)
            w, h = img.size
            scale = min(MAX_SIDE / max(w, h), 1.0)
            if scale < 1.0:
                img = img.resize((int(w * scale), int(h * scale)), resample=PILImage.LANCZOS)
            
            images_pil.append(img)
            valid_items.append((img_path, txt_path))
        except Exception as e:
            logger.error(f"Viga pildi avamisel {img_path}: {e}")

    if not images_pil:
        return

    # 2. Tokeniseerimine ja inference
    inputs = tokenizer(
        images_pil,
        [CHAT_TEMPLATE] * len(images_pil),
        add_special_tokens=False,
        return_tensors="pt",
        padding=True,
    ).to("cuda")

    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=3000,
            do_sample=False,
            use_cache=True,
        )

    decoded_texts = tokenizer.batch_decode(outputs, skip_special_tokens=True)

    # 3. Salvestamine
    for i, raw_text in enumerate(decoded_texts):
        _, txt_out_path = valid_items[i]
        clean_text = strip_output(raw_text)
        
        with open(txt_out_path, "w", encoding="utf-8") as f:
            f.write(clean_text)
        
        logger.info(f"Transkribeeritud: {os.path.basename(txt_out_path)}")

    # Cleanup
    for img in images_pil: img.close()
    del inputs, outputs, decoded_texts, images_pil
    torch.cuda.empty_cache()

# --- 4. PEAMINE TÖÖTSÜKKEL ---

HEARTBEAT_INTERVAL = 60  # Heartbeat iga 60 sekundi tagant

def main_loop():
    last_heartbeat = time.time()
    
    while not shutdown_requested:
        # 1. Otsi PDF-e ja paki lahti, kui vaja
        #    Otsib rekursiivselt kõiki .pdf faile
        pdf_files = list(Path(JALGITAV_KAUST).rglob("*.pdf"))
        for pdf in pdf_files:
            if shutdown_requested:
                break
            expand_pdf(pdf)

        # 2. Otsi pilte, millel PUUDUB .txt fail
        #    Kogume kokku kõik tööd vajavad failid
        tasks_queue = []
        
        # rglob otsib rekursiivselt
        all_files = Path(JALGITAV_KAUST).rglob("*")
        
        image_candidates = [
            f for f in all_files 
            if f.suffix.lower() in EXTENSIONS and f.is_file()
        ]
        
        # Sorteerime, et tööjärg oleks loogiline (kaustade kaupa)
        image_candidates = natsorted(image_candidates, key=lambda x: str(x))

        for img_path in image_candidates:
            # Tuletame txt faili nime: pilt.jpg -> pilt.txt
            txt_path = img_path.with_suffix('.txt')
            
            # Kui txt faili pole, lisame järjekorda
            if not txt_path.exists():
                tasks_queue.append((str(img_path), str(txt_path)))

        # 3. Töötle leitud faile
        total_tasks = len(tasks_queue)
        
        if total_tasks > 0:
            logger.info(f"Leidsin {total_tasks} pilti, mis vajavad transkribeerimist.")
            
            # Jagame batchideks
            for i in range(0, total_tasks, BATCH_SIZE):
                if shutdown_requested:
                    break
                batch = tasks_queue[i : i + BATCH_SIZE]
                logger.info(f"Töötlen batchi {i//BATCH_SIZE + 1} / {(total_tasks // BATCH_SIZE) + 1}")
                process_batch(batch)
                
                # Väike mälu puhastus iga batchi vahel
                gc.collect() 
            
            logger.info("Kõik hetke tööd tehtud. Ootan uusi...")
            last_heartbeat = time.time()
        
        else:
            # Heartbeat iga HEARTBEAT_INTERVAL sekundi tagant
            if time.time() - last_heartbeat >= HEARTBEAT_INTERVAL:
                logger.info("Heartbeat: teenus töötab, ootan uusi faile...")
                last_heartbeat = time.time()

        # Oota enne uut skaneerimist (nt 5 sekundit)
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