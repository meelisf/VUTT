"""HTR-võrdlus OpenRouteri kaudu: üks lehekülg, mitu mudelit, CER/WER + hind.

Käivitus: `.venv/bin/python bench.py 2` (jookse mudeli kohta), siis `score.py`.
Võti loetakse repo `.env`-ist (`OPENROUTER_API…`) ja seda ei prindita.
Testpilt EI ole repos (2 MB telefonifoto) — `BASE` osutab kohalikule failile;
võrdlustekst on siinsamas `inimese_transkriptsioon_lk003.txt`.
"""
import base64, io, json, re, sys, time, unicodedata
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
from PIL import Image

sys.path.insert(0, "/home/mf/LLM/VUTT")
from server.ocr_prompts import GEMINI_HAND_INSTRUCTION, strip_model_output  # noqa

OUT = Path(__file__).parent / "out"
OUT.mkdir(exist_ok=True)
BASE = "/home/mf/Pictures/test/1745-berichte-von-der-insel-oesel-osel-saaremaa-und-dagden-dago-hiiumaa-1745-188-m3do2t_lk003"


def api_key():
    # Võti ainult mällu, mitte väljundisse
    for line in Path("/home/mf/LLM/VUTT/.env").read_text().splitlines():
        if line.startswith("OPENROUTER_API"):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("võti puudub")


KEY = api_key()

im = Image.open(BASE + ".jpeg")
im.thumbnail((4000, 4000))
buf = io.BytesIO()
im.convert("RGB").save(buf, "JPEG", quality=90)
IMG = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
GT = Path(BASE + ".txt").read_text()


def call(model, effort, run):
    body = {
        "model": model,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": GEMINI_HAND_INSTRUCTION},
            {"type": "text", "text": "TRANSKRIBEERI JÄRGMINE PILT:"},
            {"type": "image_url", "image_url": {"url": IMG}},
            {"type": "text", "text": "Transkribeeri ülalolev sihtpilt. Tagasta ainult transkriptsioon."},
        ]}],
        "max_tokens": 16000,
        "usage": {"include": True},
    }
    if effort:
        body["reasoning"] = {"effort": effort}
    t0 = time.time()
    try:
        r = requests.post("https://openrouter.ai/api/v1/chat/completions",
                          headers={"Authorization": "Bearer " + KEY}, json=body, timeout=600)
        d = r.json()
    except Exception as e:
        return {"model": model, "effort": effort, "run": run, "error": repr(e)[:200]}
    dt = time.time() - t0
    if "error" in d or not d.get("choices"):
        return {"model": model, "effort": effort, "run": run,
                "error": json.dumps(d.get("error", d))[:300]}
    text = strip_model_output(d["choices"][0]["message"].get("content") or "")
    u = d.get("usage") or {}
    rec = {"model": model, "effort": effort, "run": run, "secs": round(dt, 1),
           "cost": u.get("cost"), "in_tok": u.get("prompt_tokens"),
           "out_tok": u.get("completion_tokens"),
           "reason_tok": (u.get("completion_tokens_details") or {}).get("reasoning_tokens"),
           "provider": d.get("provider"), "text": text}
    fn = OUT / "{}__{}__{}.txt".format(model.replace("/", "_").replace("~", ""), effort or "none", run)
    fn.write_text(text)
    return rec


MODELS = [
    ("google/gemini-3.8-flash", "low"),
    ("google/gemini-3.8-flash", "high"),
    ("~google/gemini-pro-latest", "low"),
    ("google/gemini-3.5-flash-lite", "low"),
    ("openai/gpt-6.1-sol", "low"),
    ("openai/gpt-6-luna", "low"),
    ("openai/gpt-6-astra", "low"),
    ("anthropic/claude-sonnet-5.5", "low"),
    ("anthropic/claude-opus-5.5", "low"),
    ("anthropic/claude-fable-5.1", "low"),
    ("qwen/qwen3.8-max-0902", "low"),
    ("qwen/qwen3.8-flash", "low"),
    ("x-ai/grok-4.7", "low"),
    ("moonshotai/kimi-k3", "low"),
    ("meta/muse-spark-1.3", "low"),
    ("mistralai/mistral-medium-3-5", "low"),
    ("z-ai/glm-5v-turbo", "low"),
    ("xiaomi/mimo-v2.6-pro", "low"),
    ("deepseek/deepseek-v4-flash-vision-exp", "low"),
    ("google/gemma-4-31b-it", "low"),
]

if __name__ == "__main__":
    runs = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    jobs = [(m, e, r) for m, e in MODELS for r in range(1, runs + 1)]
    with ThreadPoolExecutor(12) as ex:
        res = list(ex.map(lambda j: call(*j), jobs))
    (OUT / "results.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))
    for x in res:
        print(x["model"], x["effort"], x["run"], "ERR " + x["error"] if "error" in x else
              "ok ${} {}s".format(x["cost"], x["secs"]))
