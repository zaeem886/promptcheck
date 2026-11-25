# %% Install the training dependencies
# Kaggle already supplies PyTorch and CUDA. Only the first cell needs Internet.
import subprocess
import sys

if "ipykernel" in sys.modules:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-q",
                           "Faker==39.1.0", "phonenumbers==9.0.44",
                           "schwifty==2026.11.4", "onnx>=1.16,<2", "onnxruntime>=1.20,<2"])

# %% Choose the corpus size, GPU and output folder
import hashlib
import importlib.metadata as metadata
import json
import os
import random
import statistics
import string
import time
import unicodedata
import zipfile
from collections import Counter, defaultdict
from functools import lru_cache
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import phonenumbers as pn
import pycountry
import torch
from faker import Faker
from faker.config import AVAILABLE_LOCALES
from schwifty import IBAN, registry
from schwifty.exceptions import InvalidCountryCode
from torch import nn
from torch.utils.data import DataLoader

SMOKE = os.getenv("PP_SMOKE") == "1"  # Set True for a quick pipeline check.
SEED = 3801
SIZES = dict(zip(("train", "validation", "test"), (240, 80, 80) if SMOKE else (100_000, 5_000, 5_000)))
EPOCHS, BATCH_SIZE = (1, 32) if SMOKE else (12, 96)
MODEL_WIDTH = 64
LEARNING_RATE = .0007
PATIENCE = 4
EXTRA_DATA = None  # Optional Path("/kaggle/input/YOUR-DATASET") with three JSONL files.
OUTPUT = Path(os.getenv("PP_OUTPUT", "/kaggle/working/promptprivacy-global"))
OUTPUT.mkdir(parents=True, exist_ok=True)
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
torch.manual_seed(SEED)
torch.set_num_threads(min(4, torch.get_num_threads()))
Faker.seed(SEED)
KINDS = ("PERSON", "ADDRESS", "PHONE", "EMAIL", "NATIONAL_ID", "PASSPORT",
         "BANK_ACCOUNT", "IBAN", "PAYMENT_CARD", "API_KEY", "PASSWORD", "PIN")
TAGS = ["O"] + [f"{prefix}-{kind}" for kind in KINDS for prefix in ("B", "I")]
BEGIN = {kind: TAGS.index("B-" + kind) for kind in KINDS}
print("Training device:", DEVICE, "documents:", SIZES, "smoke run:", SMOKE)

# %% Define international formats and multilingual field names
# Localized Faker methods are used only when the installed locale defines the
# relevant provider. This avoids counting a US fallback as another country.
LOCALES = sorted(loc for loc in AVAILABLE_LOCALES if len(loc.split("_")) == 2
                 and (loc.split("_")[1] == "XK" or pycountry.countries.get(alpha_2=loc.split("_")[1])))
PHONE_REGIONS = sorted(pn.SUPPORTED_REGIONS)
def iban_regions():
    regions = []
    for a in string.ascii_uppercase:
        for b in string.ascii_uppercase:
            try:
                spec = registry.get_iban_spec(a + b)
            except InvalidCountryCode:
                continue
            if not spec.aspirational:
                regions.append(a + b)
    return regions

IBAN_REGIONS = iban_regions()
ACCOUNT_REGIONS = [r for r in IBAN_REGIONS if "account_code" in registry.get_iban_spec(r).positions]
DOMESTIC = {"AU": (6, 9), "CA": (7, 12), "GB": (8, 8), "IN": (9, 18),
            "JP": (7, 7), "NZ": (15, 16), "US": (8, 17), "PK": (10, 16)}
# Domestic numbers are length/shape examples. Bank-specific routing and
# checksum rules aren't modeled. Payment card networks are international.
CAPTIONS = {
    "en": ("name","home address","phone","email","national ID","passport","account number","IBAN","debit card","API key","password","PIN"),
    "es": ("nombre","domicilio","teléfono","correo","identificación","pasaporte","número de cuenta","IBAN","tarjeta","clave API","contraseña","PIN"),
    "fr": ("nom","adresse","téléphone","courriel","identifiant national","passeport","compte bancaire","IBAN","carte bancaire","clé API","mot de passe","code PIN"),
    "de": ("Name","Anschrift","Telefon","E-Mail","Steuer-ID","Reisepass","Kontonummer","IBAN","Kartennummer","API-Schlüssel","Passwort","PIN"),
    "pt": ("nome","endereço","telefone","e-mail","identificação","passaporte","conta bancária","IBAN","cartão","chave de API","senha","PIN"),
    "ar": ("الاسم","العنوان","الهاتف","البريد الإلكتروني","رقم الهوية","جواز السفر","رقم الحساب","آيبان","رقم البطاقة","مفتاح API","كلمة المرور","الرقم السري"),
    "ur": ("نام","پتہ","فون نمبر","ای میل","شناختی نمبر","پاسپورٹ","اکاؤنٹ نمبر","آئی بین","کارڈ نمبر","اے پی آئی کلید","پاس ورڈ","پن"),
    "hi": ("नाम","पता","फ़ोन","ईमेल","पहचान संख्या","पासपोर्ट","खाता संख्या","आईबीएएन","कार्ड नंबर","एपीआई कुंजी","पासवर्ड","पिन"),
    "zh": ("姓名","住址","电话号码","电子邮箱","身份证号","护照号","银行账号","国际银行账号","银行卡号","API密钥","密码","银行卡密码"),
    "ja": ("氏名","住所","電話番号","メール","個人番号","旅券番号","口座番号","IBAN","カード番号","APIキー","パスワード","暗証番号"),
}
PREFIXES = {
    "train": ("", "Please check this entry.\n", "Details for the update: ", "Copy below → ", "注記：", "براہ کرم دیکھیں۔ "),
    "validation": ("Here is my correction.\n", "Valeur transmise : ", "入力内容："),
    "test": ("From the support transcript:\n", "Dato recibido → ", "اپ ڈیٹ: "),
}
# A distinct set of outer templates per split, with varied formatting inside.
WRAPPERS = {
    "train": ("{k}: {v}", "{k} = '{v}'", "«{v}» ({k})", '"{k}":"{v}"', "{k} → {v}"),
    "validation": ("{k} | {v}", "{v} [{k}]", "• {k}\n{v}"),
    "test": ("{k} was entered as {v}", "〔{k}〕{v}", "{v}  // {k}"),
}
BENIGN = {
    "train": ("The parcel weighs {} grams.", "Product SKU {} is on sale.", "Page {} lists the account policies.", "Build {} passed all tests."),
    "validation": ("Stock remaining: {} units.", "Refer to document revision {}.", "Library shelf {} is closed."),
    "test": ("Move {} boxes to aisle four.", "Invoice reference {} needs review.", "Issue {} discusses password length."),
}
NO_VALUE = {
    "train": ("Please remove the password field.", "Email is optional.", "カード番号は未入力です。"),
    "validation": ("I left my PIN blank.", "Aucun numéro de compte fourni."),
    "test": ("Can I reset my password?", "El formulario solicita un teléfono.", "شناختی نمبر درج نہیں ہے۔"),
}
PHRASES = {
    "train": ("My {k} is {v}", "Please update my {k} to {v}", "Use {v} for my {k}"),
    "validation": ("I wrote {v} under {k}", "Their recorded {k} reads {v}"),
    "test": ("For the {k} field I gave them {v}", "That {k} should read {v}"),
}
# Natural requests carry clues even when the literal field name is absent.
CONTEXT = {
    "PHONE": ("Llámame al {v} después de las cinco.", "للتواصل معي اتصل على {v}.", "A callback would reach me at {v}."),
    "EMAIL": ("Écrivez-moi à {v} demain.", "返信は{v}までお願いします。", "Would you forward the notes to {v}?"),
    "IBAN": ("Bitte an {v} überweisen.", "Envoyez le virement à {v}.", "La transferencia debe llegar a {v}."),
    "BANK_ACCOUNT": ("Please deposit it into {v}.", "اس اکاؤنٹ میں بھیجیں: {v}۔", "振込先の口座は{v}です。"),
    "PAYMENT_CARD": ("Cobren la compra a la tarjeta {v}.", "I paid with debit card {v}.", "Le numéro sur ma carte est {v}."),
    "NATIONAL_ID": ("Mi identificación dice {v}.", "میرا شناختی نمبر {v} ہے۔", "They copied {v} from my identity card."),
    "PASSPORT": ("Mi documento de viaje lleva el número {v}.", "Le numéro de mon passeport est {v}.", "My travel document is numbered {v}."),
    "API_KEY": ("Set the API credential to {v} before starting.", "انسخ مفتاح الخدمة {v}.", "Pour authentifier la requête, utilisez {v}."),
    "PASSWORD": ("Me conecto con la frase {v}.", "ログイン用のパスワードは{v}です。", "The words I use to sign in are {v}."),
    "PIN": ("At the ATM I enter {v}.", "Le code du distributeur est {v}.", "کارڈ کا خفیہ پن {v} ہے۔"),
    "PERSON": ("La réservation est au nom de {v}.", "Please address the letter to {v}.", "میرا نام {v} ہے۔"),
    "ADDRESS": ("Please deliver the parcel to {v}.", "Envía la carta a {v}.", "郵送先は{v}です。"),
}
LONG_FILLER = ("Please keep the same order when editing these notes. ",
               "Les paragraphes suivants décrivent le fonctionnement du service. ",
               "Die Reihenfolge der Abschnitte soll erhalten bleiben. ",
               "次の文章を読み、自然な文に書き直してください。")

@lru_cache(maxsize=None)
def phone_shapes(region):
    shapes = set()
    for kind in (pn.PhoneNumberType.MOBILE, pn.PhoneNumberType.FIXED_LINE):
        number = pn.example_number_for_type(region, kind)
        if number:
            for style in (pn.PhoneNumberFormat.E164, pn.PhoneNumberFormat.NATIONAL, pn.PhoneNumberFormat.INTERNATIONAL):
                shapes.add(pn.format_number(number, style))
    return sorted(shapes)

PHONE_REGIONS = [region for region in PHONE_REGIONS if phone_shapes(region)]

def local_provider(fake, provider, locale):
    module = f"faker.providers.{provider}.{locale}"
    return any(type(item).__module__ == module for item in fake.get_providers())

def localized_pools(seed):
    pools = defaultdict(list)
    for idx, locale in enumerate(LOCALES):
        fake = Faker(locale)
        fake.seed_instance(seed + idx)
        for kind, provider in (("PERSON","person"), ("ADDRESS","address"), ("NATIONAL_ID","ssn"), ("PASSPORT","passport")):
            if local_provider(fake, provider, locale):
                pools[kind].append((locale.split("_")[1], fake))
    return pools

def random_chars(rng, alphabet, n):
    return "".join(rng.choices(alphabet, k=n))

def digits(rng, n):
    return random_chars(rng, string.digits, n)

def value_for(kind, rng, pools, card_faker):
    if kind == "PHONE":
        region = rng.choice(PHONE_REGIONS)
        shape = rng.choice(phone_shapes(region))
        # Vary subscriber digits, preserving the provider's separators/prefix.
        chars = list(shape)
        positions = [i for i, ch in enumerate(chars) if ch.isdecimal()]
        for i in positions[-min(5, len(positions) - 3):]:
            chars[i] = rng.choice(string.digits)
        return "".join(chars), region
    if kind == "IBAN":
        region = rng.choice(IBAN_REGIONS)
        account = IBAN.random(country_code=region, use_registry=False, random=rng)
        return (account.formatted if rng.getrandbits(1) else str(account)), region
    if kind == "BANK_ACCOUNT":
        if rng.random() < .55:
            region = rng.choice(ACCOUNT_REGIONS)
            return IBAN.random(country_code=region, use_registry=False, random=rng).account_code, region
        region = rng.choice(sorted(DOMESTIC))
        return digits(rng, rng.randint(*DOMESTIC[region])), region
    if kind == "NATIONAL_ID" and rng.randrange(8) == 0:
        return f"{digits(rng,5)}-{digits(rng,7)}-{digits(rng,1)}", "PK"
    if kind == "PASSPORT" and rng.random() < .5:
        shape = rng.choice(("A#######", "AA#######", "#########", "## ## ######", "A########", "AA######"))
        value = "".join(rng.choice(string.ascii_uppercase) if c == "A" else rng.choice(string.digits) if c == "#" else c for c in shape)
        return value, "generic"
    if kind in ("PERSON", "ADDRESS", "NATIONAL_ID", "PASSPORT"):
        region, fake = rng.choice(pools[kind])
        method = {"PERSON":"name", "ADDRESS":"address", "NATIONAL_ID":"ssn", "PASSPORT":"passport_number"}[kind]
        return str(getattr(fake, method)()).strip(), region
    if kind == "PAYMENT_CARD":
        number = card_faker.credit_card_number(card_type=rng.choice(("visa", "mastercard", "amex", "discover", "jcb")))
        separator = rng.choice(("", " ", "-"))
        groups = [number[:4], number[4:10], number[10:]] if len(number) == 15 else [number[i:i+4] for i in range(0, len(number), 4)]
        return separator.join(groups), "global"
    if kind == "EMAIL":
        stem = rng.choice(("sam", "mira", "éloïse", "测试", "javed", "سارا", "olga", "info"))
        suffix = random_chars(rng, string.ascii_lowercase, rng.randint(3, 9))
        domain = rng.choice(("example.com", "example.net", "example.org", "mail.example", "例子.test", "service.test"))
        return f"{stem}{rng.choice(('.', '+', '_', ''))}{suffix}@{domain}", "global"
    if kind == "API_KEY":
        prefix, alphabet, length = rng.choice([
            ("sk-", string.ascii_letters + string.digits, 40), ("ghp_", string.ascii_letters + string.digits, 36),
            ("AKIA", string.ascii_uppercase + string.digits, 16), ("", string.hexdigits.lower()[:16], 32),
            ("key_", string.ascii_letters + string.digits + "_-", 32),
        ])
        return prefix + random_chars(rng, alphabet, length), "global"
    if kind == "PASSWORD":
        words = ("acorn", "beacon", "cactus", "drift", "elm", "fable", "garnet", "harbor",
                 "iris", "juniper", "kiwi", "lantern", "meadow", "nectar", "otter", "pebble",
                 "quartz", "raven", "spruce", "thistle", "umbra", "violet", "willow", "zephyr",
                 "星", "آم", "pluie", "lune", "casa", "azul", "morgen", "blume")
        style = rng.randrange(5)
        if style < 4:
            chosen = rng.choices(words, k=rng.randint(2, 5))
            if style == 0:
                chosen = [w.title() for w in chosen]
            value = rng.choice((" ", "-", "", "!", "_")).join(chosen)
            if style == 2:
                value += rng.choice(("!", "#", ".")) + digits(rng, rng.randint(1, 4))
            return value, "global"
        return random_chars(rng, string.ascii_letters + string.digits + "!@-_.", rng.randint(7, 23)), "global"
    if kind == "PIN":
        return digits(rng, rng.choice((4, 5, 6))), "global"
    raise ValueError(kind)

# %% Build distinct document splits and validate exact character spans
def normalized(value):
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())

def identity(kind, value):
    key = normalized(value)
    if kind in ("PHONE", "PAYMENT_CARD", "IBAN", "NATIONAL_ID", "BANK_ACCOUNT"):
        key = "".join(ch for ch in key if ch.isalnum())
        key = "".join(str(unicodedata.decimal(ch)) if ch.isdecimal() else ch for ch in key)
    return kind, key

def validate(row):
    text = row["text"]
    if not isinstance(text, str) or not text.strip() or not isinstance(row["spans"], list):
        raise ValueError("Expected nonempty text and a spans array")
    end = 0
    for span in row["spans"]:
        a, b = span["start"], span["end"]
        if (type(a) is not int or type(b) is not int or not end <= a < b <= len(text)
                or span["label"] not in BEGIN or not text[a:b].strip()):
            raise ValueError("Invalid or overlapping span. Use sorted Unicode code point offsets.")
        end = b

def benign_fragment(rng, split):
    number = rng.choice((digits(rng, 12), digits(rng, 4), f"{digits(rng,3)}-{digits(rng,4)}",
                         f"v{rng.randrange(10)}.{rng.randrange(80)}.{rng.randrange(1000)}",
                         "0x" + random_chars(rng, "ABCDEF0123456789", 8)))
    confusable = {
        "train": ("Tracking reference {} belongs to a parcel.", "The product code is {}.",
                  "The password field accepts {} characters.", "The stack pointer is {}."),
        "validation": ("Shipment ticket {} has been closed.", "There are {} entries in this list."),
        "test": ("Inventory item {} needs restocking.", "The report contains {} rows."),
    }
    return rng.choice((*BENIGN[split], *confusable[split])).format(number)

FOCUSED_CONTEXT = {
    "PASSWORD": {
        "train": ('The login password is "{v}".', "To sign in, enter {v} in the password box.",
                  "I changed my passphrase to {v} yesterday.", 'password: "{v}"',
                  "Agent: Which password did you set?\nCustomer: {v}", "| login password | {v} |"),
        "validation": ("My chosen password reads '{v}' in the setup notes.", "The passphrase saved for login was {v}."),
        "test": ("I supplied '{v}' as the password during enrollment.", "For authentication my password would be {v}."),
    },
    "PASSPORT": {
        "train": ("The passport number on my travel document is {v}.", 'passport_number: "{v}"',
                  "Travel agent: Your passport number?\nPassenger: {v}", "| passport number | {v} |"),
        "validation": ("The border form shows passport '{v}'.", "My travel document number is recorded as {v}."),
        "test": ("The airline requested my passport number, which is {v}.", "I registered passport '{v}' for this trip."),
    },
}

def build_generated(split, count, seed, earlier_values, seen_text):
    rng = random.Random(seed)
    pools = localized_pools(seed)
    card_faker = Faker("en_US")
    card_faker.seed_instance(seed)
    # Round-robin the primary positive class to avoid rare format starvation.
    schedule = [*KINDS, "PASSWORD", "PASSWORD", "PASSPORT", "PASSPORT"]
    rng.shuffle(schedule)
    next_kind = 0
    rows, current_values = [], set()
    while len(rows) < count:
        parts, spans = [], []
        prefix = rng.choice(PREFIXES[split])
        if rng.random() < .025:
            prefix += "".join(rng.choices(LONG_FILLER, k=rng.randint(6, 15))) + "\n"
        if rng.random() < .25:
            parts.append(prefix + benign_fragment(rng, split))
            if rng.random() < .45:
                lang = rng.choice(list(CAPTIONS))
                parts.append(" " + rng.choice(WRAPPERS[split]).format(k=rng.choice(CAPTIONS[lang]),
                             v=rng.choice(("[redacted]", "—", "N/A", "••••", "[omitted]"))))
            if rng.random() < .50:
                parts.append(" " + rng.choice(NO_VALUE[split]))
        else:
            primary = schedule[next_kind % len(schedule)]
            kinds = [primary]
            if rng.random() < .48:
                kinds += rng.sample([k for k in KINDS if k != primary], rng.randint(1, 3))
            lang = rng.choice(list(CAPTIONS))
            parts.append(prefix)
            if rng.random() < .25:
                parts.append(benign_fragment(rng, split) + "\n")
            for j, kind in enumerate(kinds):
                if j:
                    parts.append(rng.choice(("; ", "\n", " | ", ", ")))
                for attempt in range(100):
                    value, region = value_for(kind, rng, pools, card_faker)
                    if value and identity(kind, value) not in earlier_values:
                        break
                else:
                    raise ValueError(f"No new example for {kind}")
                if lang in ("ar", "ur", "hi") and kind in ("PHONE", "BANK_ACCOUNT", "PIN") and rng.random() < .4:
                    glyphs = {"ar":"٠١٢٣٤٥٦٧٨٩", "ur":"۰۱۲۳۴۵۶۷۸۹", "hi":"०१२३४५६७८९"}
                    value = value.translate(str.maketrans(string.digits, glyphs[lang]))
                caption = CAPTIONS[lang][KINDS.index(kind)]
                wrapper = rng.choice(WRAPPERS[split])
                if lang == "en" and rng.random() < .5:
                    wrapper = rng.choice(PHRASES[split])
                if rng.random() < .20:
                    wrapper = CONTEXT[kind][("train","validation","test").index(split)]
                if kind in FOCUSED_CONTEXT and rng.random() < .70:
                    wrapper = rng.choice(FOCUSED_CONTEXT[kind][split])
                # Some values have no field hint, as in pasted lists and prose.
                if kind in ("EMAIL", "PHONE", "PAYMENT_CARD", "IBAN", "PERSON", "ADDRESS") and rng.random() < .22:
                    wrapper = "{v}"
                left, right = wrapper.split("{v}")
                parts.append(left.format(k=caption))
                start = sum(map(len, parts))
                parts.extend((value, right.format(k=caption)))
                spans.append(dict(start=start, end=start + len(value), label=kind, region=region))
                assert "".join(parts)[start:start+len(value)] == value
            if rng.random() < .28:
                parts.append("\n" + benign_fragment(rng, split))
        doc = "".join(parts)
        key = normalized(doc)
        if key in seen_text:
            continue
        seen_text.add(key)
        for s in spans:
            current_values.add(identity(s["label"], doc[s["start"]:s["end"]]))
        if spans:
            next_kind += 1
        rows.append(dict(text=doc, spans=spans, source="generator"))
    earlier_values.update(current_values)
    return rows

def load_splits():
    earlier_values, seen_text, group_split, result = set(), set(), {}, {}
    for i, (split, size) in enumerate(SIZES.items()):
        rows = build_generated(split, size, SEED + 1001*i, earlier_values, seen_text)
        if EXTRA_DATA is not None:
            with (Path(EXTRA_DATA) / f"{split}.jsonl").open(encoding="utf-8") as stream:
                for line_no, line in enumerate(stream, 1):
                    if not line.strip():
                        continue
                    row = json.loads(line)
                    validate(row)
                    group = row.get("group_id")
                    if not isinstance(group, str) or not group or group_split.setdefault(group, split) != split:
                        raise ValueError(f"Missing or overlapping group at {split}:{line_no}")
                    key = normalized(row["text"])
                    if key in seen_text:
                        raise ValueError(f"Duplicate document at {split}:{line_no}")
                    seen_text.add(key)
                    row["source"] = "attached"
                    rows.append(row)
        for row in rows:
            validate(row)
        result[split] = rows
    return result

def coverage(rows):
    kinds = {kind: Counter() for kind in KINDS}
    for row in rows:
        for s in row["spans"]:
            kinds[s["label"]][s.get("region", "unspecified")] += 1
    return {"documents":len(rows), "benign":sum(not r["spans"] for r in rows),
            "sources":dict(Counter(r["source"] for r in rows)), "spans_by_region":kinds}

splits = load_splits()
data_report = {name: coverage(rows) for name, rows in splits.items()}
for name, info in data_report.items():
    print(name, info["documents"], "documents /", info["benign"], "benign")
    print({kind: (sum(by_region.values()), len(by_region)) for kind, by_region in info["spans_by_region"].items()})

# %% Encode Unicode text and window long documents without losing entities
BUCKETS = 4096
CORE, HALO = 256, 64
DILATIONS = (1, 2, 4, 8, 16)
assert HALO >= 2 * sum(DILATIONS)  # kernel 5 gives two positions of context per dilation

def encode(text):
    return np.fromiter(map(char_id, text), dtype=np.int16, count=len(text))

CHAR_GROUPS = ("Nd", "Lu", "Ll", "L", "M", "P", "Z")

def shape_group(ch):
    category = unicodedata.category(ch)
    for i, prefix in enumerate(CHAR_GROUPS):
        if category.startswith(prefix):
            return i
    return len(CHAR_GROUPS)

@lru_cache(maxsize=32768)
def char_id(ch):
    n = ord(ch)
    if n < 128:
        return n + 1
    group_size = BUCKETS // (len(CHAR_GROUPS) + 1)
    return 129 + group_size * shape_group(ch) + n % group_size

def windows(length):
    for start in range(0, length, CORE):
        stop = min(length, start + CORE)
        yield max(0, start - HALO), min(length, stop + HALO), start, stop

def encode_split(rows):
    pieces = []
    for doc_id, row in enumerate(rows):
        x = encode(row["text"])
        y = np.zeros(len(x), dtype=np.int8)
        for s in row["spans"]:
            a, b = s["start"], s["end"]
            y[a] = BEGIN[s["label"]]
            y[a+1:b] = y[a] + 1
        for left, right, start, stop in windows(len(x)):
            target = np.full(right-left, -100, dtype=np.int8)
            target[start-left:stop-left] = y[start:stop]
            pieces.append((x[left:right], target, doc_id, left, start, stop))
    return pieces

def collate(batch):
    width = max(len(item[0]) for item in batch)
    x = np.zeros((len(batch), width), dtype=np.int32)
    y = np.full_like(x, -100)
    for i, (ids, targets, *_) in enumerate(batch):
        x[i, :len(ids)] = ids
        y[i, :len(ids)] = targets
    return torch.from_numpy(x), torch.from_numpy(y), [item[2:] for item in batch]

pieces = {name: encode_split(rows) for name, rows in splits.items()}
print("Windows by split:", {k: len(v) for k,v in pieces.items()})

# %% Define the compact character model and exact-span scoring
class SpanCNN(nn.Module):
    def __init__(self, width=MODEL_WIDTH):
        super().__init__()
        self.embedding = nn.Embedding(129 + BUCKETS, width, padding_idx=0)
        # Start digits and characters of similar shape close together. Every
        # character embedding remains trainable, including punctuation.
        group_size = BUCKETS // (len(CHAR_GROUPS) + 1)
        groups = [shape_group(chr(i)) for i in range(128)] + [i // group_size for i in range(BUCKETS)]
        with torch.no_grad():
            prototypes = torch.randn(len(CHAR_GROUPS) + 1, width)
            self.embedding.weight[1:].mul_(.25).add_(prototypes[groups])
        self.layers = nn.ModuleList(nn.Conv1d(width, width, 5, padding=2*d, dilation=d) for d in DILATIONS)
        # Predict entity category and start/continuation separately so every
        # category supplies training signal for the same boundary decision.
        self.head = nn.Conv1d(width, len(KINDS) + 2, 1)
        self.dropout = nn.Dropout(.10)

    def forward(self, ids):
        mask = (ids != 0).unsqueeze(1)
        h = self.embedding(ids).transpose(1, 2)
        for layer in self.layers:
            h = (h + self.dropout(torch.relu(layer(h)))) * mask
        features = self.head(h).transpose(1, 2)
        categories, onset = features[:, :, 1:-1], features[:, :, -1:]
        begin = categories - nn.functional.softplus(-onset)
        inside = categories - nn.functional.softplus(onset)
        return torch.cat((features[:, :, :1], torch.stack((begin, inside), dim=-1).flatten(2)), dim=-1)

def decode(ids):
    spans, active, start = set(), None, 0
    for i, tag in enumerate([*ids, 0]):
        kind = KINDS[(tag-1)//2] if tag else None
        if tag and tag % 2 == 0 and active == kind:
            continue
        if active is not None:
            spans.add((active, start, i))
        # An isolated continuation starts a candidate at the current character.
        # Exact-span scoring still penalizes a late start or an early end.
        active, start = kind, i
    return spans

def metrics(tp, fp, fn):
    return {"tp":tp, "fp":fp, "fn":fn, "precision":tp/max(1,tp+fp), "recall":tp/max(1,tp+fn),
            "f1":2*tp/max(1,2*tp+fp+fn)}

def score(rows, cut, predict):
    streams = [np.empty(len(row["text"]), dtype=np.int16) for row in rows]
    for x, _, offsets in DataLoader(cut, batch_size=BATCH_SIZE, collate_fn=collate):
        tags = predict(x)
        for seq, (doc_id, left, a, b) in zip(tags, offsets):
            streams[doc_id][a:b] = seq[a-left:b-left]
    return score_spans(rows, (decode(ids.tolist()) for ids in streams))

def score_spans(rows, predictions):
    counts = {kind:[0,0,0] for kind in KINDS}
    by_source = defaultdict(lambda: [0,0,0])
    by_region = defaultdict(lambda: defaultdict(lambda: {"support":0, "exact_hits":0}))
    false_alarms = benign = 0
    for row, found in zip(rows, predictions, strict=True):
        truth = {(s["label"], s["start"], s["end"]) for s in row["spans"]}
        for s in row["spans"]:
            cell = by_region[s["label"]][s.get("region", "unspecified")]
            cell["support"] += 1
            cell["exact_hits"] += (s["label"], s["start"], s["end"]) in found
        benign += not truth
        false_alarms += int(not truth and bool(found))
        for index, items in enumerate((truth & found, found - truth, truth - found)):
            by_source[row["source"]][index] += len(items)
            for kind, _, _ in items:
                counts[kind][index] += 1
    return {"overall":metrics(*map(sum, zip(*counts.values()))), "by_category":{k:metrics(*v) for k,v in counts.items()},
            "by_source":{k:metrics(*v) for k,v in by_source.items()}, "benign_documents":benign,
            "benign_false_alarms":false_alarms, "regional_recall_counts":by_region}

# %% Train on Kaggle and choose a checkpoint using validation F1
model = SpanCNN().to(DEVICE)
optimizer = torch.optim.AdamW(model.parameters(), lr=LEARNING_RATE)
scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode="max", patience=1, factor=.5)
tag_counts = np.bincount(np.concatenate([y[y >= 0] for _, y, *_ in pieces["train"]]), minlength=len(TAGS))
weights = np.clip((max(tag_counts)/np.maximum(1,tag_counts))**.35, 1, 6).astype(np.float32)
loss_fn = nn.CrossEntropyLoss(weight=torch.from_numpy(weights).to(DEVICE), ignore_index=-100)
train_loader = DataLoader(pieces["train"], batch_size=BATCH_SIZE, shuffle=True, collate_fn=collate,
                          generator=torch.Generator().manual_seed(SEED))
train_sample = splits["train"][:min(1000, len(splits["train"]))]
train_sample_pieces = encode_split(train_sample)
best_f1, best_epoch, history = -1, 0, []
for epoch in range(1, EPOCHS + 1):
    model.train()
    loss_sum, batches = 0., 0
    for x, y, _ in train_loader:
        optimizer.zero_grad(set_to_none=True)
        logits = model(x.to(DEVICE))
        loss = loss_fn(logits.transpose(1, 2), y.to(DEVICE, dtype=torch.long))
        loss.backward()
        nn.utils.clip_grad_norm_(model.parameters(), 3.)
        optimizer.step()
        loss_sum += loss.item()
        batches += 1
    model.eval()
    with torch.inference_mode():
        result = score(splits["validation"], pieces["validation"],
                       lambda x: model(x.to(DEVICE)).argmax(-1).cpu().numpy())
        training_result = score(train_sample, train_sample_pieces,
                               lambda x: model(x.to(DEVICE)).argmax(-1).cpu().numpy())
    f1 = result["overall"]["f1"]
    history.append({"epoch":epoch, "loss":loss_sum/max(1,batches),
                    "learning_rate":optimizer.param_groups[0]["lr"],
                    "train_sample":training_result, "validation":result})
    print(f"Epoch {epoch}: loss {loss_sum/max(1,batches):.4f}, train sample F1 "
          f"{training_result['overall']['f1']:.4f}, validation F1 {f1:.4f}", flush=True)
    print("Validation by category:", {k:round(v["f1"],3) for k,v in result["by_category"].items()}, flush=True)
    scheduler.step(f1)
    if f1 > best_f1:
        best_f1, best_epoch = f1, epoch
        best_weights = {k:v.detach().cpu().clone() for k,v in model.state_dict().items()}
    if epoch - best_epoch >= PATIENCE:
        break
model.cpu().load_state_dict(best_weights)
model.eval()
torch.save(best_weights, OUTPUT / "best-weights.pt")

# %% Export and check one small ONNX model against PyTorch
model_file = OUTPUT / "model.onnx"
with torch.no_grad():
    torch.onnx.export(model, (torch.ones(2, 31, dtype=torch.int32),), str(model_file),
                      input_names=["ids"], output_names=["logits"], opset_version=17,
                      dynamo=False, external_data=False,
                      dynamic_axes={"ids":{0:"batch", 1:"length"}, "logits":{0:"batch", 1:"length"}})
onnx.checker.check_model(str(model_file))
if model_file.stat().st_size > 2 * 1024**2:
    raise ValueError("Export exceeds the 2 MiB model-weight budget")
options = ort.SessionOptions()
options.intra_op_num_threads = options.inter_op_num_threads = 1
start_time = time.perf_counter()
session = ort.InferenceSession(str(model_file), sess_options=options, providers=["CPUExecutionProvider"])
load_ms = 1000 * (time.perf_counter() - start_time)

def infer(ids):
    return session.run(["logits"], {"ids":np.asarray(ids, dtype=np.int32)})[0]

for shape in ((1, 1), (3, 87), (1, CORE + 2*HALO)):
    dummy = torch.randint(1, 129+BUCKETS, shape, dtype=torch.int32)
    dummy[-1, shape[1]//2:] = 0
    with torch.inference_mode():
        np.testing.assert_allclose(infer(dummy.numpy()), model(dummy).numpy(), rtol=2e-4, atol=5e-5)

def predict_text(text):
    ids = encode(text)
    tags, confidence = [], []
    for left, right, a, b in windows(len(ids)):
        logits = infer(ids[None, left:right])[0, a-left:b-left]
        tags.extend(logits.argmax(-1).tolist())
        # Only the winning softmax probability is needed at each position.
        confidence.extend((1 / np.exp(logits-logits.max(axis=-1, keepdims=True)).sum(axis=-1)).tolist())
    return tags, {s:statistics.fmean(confidence[s[1]:s[2]]) for s in decode(tags)}

# An entity crosses a core boundary. Stitch the raw tags before decoding BIO.
parity_texts = ["", "🙂Zoë\n☎ +92 300 1234567", "کلید: आठ １２３ ❤️", "姓名：李红\n📬 a+b@example.net",
                " " * (CORE - 4) + "test.person@example.org" + " x" * CORE]
parity = []
for sample in parity_texts:
    ids = encode(sample)
    tags, _ = predict_text(sample)
    if sample:
        full = infer(ids[None, :])[0].argmax(-1).tolist()
        assert tags == full, "Window stitching diverges from full inference"
    parity.append({"text":sample, "ids":ids.tolist(), "tags":tags})
print("ONNX export verified:", model_file.stat().st_size, "bytes")

# %% Measure independent exact spans, false alarms and CPU latency
# A small separately authored check of natural requests, confusable numbers,
# Unicode, multiline text and entities that cross inference windows.
def annotated(*parts):
    text, spans = "", []
    for part in parts:
        if isinstance(part, tuple):
            kind, value = part
            spans.append({"label":kind, "start":len(text), "end":len(text)+len(value)})
            part = value
        text += part
    return {"text":text, "spans":spans, "source":"authored"}

challenge = [
    annotated("Send the callback to ", ("PHONE", "+44 (0)20 7946 0123"), " after lunch."),
    annotated("رابطہ کریں ", ("PHONE", "۰۳۰۰ ۱۲۳۴۵۶۷"), "۔"),
    annotated("返信先は", ("EMAIL", "テスト+二@example.org"), "です。"),
    annotated("The apartment is at ", ("ADDRESS", "42 Rue du Ciel\n75011 Paris"), "."),
    annotated("The passenger's full name is ", ("PERSON", "María-Luz O’Shea"), "."),
    annotated("CNIC on the form → ", ("NATIONAL_ID", "00000-1234567-0")),
    annotated("Travel desk copied passport ", ("PASSPORT", "XZ4625079"), " today."),
    annotated("Please transfer to account ", ("BANK_ACCOUNT", "07200341962"), "."),
    annotated("Überweisen an ", ("IBAN", "DE89 3704 0044 0532 0130 00"), "."),
    annotated("ATM card ", ("PAYMENT_CARD", "4242 4242 4242 4242"), " / PIN ", ("PIN", "7319")),
    annotated('In my local config, "api_key" = "', ("API_KEY", "key_SyntheticOnly234Sample321"), '".'),
    annotated("Our temporary passphrase is ", ("PASSWORD", "violet kites after dusk"), "."),
    annotated("🗂️ " + "ordinary words " * 33, ("EMAIL", "fin+qa@example.net"), "\nfin."),
    annotated("The ticket reference is 07200341962. Track the shipment tomorrow."),
    annotated("The book has 7319 entries. The password field is empty."),
    annotated("Order 4242 contains 20 items and costs 100.00 EUR."),
    annotated("RAM dump starts at 0x7FFE1234. We opened issue 650-1234."),
    annotated("Use the word passport in a sentence. Explain how an IBAN works."),
]
for case in challenge:
    validate(case)
# Select one cutoff on validation only. F0.5 gives precision extra weight.
# Always report unfiltered results too, so the recall cost stays visible.
def above(candidates, cutoff):
    return {span for span, value in candidates.items() if value >= cutoff}

validation_candidates = [predict_text(row["text"])[1] for row in splits["validation"]]
thresholds = []
for cutoff in (0., .35, .50, .60, .70, .80, .85, .90, .95, .98):
    scores = score_spans(splits["validation"], (above(c, cutoff) for c in validation_candidates))["overall"]
    p, r = scores["precision"], scores["recall"]
    thresholds.append(dict(cutoff=cutoff, f05=1.25*p*r / max(1.e-12, .25*p + r), **scores))
cutoff = max(thresholds, key=lambda row: (row["f05"], row["recall"]))["cutoff"]

def evaluate_export(rows):
    candidates = [predict_text(row["text"])[1] for row in rows]
    raw = score_spans(rows, (set(c) for c in candidates))
    selected = score_spans(rows, (above(c, cutoff) for c in candidates))
    return raw, selected

raw_test, test_score = evaluate_export(splits["test"])
raw_challenge, challenge_score = evaluate_export(challenge)
for fixture in parity:
    fixture["spans"] = sorted(above(predict_text(fixture["text"])[1], cutoff))
timing = {}
for length in (128, 1024, 4096):
    sample = ("🙂 Report sample. " * (length//16 + 1))[:length]
    def timed_scan():
        return above(predict_text(sample)[1], cutoff)
    for _ in range(3):
        timed_scan()
    measurements = []
    for _ in range(30):
        tick = time.perf_counter()
        timed_scan()
        measurements.append((time.perf_counter()-tick)*1000)
    timing[length] = {"median_ms":statistics.median(measurements), "p95_ms":float(np.percentile(measurements, 95))}
print("Validation-selected cutoff:", cutoff, "\nHeld-out unfiltered:", raw_test["overall"],
      "\nHeld-out at cutoff:", test_score["overall"], "\nAuthored examples:", challenge_score["overall"])
for kind, counts in test_score["by_category"].items():
    print(kind, {k:round(v, 3) for k,v in counts.items()})
print("Python CPU / single thread / end-to-end milliseconds:", timing)

# %% Save the model bundle and download the training report
manifest = {
    "format":"promptprivacy-char-cnn-v1", "tags":TAGS, "buckets":BUCKETS, "core":CORE, "halo":HALO,
    "model_width":MODEL_WIDTH,
    "input":"ids (int32, batch x Unicode code points)", "padding":0,
    "shape_groups":[*CHAR_GROUPS, "other"],
    "encoding":"ASCII n+1. Otherwise first matching Unicode category prefix g, id=129+512*g+n%512. No normalization.",
    "decoding":"Stitch central argmax tags in document order. An orphan I starts a span. Spans are [start,end).",
    "min_span_score":cutoff, "span_score":"Mean winning softmax probability across the span.",
    "weights":"FP32", "model_sha256":hashlib.sha256(model_file.read_bytes()).hexdigest(),
    "smoke_run":SMOKE, "parameters":sum(p.numel() for p in model.parameters()),
}
report = {
    "run":"pipeline smoke" if SMOKE else "training", "seed":SEED, "best_epoch":best_epoch,
    "model_bytes":model_file.stat().st_size, "packages":{name:metadata.version(name) for name in
        ("Faker","phonenumbers","schwifty","torch","numpy","onnx","onnxruntime")},
    "data":data_report, "caption_languages":list(CAPTIONS), "history":history,
    "validation_cutoffs":thresholds, "heldout_exact_span":test_score, "authored_exact_span":challenge_score,
    "unfiltered_heldout":raw_test, "unfiltered_authored":raw_challenge,
    "authored_cases":len(challenge), "python_cpu_load_ms":load_ms, "python_cpu_latency":timing,
}
def write_json(name, value):
    (OUTPUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")

write_json("manifest.json", manifest)
write_json("parity.json", parity)
write_json("training-report.json", report)
bundle = OUTPUT / ("promptprivacy-global-smoke.zip" if SMOKE else "promptprivacy-global.zip")
with zipfile.ZipFile(bundle, "w", zipfile.ZIP_DEFLATED) as archive:
    for name in ("model.onnx", "manifest.json", "parity.json", "training-report.json"):
        archive.write(OUTPUT / name, name)
print("Download from Kaggle's Output panel:", bundle, f"({bundle.stat().st_size/2**20:.2f} MiB)")
