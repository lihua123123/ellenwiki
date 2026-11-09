# -*- coding: utf-8 -*-
"""
generate-enemies.py — 敌人图鉴 ETL（全量）。

输入：
  D:\\edge下载\\GIEnemyChartXML-main          fxg/mxml 图表源 + icons/ 图标树 + excel 表
  D:\\EllenDB\\workspace\\ec_tmp\\collected_all  generate_monster_json 全量合并输出（722 条，按 InternalName）
  D:\\EllenDB\\workspace\\ec_tmp\\gen_all\\_generation_report.json  源 → Id 映射（判定哪个源页支撑哪些条目）
  D:\\EllenDB\\ellen-launcher\\Installer\\Publish\\Resource\\EnemyArchives\\MonsterIcons  头像（InternalName.png，721 张）

处理：
  1. 条目 = 667 catalog 命中 + 55 catalog 占位 + 61 源独有（丘林等），共 ~783，名字一个不丢。
  2. 源独有条目用 generate_fragment 现算；尾数字页（祸津御建鸣神命1/2/3）按名归并取内容最丰富页。
  3. mxml 补：多档等级表（Wt/Ed 的 Ed=韧性）、幽境难度表（N3~N6）、能量记法（WP[0x3]…）。
  4. 能量调度优先 MonsterEnergyDropExcelData（EnergyGroup），源独有条目回退 mxml 记法解析。
  5. 幽境变体挂到母体条目（challenge 表 Monster 名 → 源名解析 → mxml 文本含母体名，最长命中），
     挂不上则独立成条（幽境危战分类）。
  6. 图片：头像用 launcher 已验证素材（缺失回退 fxg 展示图 130~420 见方）；技能图标按 IconPath
     查 icons/ 树（缺失回退 fxg 摆放定位）；幽境立绘 fxg 500~900 宽。全部转 webp。
  7. 抗性 ≥1000 → IMM；状态名 (N5)/(NN) 尾注 → diffNote 字段（页面按难度过滤）。
     Wayob_Shamansaurus_* 的 BaseHp.Curve 误写 ATK_1 → 归一 HP_1。

输出：
  src/data/enemies/index.json          列表索引（分类 + 卡片字段 + tags）
  src/data/enemies/items/<id>.json     详情数据
  public/images/enemies/<id>/*.webp    头像 / 技能图标 / 幽境立绘

运行（需 Pillow）：
  C:/Users/34762/.workbuddy/binaries/python/envs/default/Scripts/python.exe scripts/generate-enemies.py
"""
import io
import json
import os
import re
import shutil
import sys
from pathlib import Path

# ──────────────── 配置 ────────────────
# 图表源（mxml + fxg + icons）：默认是制图机上的解压目录，可用 ELLEN_CHART_ROOT 覆盖。
SOURCE_ROOT = Path(os.environ.get('ELLEN_CHART_ROOT') or r'D:\edge下载\GIEnemyChartXML-main')
WIKI_ROOT = Path(__file__).resolve().parent.parent
COLLECTED_DIR = Path(r'D:\EllenDB\workspace\ec_tmp\collected_all')
GEN_REPORT = Path(r'D:\EllenDB\workspace\ec_tmp\gen_all\_generation_report.json')
LAUNCHER_ICON_DIR = Path(r'D:\EllenDB\ellen-launcher\Installer\Publish\Resource\EnemyArchives\MonsterIcons')

# 分类映射（catalog 规范名 → 中文；顺序即页面标签顺序）
CATEGORY_LABELS = {
    'Hilichurls': '丘丘族群',
    'ElementalLifeforms': '元素生命',
    'MagicalBeasts': '异种魔兽',
    'MysticalBeasts': '异种魔兽',
    'Abyss': '深渊',
    'Automatons': '自律机关',
    'OtherHumanFactions': '其他人类势力',
    'Fatui': '愚人众',
    'EnemyOfNote': '值得铭记的强敌',
    'EnemiesOfNote': '值得铭记的强敌',
    'Legends': '地方传奇',
    'StygianOnslaught': '幽境危战',
    'LeyLine': '幽境危战',
    'Leyline': '幽境危战',
    'NonCategorized': '无分类',
    'Others': '其他',
    'Animals': '动物',
    'Tps': '第三人称射击（TPS）',
}

# 富文本元素色映射（源 hex → 站内元素类；未命中走 <c=#hex> 行内色）
ELEM_HEX_CLASSES = {
    '#99ffff': 'cryo',
    '#7fffd7': 'anemo',
}

# 幽境优势机制英文标注 → 中文
ADVANTAGE_LABELS = {
    'Stellar Reaction Adv.': '星烁反应',
    'Anemo Adv.': '风元素优势',
    '——': '',
}

# 能量掉落元素（Type 字段 / 记法字母）→ 名称 / 中文标签
ENERGY_ELEMENT_LABELS = {
    'Pyro': '火', 'Hydro': '水', 'Electro': '雷', 'Cryo': '冰',
    'Dendro': '草', 'Anemo': '风', 'Geo': '岩', 'White': '无元素',
    'P': '火', 'H': '水', 'E': '雷', 'C': '冰',
    'D': '草', 'A': '风', 'G': '岩', 'W': '无元素',
}
ENERGY_ELEMENT_NAMES = {
    'P': 'Pyro', 'H': 'Hydro', 'E': 'Electro', 'C': 'Cryo',
    'D': 'Dendro', 'A': 'Anemo', 'G': 'Geo', 'W': 'White',
}

# 幽境难度：N1~N6 显示名（mxml 表头缺失时的兜底）
DIFFICULTY_NAMES = {
    'N1': '简单', 'N2': '普通', 'N3': '困难',
    'N4': '险恶', 'N5': '无畏', 'N6': '绝境',
}

# 成长曲线：条目 Curve 名 → MonsterCurveExcelConfigData 列（value(level) = BaseValue × factor）
CURVE_GROW_KEYS = {
    'HP_1': 'GROW_CURVE_HP',
    'HP_2': 'GROW_CURVE_HP_2',
    'HP_3': 'GROW_CURVE_HP_ENVIRONMENT',
    'ATK_1': 'GROW_CURVE_ATTACK',
    'ATK_2': 'GROW_CURVE_ATTACK_2',
}
LEVEL_MAX = 110  # 绝境 N6 Lv.110

sys.path.insert(0, str(SOURCE_ROOT))
import generate_monster_json as g  # noqa: E402
from PIL import Image  # noqa: E402


# ──────────────── 富文本 ────────────────
def convert_richtext(text):
    """源富文本 → 站内富文本。元素色转 span 类，其余转 <c=#hex>，<u> 转反引号。"""
    if not text:
        return ''

    def color_sub(m):
        hexc, inner = m.group(1).lower(), m.group(2)
        if hexc == '#bfdfff':  # 反应/机制名词（浅蓝）→ 反引号（与幽境 boss 页口径一致）
            noun = re.sub(r'^「|」$', '', inner)
            return f'`{noun}`'
        cls = ELEM_HEX_CLASSES.get(hexc)
        if cls:
            return f'<span class="{cls}">**{inner}**</span>'
        return f'<c={hexc}>{inner}</c>'

    out = re.sub(r'<color=(#[0-9a-fA-F]{6})>(.*?)</color>', color_sub, text, flags=re.S)
    out = re.sub(r'<u>(.*?)</u>', r'`\1`', out, flags=re.S)
    return out


# ──────────────── mxml 解析 ────────────────
_blocks_cache = {}


def parse_mxml_blocks(mxml_path):
    """返回按 (y, x) 排序的可见文本块 [(y, x, text)]。"""
    key = str(mxml_path)
    if key in _blocks_cache:
        return _blocks_cache[key]
    warnings = []
    doc = g.parse_document(g.Path(str(mxml_path)), g.parse_mxml, warnings)
    blocks = []
    for b in doc.texts:
        if b.visible and b.plain.strip():
            blocks.append((b.y, b.x, b.plain))
    blocks.sort(key=lambda t: (t[0], t[1]))
    _blocks_cache[key] = blocks
    return blocks


def extract_level_rows(blocks):
    """多档数据：'地方传奇 Lv.103 Data' / HP: ... / ATK: ... / Wt/Ed: wt/ed（Ed=韧性）。"""
    levels = []
    cur = None
    for y, x, text in blocks:
        m = re.match(r'(.+?)\s*Lv\.(\d+)\s*Data', text.replace('\n', ' '))
        if m:
            cur = {'label': m.group(1).strip(), 'level': int(m.group(2))}
            levels.append(cur)
            continue
        if cur is None:
            continue
        m = re.match(r'HP:\s*[<≤]?\s*([\d,]+)(.*)', text.replace('\n', ' '))
        if m:
            cur['hp'] = int(m.group(1).replace(',', ''))
            note = re.search(r'(\d+(?:\.\d+)?%)', m.group(2))
            if note:
                cur['hpNote'] = note.group(1)
            continue
        m = re.match(r'ATK:\s*[<≤]?\s*([\d,]+)(.*)', text.replace('\n', ' '))
        if m:
            cur['atk'] = int(m.group(1).replace(',', ''))
            note = re.search(r'(\d+(?:\.\d+)?%)', m.group(2))
            if note:
                cur['atkNote'] = note.group(1)
            continue
        m = re.match(r'Wt/Ed:\s*([\d.]+)\s*/\s*([\d.]+)', text.replace('\n', ' '))
        if m:
            cur['weight'] = float_num(m.group(1))
            cur['tenacity'] = float_num(m.group(2))
    return levels


def float_num(s):
    v = float(s)
    return int(v) if v.is_integer() else v


def extract_leyline_difficulty(blocks):
    """幽境难度表：困难 - N3 Lv.90 表头 + HP / ×倍率 / ATK / 优势机制四列。"""
    headers = []
    for y, x, text in blocks:
        t = text.replace('\n', ' ')
        m = re.match(r'(.+?)\s*-\s*(N\d)\s*Lv\.(\d+)', t)
        if m:
            headers.append({'x': x, 'y': y, 'name': m.group(1).strip(),
                            'key': m.group(2), 'level': int(m.group(3))})
    if not headers:
        return []
    headers.sort(key=lambda h: h['x'])
    col_x = [h['x'] for h in headers]

    def col_of(x):
        best, best_d = 0, 1e9
        for i, cx in enumerate(col_x):
            d = abs(x - cx)
            if d < best_d:
                best, best_d = i, d
        return best

    rows = {}
    for y, x, text in blocks:
        if x < col_x[0] - 90:
            continue
        t = text.replace('\n', ' ').strip()
        if re.match(r'^(HP|ATK)$', t) or 'Lv.' in t:
            continue
        c = col_of(x)
        if re.match(r'^×\s*[\d.]+$', t):
            rows.setdefault('mult', {})[c] = float(t.replace('×', '').strip())
        elif re.match(r'^[\d,]+$', t):
            hp = rows.setdefault('hp', {})
            if len(hp) < len(headers) and ('atk' not in rows):
                hp[c] = int(t.replace(',', ''))
            else:
                rows.setdefault('atk', {})[c] = int(t.replace(',', ''))
        elif t in ADVANTAGE_LABELS or 'Adv.' in t:
            rows.setdefault('advantage', {})[c] = ADVANTAGE_LABELS.get(t, t)

    result = []
    for i, h in enumerate(headers):
        result.append({
            'key': h['key'], 'name': h['name'], 'level': h['level'],
            'hp': rows.get('hp', {}).get(i),
            'atk': rows.get('atk', {}).get(i),
            'multiplier': rows.get('mult', {}).get(i),
            'advantage': rows.get('advantage', {}).get(i, ''),
        })
    return result


def parse_energy(blocks):
    """mxml「元素能量：WP[0x3],WO[66,33,0]」→ 掉落能量调度。
    W/P/H/E/C/D/A/G=元素字母（W=苍白/无元素），P=微粒，O=微粒球，NxM=血量 N% 掉 M 个。"""
    raw_text = None
    for _y, _x, text in blocks:
        t = text.replace('\n', ' ')
        if re.search(r'元素能量\s*[：:]', t, re.I):
            raw_text = re.split(r'元素能量\s*[：:]', t, maxsplit=1, flags=re.I)[-1].strip()
            break
        if re.search(r'Energy\s+Drop', t, re.I):
            raw_text = re.split(r'Energy\s+Drop', t, maxsplit=1, flags=re.I)[0].strip()
            break
    if not raw_text:
        return None
    tokens = re.findall(r'([PHECDAGW])([PO])\[([^\]]*)\]', raw_text, re.I)
    if not tokens:
        return None
    code = tokens[0][0].upper()
    particles, orbs = {}, {}
    for ec, dt, contents in tokens:
        if ec.upper() != code:
            continue
        dest = particles if dt.upper() == 'P' else orbs
        for item in contents.split(','):
            m = re.fullmatch(r'\s*(\d+(?:\.\d+)?)\s*(?:[xX]\s*(\d+(?:\.\d+)?))?\s*', item)
            if not m:
                continue
            th = float(m.group(1))
            cnt = float(m.group(2) or 1)
            th = int(th) if th.is_integer() else th
            cnt = int(cnt) if cnt.is_integer() else cnt
            dest[th] = dest.get(th, 0) + cnt
    if not particles and not orbs:
        return None
    thresholds = sorted(set(list(particles) + list(orbs)), reverse=True)
    rows = [{'hp': th, 'particle': particles.get(th, 0), 'orb': orbs.get(th, 0)} for th in thresholds]
    return {
        'element': ENERGY_ELEMENT_NAMES.get(code, 'White'),
        'elementLabel': ENERGY_ELEMENT_LABELS.get(code, '无元素'),
        'raw': raw_text,
        'rows': rows,
    }


def energy_from_group(group, energy_type):
    """MonsterEnergyDropExcelData 的 EnergyGroup → 调度表。"""
    row = ENERGY_TABLE.get(group or '')
    if not row:
        return None
    def split_nums(v):
        return [float_num(x.strip().replace('%', '')) for x in str(v).split(',') if x.strip() != '']
    ths = split_nums(row.get('DropMode', ''))
    ps = split_nums(row.get('ParticleDrop', ''))
    os_ = split_nums(row.get('OrbDrop', ''))
    if not ths:
        return None
    rows = []
    for i, th in enumerate(ths):
        rows.append({
            'hp': th,
            'particle': ps[i] if i < len(ps) else 0,
            'orb': os_[i] if i < len(os_) else 0,
        })
    rows.sort(key=lambda r: r['hp'], reverse=True)
    return {
        'element': energy_type or 'White',
        'elementLabel': ENERGY_ELEMENT_LABELS.get(energy_type, '无元素'),
        'raw': f'EnergyGroup:{group}',
        'rows': rows,
    }


# ──────────────── fxg 素材定位 ────────────────
def parse_fxg_images(fxg_path):
    warnings = []
    doc = g.parse_document(g.Path(str(fxg_path)), g.parse_fxg, warnings)
    out = []
    for im in doc.images:
        src = im.source if isinstance(im.source, str) else getattr(im.source, 'name', str(im.source))
        name = re.search(r'(Image_\d+\.png)', str(src))
        out.append((im.x, im.y, name.group(1) if name else ''))
    return out


def asset_dir_for(fxg_path):
    """fxg 的资源目录：常规是 `<名字>.assets`，个别页直接是 `<名字>`（元能构装体·勘探机）。"""
    for cand in (fxg_path.parent / (fxg_path.stem + '.assets'), fxg_path.parent / fxg_path.stem):
        if cand.is_dir():
            return cand
    return None


def asset_size(asset_dir, name):
    p = asset_dir / name
    if not p.exists():
        return None
    try:
        return Image.open(p).size
    except OSError:
        return None


def find_avatar(asset_dir):
    """头像：130~420 见方、长宽比 0.72~1.4 的展示图（FXGLeyLine 的展示图仅 128~160px）。"""
    lo = 120 if 'LeyLine' in asset_dir.name or 'Leyline' in asset_dir.name else 130
    best = None
    for p in sorted(asset_dir.glob('*.png')):
        size = asset_size(asset_dir, p.name)
        if not size:
            continue
        w, h = size
        if lo <= w <= 420 and lo <= h <= 420 and 0.72 <= w / h <= 1.40:
            if best is None or w * h > best[1]:
                best = (p, w * h)
    return best[0] if best else None


def find_portrait(asset_dir):
    """幽境立绘：500~900 宽、长宽比 0.9~1.4 的大图。"""
    best = None
    for p in sorted(asset_dir.glob('*.png')):
        size = asset_size(asset_dir, p.name)
        if not size:
            continue
        w, h = size
        if 500 <= w <= 900 and 0.9 <= w / h <= 1.4:
            if best is None or w * h > best[1]:
                best = (p, w * h)
    return best[0] if best else None


def find_skill_icons(fxg_path, asset_dir, skill_rows):
    """技能图标（fallback）：128 见方素材摆在技能名行左侧（x∈[textX-200,textX-40]、|Δy|≤60）。"""
    placements = parse_fxg_images(fxg_path)
    result = []
    for sy, sx, _name in skill_rows:
        hit = None
        for x, y, asset in placements:
            if not asset:
                continue
            size = asset_size(asset_dir, asset)
            if not size:
                continue
            w, h = size
            if not (110 <= w <= 140 and 110 <= h <= 140):
                continue
            if sx - 200 <= x <= sx - 40 and abs(y - sy) <= 60:
                hit = asset_dir / asset
                break
        result.append(hit)
    return result


def extract_skill_rows(blocks):
    """技能名行：'碎剜寒芒-定点' 形态（名-类型）。"""
    rows = []
    for y, x, text in blocks:
        m = re.match(r'^(.+)-(.+)$', text.strip().replace('\n', ''))
        if m and m.group(2) in ('定点', '控制', '远程', '输出', '召唤', '妨害', '爆发', '防御', '位移'):
            rows.append((y, x, m.group(1).strip()))
    return rows


def loose_skill_rows(blocks):
    """技能名行（宽松）：类型放宽成 2~4 个汉字。

    `extract_skill_rows` 的白名单只有 9 个类型，凡「协同 / 回复 / 转换 / 苏醒 / 反击 /
    追踪 / 碾压 / 锁定 / 靠近 / 天赋 / 防卫」这类行都会被丢掉，行数一少，按行号对齐的
    图标就整段错位或直接空着（门扉前的弈局2 12 行里丢 4 行、祸津御建鸣神命 10 行里丢 4 行）。
    行本身仍是「名字-类型」，只是不认白名单。
    """
    rows = []
    for y, x, text in blocks:
        m = re.match(r'^([^<>]+?)-([\u4e00-\u9fa5]{2,4})$', text.strip().replace('\n', ''))
        if m:
            rows.append((y, x, m.group(1).strip()))
    return rows


def _clean_skill_name(name):
    """去掉模仿招式的『 *来源* 』尾巴（深邃摹结株）。"""
    return re.sub(r'\s*\*[^*]*\*$', '', name or '').strip()


def page_skill_icons(source):
    """页 → ({归一化技能名: 图标源文件}, 按行序的图标列表)。"""
    if not source or not source.fxg or not source.mxml:
        return {}, []
    asset_dir = asset_dir_for(source.fxg)
    if asset_dir is None:
        return {}, []
    rows = loose_skill_rows(parse_mxml_blocks(source.mxml))
    if not rows:
        return {}, []
    icons = find_skill_icons(source.fxg, asset_dir, rows)
    by_name = {}
    for (_y, _x, name), icon in zip(rows, icons):
        if icon:
            by_name.setdefault(norm_key(name), icon)
    return by_name, icons


def fill_skill_icons(skills, source, img_dir, prefix=''):
    """按技能名补空图标；行数与技能数一致时再用行号兜底。返回补上的个数。"""
    by_name, ordered = page_skill_icons(source)
    if not by_name and not ordered:
        return 0
    align_by_index = len(ordered) == len(skills)
    filled = 0
    for i, sk in enumerate(skills):
        if sk.get('icon'):
            continue
        src = by_name.get(norm_key(_clean_skill_name(sk.get('name'))))
        if src is None and align_by_index:
            src = ordered[i]
        if src is None:
            continue
        name = f'{prefix}skill-{i + 1}.webp'
        write_skill_icon(Path(src), img_dir / name)
        sk['icon'] = name
        filled += 1
    return filled


def resolve_icon_file(icon_path):
    """IconPath 'static/images/X' → SOURCE_ROOT/icons/X。"""
    if not icon_path:
        return None
    rel = re.sub(r'^static/images/', '', icon_path.replace('\\', '/'))
    p = SOURCE_ROOT / 'icons' / rel
    return p if p.exists() else None


# ──────────────── 输出 / 图片 ────────────────
def save_webp(src: Path, dest: Path, max_side=None):
    dest.parent.mkdir(parents=True, exist_ok=True)
    im = Image.open(src).convert('RGBA')
    if max_side and max(im.size) > max_side:
        im.thumbnail((max_side, max_side), Image.LANCZOS)
    im.save(dest, 'WEBP', quality=90)


_icon_bytes_cache = {}


def write_skill_icon(src: Path, dest: Path):
    """64×64 webp；同源文件只解码一次（多变体共享一张图标）。"""
    key = str(src)
    if key not in _icon_bytes_cache:
        im = Image.open(src).convert('RGBA')
        im.thumbnail((64, 64), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, 'WEBP', quality=88)
        _icon_bytes_cache[key] = buf.getvalue()
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(_icon_bytes_cache[key])


def slugify(name_en):
    s = re.sub(r'[^a-z0-9]+', '-', (name_en or '').lower()).strip('-')
    return s


def slugify_zh(name):
    """保留 CJK/字母/数字（站内其它图鉴 id 本就含中文）。"""
    s = re.sub(r'[^\w一-鿿]+', '-', (name or '')).strip('-').lower()
    return re.sub(r'-+', '-', s)


# ──────────────── 名称清理 ────────────────
def split_campaign(name):
    """'啸卷之役-极寒冰魄·狼魂' → ('啸卷之役', '极寒冰魄·狼魂')。"""
    m = re.match(r'^(.+?之役)-(.+)$', name or '')
    return (m.group(1), m.group(2)) if m else ('', name or '')


def clean_subtitle(name, sub):
    sub = (sub or '').strip()
    if not sub or sub == name:
        return ''
    if re.match(r'^ATK\d', sub):
        return ''
    return sub


MX_TEXT_RE = re.compile(r'<mx:Text\b[^>]*?\btext="([^"]*)"')


def mxml_texts(source):
    """读取图内 mx:Text 文本（用于补真实标题与状态标注）。"""
    path = getattr(source, 'mxml', None)
    if not path:
        return []
    try:
        raw = Path(path).read_text(encoding='utf-8', errors='ignore')
    except OSError:
        return []
    return [t.strip() for t in MX_TEXT_RE.findall(raw) if t.strip()]


def real_title(source, fallback):
    """文件名式名字（水铳士tps）改用图内首行真标题（愚人众先遣队·水铳士）。"""
    for t in mxml_texts(source)[:3]:
        t = re.sub(r'\s+', '', t)  # 标题在源里会折行（愚人众先遣队·\n水铳士）
        if t and '技能' not in t and '抗性' not in t and len(t) <= 20:
            return t
    return fallback


def state_suffix(source):
    """周本双形态：取图内「周本-地面状态 / 周本-空中状态」的状态词。"""
    for t in mxml_texts(source):
        m = re.search(r'(地面|空中)状态', t)
        if m:
            return m.group(1)
    return ''


def noise_key(name):
    """源独有条目的归并键：去 tps 尾缀与尾数字。"""
    s = (name or '').strip()
    s = re.sub(r'tps$', '', s, flags=re.I)
    s = re.sub(r'\d+$', '', s)
    return s.strip()


def strip_prefixes(name):
    for p in ('历经百战的', '幽境·', '复苏的', '愤怒的'):
        if name.startswith(p):
            return name[len(p):]
    return name


def norm_key(value):
    """归一比较键：去空白/引号/间隔点，忽略大小写。"""
    s = g.identity_key(value or '')
    s = s.replace('·', '').replace('・', '').replace('.', '')
    return s.casefold()


# ──────────────── 抗性 ────────────────
RES_KEYS = {'Pyro': 'pyro', 'Hydro': 'hydro', 'Anemo': 'anemo', 'Electro': 'electro',
            'Dendro': 'dendro', 'Cryo': 'cryo', 'Geo': 'geo', 'Physical': 'physical'}


def res_value(v):
    if isinstance(v, (int, float)) and v >= 1000:
        return 'IMM'
    return v


def split_state_name(name):
    """'正常(N5)' → ('正常', 'N5')。"""
    m = re.fullmatch(r'\s*(.*?)\s*[（(]\s*(N\d+(?:\s*/\s*N\d+)*)\s*[)）]\s*', name or '', re.I)
    if not m:
        return (name or '').strip(), ''
    return m.group(1).strip(), re.sub(r'\s+', '', m.group(2)).upper()


def resistance_out(resistace):
    out = []
    for st in (resistace or {}).values():
        if not isinstance(st, dict):
            continue
        base_name, diff_note = split_state_name(st.get('Name', ''))
        diff_note = st.get('DiffNote') or diff_note
        row = {'name': convert_richtext(base_name)}
        if diff_note:
            row['diffNote'] = diff_note
        for k, v in st.items():
            if k in ('Name', 'DiffNote'):
                continue
            key = RES_KEYS.get(k, k.lower())
            row[key] = res_value(v)
        out.append(row)
    return out


# ──────────────── 条目装配 ────────────────
def skills_out(skills, icon_prefix, icons):
    out = []
    for i, sk in enumerate(skills):
        out.append({
            'name': sk.get('Name', ''),
            'type': sk.get('Type', ''),
            'icon': f'{icon_prefix}-{i + 1}.webp' if i < len(icons) and icons[i] else '',
            'description': convert_richtext(sk.get('Description', '')),
        })
    return out


def shields_out(shields):
    return [
        {
            'name': s.get('Name', ''),
            'description': convert_richtext(s.get('Description', '')),
            'elementType': s.get('ElementType', ''),
            'duration': s.get('Duration', ''),
        }
        for s in (shields or [])
    ]


def notes_out(notes):
    return [
        {'text': n.get('Text', ''), 'desc': convert_richtext(n.get('Desc', ''))}
        for n in (notes or [])
    ]


def chargebar_out(bars):
    """充能条：Description 与技能描述同源富文本，需同样转换（否则页面可能露出 <color=#> 原文）。"""
    out = []
    for b in (bars or []):
        row = {'name': b.get('Name', ''), 'description': convert_richtext(b.get('Description', ''))}
        for k, v in b.items():
            if k in ('Name', 'Description'):
                continue
            row[k[:1].lower() + k[1:]] = v
        out.append(row)
    return out


def clean_name_en(s):
    """英文名清洗：剔除误认的「元素能量：…」行、loc 占位键（desc.XXX）、能量编码（WP[60,0]）与引号包裹。"""
    s = (s or '').strip().strip('“”"\'')
    if not s:
        return ''
    if ('元素能量' in s or re.match(r'^desc\.', s, re.I)
            or re.match(r'^[A-Z]{1,3}P?\[', s)):
        return ''
    return s


def base_entry_from_fields(fields, internal_id):
    """统一条目骨架（base / 源独有 / 幽境独立条共用）。"""
    name_raw = fields.get('NameZHCN') or internal_id or ''
    campaign, name = split_campaign(name_raw)
    name = re.sub(r'\d+$', '', (name or '').strip())  # 页面序号尾缀（祸津御建鸣神命3 等）
    name_en = clean_name_en(fields.get('NameENUS', ''))
    if not name_en:  # 能量行挤掉真英文名时取 SubtitleENUS（如 Oprichniki Vanguard）
        name_en = clean_name_en(fields.get('SubtitleENUS', ''))
    if re.match(r'^ATK', name_en or '', re.I):  # 脚本站位文本误认成英文名
        name_en = ''
    subtitle = clean_subtitle(name, fields.get('SubtitleZHCN'))
    if not subtitle and campaign:
        subtitle = campaign
    cat = fields.get('Category') or ''
    return {
        '_internal_id': internal_id or '',
        'name': name,
        'nameEn': name_en,
        'subtitle': subtitle,
        'category': cat,
        'categoryLabel': CATEGORY_LABELS.get(cat, cat),
        'tier': fields.get('Tier', ''),
        'defaultLevel': fields.get('DefaultLevel') or None,
        'baseStats': {
            'hp': fields.get('BaseHp', {}),
            'atk': fields.get('BaseAtk', {}),
            'def': fields.get('BaseDef', {}),
        },
        'resistances': resistance_out(fields.get('Resistace')),
        'elementMastery': fields.get('ElementMastery', 0),
        'multiplayerGroup': fields.get('MultiplayerGroup', ''),
        'weight': fields.get('Weight', ''),
        'skills': skills_out(fields.get('Skill') or fields.get('SkillDiffer') or [], 'skill', []),
        'notes': notes_out(fields.get('Notes') or fields.get('MechanismNotes') or []),
        'shields': shields_out(fields.get('Shield')),
        'chargebar': chargebar_out(fields.get('Chargebar')),
        'energy': None,
        'levelRows': [],
        'leyline': None,
    }


# v2.0 内容图映射（敌人原名 → 种子图相对路径）。懒加载，离线可用。
_V2_IMAGE_MAP = None
def _load_v2_image_map():
    global _V2_IMAGE_MAP
    if _V2_IMAGE_MAP is None:
        _f = WIKI_ROOT / 'scripts' / 'seed' / 'v2-image-map.json'
        if _f.exists():
            _V2_IMAGE_MAP = json.loads(_f.read_text(encoding='utf-8'))
        else:
            _V2_IMAGE_MAP = {}
    return _V2_IMAGE_MAP


# ECLeyLine 幽境内容图映射（幽境名 → 种子图）。文件名形如「<战役>-<幽境名>.png」。
_V2_LEYLINE_MAP = None
def _load_v2_leyline_map():
    global _V2_LEYLINE_MAP
    if _V2_LEYLINE_MAP is None:
        _d = WIKI_ROOT / 'scripts' / 'seed' / 'v2-enemy-avatars' / 'ECLeyLine'
        _m = {}
        if _d.exists():
            for _p in sorted(_d.glob('*.png')):
                _m[norm_key(re.sub(r'^.+?之役-', '', _p.stem))] = _p
        _V2_LEYLINE_MAP = _m
    return _V2_LEYLINE_MAP


# 幽境全身立绘映射（幽境名 → 原画种子）。v2 图是「全技能一图流」信息卡，这里补纯立绘。
_V2_LEYLINE_ART = None
def _load_leyline_art_map():
    global _V2_LEYLINE_ART
    if _V2_LEYLINE_ART is None:
        _f = WIKI_ROOT / 'scripts' / 'seed' / 'leyline-art-map.json'
        _m = {}
        if _f.exists():
            for _k, _rel in json.loads(_f.read_text(encoding='utf-8')).items():
                _m[norm_key(_k)] = WIKI_ROOT / _rel
        _V2_LEYLINE_ART = _m
    return _V2_LEYLINE_ART


# 真名归并映射（Veterans「历经百战的XXX」条目名 → Legends 真名条目名）。
# 源数据里同一只怪有 Legends/<Id>_Elite（真名）与 Veterans/<Id>_Battle（历经百战）两份，
# 图鉴只保留真名条目，Veterans 的旧名进 aliases。
_REALNAME_MERGE = None
def _load_realname_merge():
    global _REALNAME_MERGE
    if _REALNAME_MERGE is None:
        _f = WIKI_ROOT / 'scripts' / 'seed' / 'realname-merge.json'
        _REALNAME_MERGE = {}
        if _f.exists():
            for _k, _v in json.loads(_f.read_text(encoding='utf-8')).items():
                _REALNAME_MERGE[norm_key(_k)] = _v
    return _REALNAME_MERGE


# 幽境块改挂映射（幽境名 → 真名条目名）。用于母体不是同名家族的场合，如
# 「历经百战的玳龟·坚盾轰霆」的母体是地方传奇「科西霍」而不是野怪「玳龟」。
_LEYLINE_REPARENT = None
def _load_leyline_reparent():
    global _LEYLINE_REPARENT
    if _LEYLINE_REPARENT is None:
        _f = WIKI_ROOT / 'scripts' / 'seed' / 'leyline-reparent.json'
        _LEYLINE_REPARENT = {}
        if _f.exists():
            for _k, _v in json.loads(_f.read_text(encoding='utf-8')).items():
                _LEYLINE_REPARENT[norm_key(_k)] = _v
    return _LEYLINE_REPARENT

def export_images(entry, fields, source, prefix_skills='skill'):
    """头像 + 技能图标导出到 public/images/enemies/<id>/。返回 (icon 名列表, 头像文件名)。"""
    enemy_id = entry['id']
    img_dir = WIKI_ROOT / 'public' / 'images' / 'enemies' / enemy_id
    img_dir.mkdir(parents=True, exist_ok=True)

    # 头像：launcher 已验证素材 → fxg 展示图
    avatar_file = ''
    src_icon = LAUNCHER_ICON_DIR / f"{entry['_internal_id']}.png" if entry['_internal_id'] else None
    if src_icon and src_icon.exists():
        save_webp(src_icon, img_dir / 'avatar.webp', max_side=256)
        avatar_file = 'avatar.webp'
    elif source and source.fxg:
        asset_dir = asset_dir_for(source.fxg)
        avatar = find_avatar(asset_dir) if asset_dir else None
        if avatar:
            save_webp(avatar, img_dir / 'avatar.webp')
            avatar_file = 'avatar.webp'

    # v2.0 内容图（一图流，置于详情底部，非头像）：
    # 按敌人原名在 scripts/seed/v2-image-map.json 匹配种子图，离线可用、不依赖网络；
    # 仅作内容补充，GIEnemyChartXML 之后收录同名真实敌人也不会冲突。
    if not entry.get('images'):
        _v2m = _load_v2_image_map()
        _m = _v2m.get(entry.get('name')) if _v2m else None
        if _m:
            import shutil as _shutil
            # 支持多张（多阶段 boss / 双人组合 / 驮兽系列）：seeds 优先，回退单 seed
            _seeds = _m.get('seeds') or ([_m['seed']] if _m.get('seed') else [])
            _ok_seeds = [_rel for _rel in _seeds if (WIKI_ROOT / _rel).exists()]
            for _rel in _seeds:
                if _rel not in _ok_seeds:
                    print(f'  ⚠ v2 内容图种子缺失：{WIKI_ROOT / _rel}')
            if _ok_seeds:
                # 清掉旧 reference 系列，避免图片数量变少时残留孤儿文件
                for _old in img_dir.glob('reference*.png'):
                    _old.unlink()
                _imgs = []
                for _rel in _ok_seeds:
                    _fn = 'reference.png' if not _imgs else f'reference-{len(_imgs) + 1}.png'
                    _shutil.copy2(WIKI_ROOT / _rel, img_dir / _fn)
                    _imgs.append(_fn)
                entry['images'] = _imgs

    # 技能图标：IconPath 查 icons/ 树 → fxg 摆放定位
    skills = fields.get('Skill') or fields.get('SkillDiffer') or []
    icon_files = []
    for i, sk in enumerate(skills):
        dest = img_dir / f'{prefix_skills}-{i + 1}.webp'
        src = resolve_icon_file(sk.get('IconPath'))
        if src:
            write_skill_icon(src, dest)
            icon_files.append(dest.name)
            continue
        icon_files.append('')
    if source and source.fxg and any(not f for f in icon_files):
        asset_dir = asset_dir_for(source.fxg)
        if asset_dir:
            blocks = parse_mxml_blocks(source.mxml) if source.mxml else []
            rows = extract_skill_rows(blocks)
            fallback = find_skill_icons(source.fxg, asset_dir, rows) if rows else []
            for i, f in enumerate(icon_files):
                if f or i >= len(fallback) or not fallback[i]:
                    continue
                write_skill_icon(fallback[i], img_dir / f'{prefix_skills}-{i + 1}.webp')
                icon_files[i] = f'{prefix_skills}-{i + 1}.webp'
    return icon_files, avatar_file


def export_portrait(source, img_dir):
    """幽境立绘。"""
    if not source or not source.fxg:
        return ''
    asset_dir = asset_dir_for(source.fxg)
    portrait = find_portrait(asset_dir) if asset_dir else None
    if not portrait:
        return ''
    save_webp(portrait, img_dir / 'leyline-portrait.webp')
    return 'leyline-portrait.webp'


def enrich_from_mxml(entry, source):
    """mxml 补数据：多档等级 / 掉落能量 / 幽境难度。"""
    if not source:
        return
    blocks = parse_mxml_blocks(source.mxml) if source.mxml else []
    if not blocks:
        return
    entry['levelRows'] = extract_level_rows(blocks)
    if entry['energy'] is None:
        entry['energy'] = parse_energy(blocks)
    ley = entry.get('leyline')
    if ley is not None and not ley.get('difficulties'):
        ley['difficulties'] = extract_leyline_difficulty(blocks)


# ──────────────── 主流程 ────────────────
def load_collected():
    data = {}
    for p in sorted(COLLECTED_DIR.glob('*.json')):
        payload = json.loads(p.read_text(encoding='utf-8'))
        wrapper = payload[0] if isinstance(payload, list) else payload
        for k, v in wrapper.items():
            data[k] = v
    return data


def load_id_sources():
    reports = json.loads(GEN_REPORT.read_text(encoding='utf-8'))
    id_sources = {}
    for r in reports:
        for cid in r.get('catalog_ids', []):
            id_sources.setdefault(cid, []).append(r['name'])
    return id_sources


# 源内同图不同版本的重复源（旧版 → 新版）：只保留新版，旧名转搜索别名。
# 永恒冰雪的幻景 vs 永恒冰霜的幻景：图/数值/技能一致，后者多出「火反应消耗 1:1」一句。
DUPLICATE_SOURCES = {'永恒冰雪的幻景': '永恒冰霜的幻景'}


# ──────────────── 多状态合并（周本多阶段 / 同场多形态） ────────────────
# 每个状态在详情页是一个标签页；第一个状态为主状态，条目顶层字段 / id / 头像取它。
#   src  ：已存在的条目名（提供数值 / 头像 / 档位）
#   page ：源页名，提供技能 / 注解 / 抗性（src 为空时整套数据都来自 page）
# 页面图片按 state-<key>-avatar.webp / state-<key>-skill-N.webp 复制进合并后的目录。
STATE_GROUPS = [
    {
        'base': '门扉前的弈局',
        'states': [
            {'key': 'ben', 'label': '本体', 'src': '门扉前的弈局'},
            {'key': 'wangqi', 'label': '王棋', 'src': '「王棋」', 'page': '门扉前的弈局1'},
            {'key': 'houqi', 'label': '后棋', 'src': '「后棋」', 'page': '门扉前的弈局1'},
            {'key': 'shenghua', 'label': '升华之后', 'src': '升华之后', 'page': '门扉前的弈局2'},
            {'key': 'shengyang', 'label': '升扬之王', 'src': '升扬之王', 'page': '门扉前的弈局2'},
        ],
    },
    {
        'base': '若陀龙王', 'id': 'azhdaha',
        'states': [
            {'key': 'yan', 'label': '岩', 'src': '若陀龙王·岩'},
            {'key': 'shui', 'label': '水', 'src': '若陀龙王·水'},
            {'key': 'bing', 'label': '冰', 'src': '若陀龙王·冰'},
            {'key': 'huo', 'label': '火', 'src': '若陀龙王·火'},
            {'key': 'lei', 'label': '雷', 'src': '若陀龙王·雷'},
            {'key': 'shuibing', 'label': '水冰', 'src': '若陀龙王·水冰'},
            {'key': 'shuilei', 'label': '水雷', 'src': '若陀龙王·水雷'},
            {'key': 'huobing', 'label': '火冰', 'src': '若陀龙王·火冰'},
            {'key': 'huolei', 'label': '火雷', 'src': '若陀龙王·火雷'},
        ],
    },
    {
        'base': '「公子」', 'id': 'childe',
        'states': [
            {'key': 'p1', 'label': '第一阶段', 'src': '「公子」·末席'},
            {'key': 'p2', 'label': '第二阶段', 'src': '「公子」·邪眼解放'},
            {'key': 'p3', 'label': '第三阶段', 'src': '「公子」'},
        ],
    },
    {
        'base': '七叶寂照秘密主', 'id': 'everlasting-lord-of-arcane-wisdom',
        'states': [
            {'key': 'p1', 'label': '第一阶段', 'src': '七叶寂照秘密主·半身'},
            {'key': 'p2', 'label': '第二阶段', 'src': '七叶寂照秘密主'},
        ],
    },
    {
        'base': '吞星之鲸',
        'states': [
            {'key': 'ben', 'label': '本体', 'src': '吞星之鲸'},
            {'key': 'phantom', 'label': '幻影', 'src': '吞星之鲸·幻影'},
        ],
    },
    {
        'base': '左道的胜义尊',
        'states': [
            {'key': 'p1', 'label': '第一阶段', 'src': '左道的胜义尊'},
            {'key': 'p2', 'label': '第二阶段', 'src': '左道的胜义尊·融合'},
        ],
    },
    {
        'base': '蚀灭的源焰之主', 'id': 'lord-of-eroded-primal-fire',
        'states': [
            {'key': 'ground', 'label': '地面', 'src': '蚀灭的源焰之主·地面'},
            {'key': 'air', 'label': '空中', 'src': '蚀灭的源焰之主·空中'},
        ],
    },
    {
        'base': '绿洲的守望者',
        'states': [
            {'key': 'p1', 'label': '第一阶段', 'src': '终末绿洲的守望者'},
            {'key': 'p3', 'label': '第三阶段', 'src': '起源绿洲的守望者'},
        ],
    },
    {
        'base': '「女士」',
        'states': [
            {'key': 'p1', 'label': '第一阶段', 'src': '「女士」'},
            # 二阶段在 catalog 里另有一条「焚尽的炎魔女」，这里以它为身份（头像/英文名），
            # 内容取 女士2 页，合并后列表不再出现两张卡。
            {'key': 'p2', 'label': '第二阶段', 'src': '焚尽的炎之魔女', 'page': '女士2'},
        ],
    },
    {
        'base': '祸津御建鸣神命',
        'states': [
            {'key': 'p1', 'label': '第一阶段', 'page': '祸津御建鸣神命1'},
            {'key': 'p2', 'label': '第二阶段', 'page': '祸津御建鸣神命2'},
            {'key': 'p3', 'label': '第三阶段', 'src': '祸津御建鸣神命'},
        ],
    },
    {
        'base': '「仆人」',
        'states': [
            {'key': 'p1', 'label': '第一阶段', 'src': '「仆人」'},
            {'key': 'p2', 'label': '第二阶段', 'page': '仆人2'},
        ],
    },
]

# 无同名母体的「历经百战」条目 → 分类兜底
VETERAN_CATEGORY_FALLBACK = {
    '历经百战的执灯人': 'Legends',
    '历经百战的火刃突击队员': 'Fatui',
    '历经百战的盗宝团精锐': 'OtherHumanFactions',
}


def _derive_base_stats(entry, curve):
    """源页没有 BaseHp/BaseAtk 时，用档位行的 Lv.90 绝对值 ÷ HP_2/ATK_2 曲线倍率反推。"""
    row = next((r for r in (entry.get('levelRows') or []) if r.get('hp')), None)
    if row is None or not row.get('level'):
        return
    for key, curve_name in (('hp', 'HP_2'), ('atk', 'ATK_2')):
        val = row.get(key)
        factor = (curve.get(str(row['level'])) or {}).get(CURVE_GROW_KEYS[curve_name])
        if val and factor:
            entry['baseStats'][key] = {
                'Value': round(float(val) / float(factor), 6), 'Curve': curve_name}


def fill_base_stats_from_rows(entry, curve):
    """BaseHp/BaseAtk 缺 Value（源里写成 "<569886" 等）时，用档位行的绝对值反推。"""
    rows = entry.get('levelRows') or []
    for key, default_curve in (('hp', 'HP_2'), ('atk', 'ATK_2')):
        base = entry['baseStats'].get(key) or {}
        if base.get('Value') not in (None, ''):
            continue
        row = next((r for r in rows if r.get(key) and r.get('level')), None)
        if row is None:
            continue
        curve_name = base.get('Curve') or default_curve
        grow = CURVE_GROW_KEYS.get(curve_name)
        factor = (curve.get(str(row['level'])) or {}).get(grow) if grow else None
        if factor:
            base['Value'] = round(float(row[key]) / float(factor), 6)
            base['Curve'] = curve_name
            entry['baseStats'][key] = base


def _page_entry(page_name, ctx):
    """把一页源图临时算成条目（技能 / 注解 / 抗性 / 档位），图片写到临时目录。"""
    source = ctx['sources'].get(page_name)
    if source is None:
        return None
    payload, _ = g.generate_fragment(
        source, ctx['curve'], ctx['energy_index'], ctx['icon_idx'], ctx['ref'])
    fields = payload[0][page_name]
    e = base_entry_from_fields(fields, '')
    e['_source_name'] = page_name
    e['_raw_fields'] = fields
    e['id'] = '_tmp-' + re.sub(r'[^\w·-]+', '-', page_name)
    export_images(e, fields, source)
    enrich_from_mxml(e, source)
    _derive_base_stats(e, ctx['curve'])
    return e


def _state_snapshot(entry, key, label, prefix, base_name, content_entry=None):
    content = content_entry or entry
    skills = []
    for i, sk in enumerate(content.get('skills') or []):
        s = dict(sk)
        if sk.get('icon'):
            s['icon'] = f'{prefix}skill-{i + 1}.webp' if prefix else sk['icon']
        else:
            s['icon'] = ''
        skills.append(s)
    name = entry['name']
    if (name == base_name and label != '本体') or str(entry.get('id', '')).startswith('_tmp-'):
        name = f'{base_name}·{label}'
    return {
        'key': key,
        'label': label,
        'name': name,
        'subtitle': entry.get('subtitle') or '',
        'tier': entry.get('tier') or '',
        'baseStats': entry.get('baseStats') or {},
        'levelRows': entry.get('levelRows') or [],
        'resistances': entry.get('resistances') or [],
        'skills': skills,
        'notes': content.get('notes') or [],
        'shields': content.get('shields') or [],
        'chargebar': content.get('chargebar') or [],
        'energy': entry.get('energy'),
        'weight': entry.get('weight') or '',
        'elementMastery': entry.get('elementMastery', 0),
        'multiplayerGroup': entry.get('multiplayerGroup', ''),
        'icon': (prefix + 'avatar.webp') if prefix else (entry.get('icon') or ''),
        'defaultLevel': entry.get('defaultLevel'),
    }


def merge_state_groups(entries, ctx):
    """把同一 boss 的多阶段 / 多形态条目并成一条，状态写进 states[]，图片加 state-<key>- 前缀。"""
    img_root = ctx['img_root']
    removed = set()
    for grp in STATE_GROUPS:
        metas, snaps, host = [], [], None
        for sp in grp['states']:
            src = next((e for e in entries if e['name'] == sp['src']), None) if sp.get('src') else None
            page = _page_entry(sp['page'], ctx) if sp.get('page') else None
            entry = src or page
            if entry is None:
                print(f'  ⚠ 状态缺源：{grp["base"]} / {sp.get("src") or sp.get("page")}')
                continue
            primary = not snaps
            prefix = '' if primary else f'state-{sp["key"]}-'
            snap = _state_snapshot(
                entry, sp['key'], sp['label'], prefix, grp['base'],
                content_entry=page if (page and src) else None)
            snaps.append(snap)
            metas.append({'entry': entry, 'snap': snap, 'primary': primary,
                          'avatar_id': entry['id'], 'skill_id': (page or entry)['id'],
                          'page': sp.get('page'), 'src': sp.get('src')})
            if primary:
                host = entry
        if host is None:
            continue

        base_ident = next((e for e in entries if e['name'] == grp['base']), None)
        if base_ident is not None and base_ident is not host:
            for f in ('category', 'categoryLabel', 'nameEn'):
                if base_ident.get(f):
                    host[f] = base_ident[f]
        old_host_name = host['name']
        host['name'] = grp['base']
        if grp.get('id'):
            host['id'] = grp['id']
        elif base_ident is not None and base_ident is not host:
            host['id'] = base_ident['id']  # 主状态是源页临时条目时，沿用组基名的 id
        for f in ('baseStats', 'levelRows', 'resistances', 'skills', 'notes', 'shields',
                  'chargebar', 'energy', 'weight', 'elementMastery', 'multiplayerGroup',
                  'subtitle', 'tier', 'defaultLevel', 'icon'):
            if f in snaps[0]:
                host[f] = snaps[0][f]
        if not host.get('tier') and base_ident is not None and base_ident.get('tier'):
            host['tier'] = base_ident['tier']
        if not host.get('subtitle') and base_ident is not None and base_ident.get('subtitle'):
            host['subtitle'] = base_ident['subtitle']
        host['states'] = snaps
        host['defaultState'] = snaps[0]['key']

        dest_dir = img_root / host['id']
        dest_dir.mkdir(parents=True, exist_ok=True)
        for p in dest_dir.glob('state-*'):
            p.unlink()
        for meta in sorted(metas, key=lambda m: m['primary']):
            prefix = '' if meta['primary'] else f'state-{meta["snap"]["key"]}-'
            av_src = img_root / meta['avatar_id'] / 'avatar.webp'
            if av_src.exists():
                av_dst = dest_dir / f'{prefix}avatar.webp'
                if av_src.resolve() != av_dst.resolve():
                    shutil.copyfile(av_src, av_dst)
                meta['snap']['icon'] = f'{prefix}avatar.webp'
            else:
                meta['snap']['icon'] = ''
            sk_dir = img_root / meta['skill_id']
            for i, sk in enumerate(meta['snap']['skills']):
                if not sk.get('icon'):
                    continue
                src_f = sk_dir / f'skill-{i + 1}.webp'
                if not src_f.exists():
                    sk['icon'] = ''
                    continue
                dst_f = dest_dir / f'{prefix}skill-{i + 1}.webp'
                if src_f.resolve() != dst_f.resolve():
                    shutil.copyfile(src_f, dst_f)
                sk['icon'] = f'{prefix}skill-{i + 1}.webp'
            # 状态页自己的 fxg：多阶段 boss 的技能是各页独有的，母体那套图标对不上，
            # 按技能名从该状态的源页补（门扉前的弈局 / 祸津御建鸣神命 / 七叶寂照秘密主…）。
            if any(not sk.get('icon') for sk in meta['snap']['skills']):
                page_src = (ctx['sources'].get(meta.get('page') or '')
                            or ctx['sources'].get(meta.get('src') or ''))
                fill_skill_icons(meta['snap']['skills'], page_src, dest_dir, prefix)

        # 顶层头像 = 主状态的图。源页临时条目（_page_entry）初始 icon 为空，
        # 而上面的字段复制发生在导出图片之前，不回填的话列表卡片会没头像。
        host['icon'] = next(
            (sn['icon'] for sn in snaps if sn.get('icon') and not sn['icon'].startswith('state-')),
            host.get('icon') or '',
        )

        for meta in metas:
            if meta['entry'] is not host:
                removed.add(id(meta['entry']))
        if (base_ident is not None and base_ident is not host
                and not any(base_ident is m['entry'] for m in metas)):
            removed.add(id(base_ident))

        aliases = list(host.get('aliases') or [])
        for nm in [old_host_name] + [m['entry']['name'] for m in metas]:
            if nm and nm != host['name'] and nm not in aliases:
                aliases.append(nm)
        if aliases:
            host['aliases'] = aliases
        if not any(host is e for e in entries):  # 主状态来自临时源页条目时需补回列表
            entries.append(host)
        print(f'  多状态合并：{host["name"]}（{"/".join(s["label"] for s in snaps)}）')
    return [e for e in entries if id(e) not in removed]


# ──────────────── 覆盖（上游源错版时的正版数据） ────────────────
def _fxg_inline_markup(body):
    """fxg 行内富文本 → 站内富文本（颜色继续走 convert_richtext 那套）。"""
    t = re.sub(r'<span[^>]*?color="(#[0-9a-fA-F]{6})"[^>]*>(.*?)</span>',
               r'<color=\1>\2</color>', body, flags=re.S)
    t = re.sub(r'<span[^>]*>(.*?)</span>', r'\1', t, flags=re.S)
    t = re.sub(r'</?content>', '', t)
    t = re.sub(r'<p[^>]*>', '', t).replace('</p>', '\n')
    t = re.sub(r'<br\s*/?>', '\n', t)
    t = convert_richtext(t)
    # 只清站内不认识的标签：<c=#hex>…</c> 是富文本颜色，必须留着
    t = re.sub(r'<(?!/?c=|/c>)[a-zA-Z/][^>]*>', '', t)
    return re.sub(r'\n{2,}', '\n', t).strip()


def fxg_paragraphs(fxg_path):
    """fxg → [(x, y, 站内富文本)]；按坐标取文案，上游改版后顺序变了也不会串行。"""
    raw = fxg_path.read_text(encoding='utf-8')
    out = []
    for m in re.finditer(r'<RichText x="(-?\d+)" y="(-?\d+)"[^>]*>(.*?)</RichText>', raw, re.S):
        text = _fxg_inline_markup(m.group(3))
        if text:
            out.append((int(m.group(1)), int(m.group(2)), text))
    return out


def _paragraph_at(paragraphs, coord, label):
    """按 (x, y) 取段落，±6px 容差；取不到直接报错，避免静默写空文案。"""
    if not coord:
        return ''
    px, py = coord
    hit = next((t for x, y, t in paragraphs if abs(x - px) <= 6 and abs(y - py) <= 6), None)
    if hit is None:
        raise SystemExit(f'  ✘ 覆盖文案坐标失效：{label} ({px},{py})，请对照 fxg 重新取值')
    return hit


def _state_override_rules():
    f = WIKI_ROOT / 'scripts' / 'seed' / 'state-skill-overrides.json'
    return json.loads(f.read_text(encoding='utf-8')) if f.exists() else {}


def apply_state_skill_overrides(entries, ctx):
    """上游 mxml 内容对不上条目的（如 女士1.mxml 其实是「愚人众·霜役人」）用种子强制覆盖。

    种子结构：
        {"<条目名>": {"<state key>": {
            "fxg": "<页名>",              # 文案与技能名素材都取自这页
            "nameEn" / "subtitle" / "levelRows" / "resistances" / "energy": ...,
            "skills": [{"name", "type", "icon": "<.assets 里的文件名>", "desc": [x, y]}]
        }}}
    """
    rules = _state_override_rules()
    if not rules:
        return
    by_name = {e['name']: e for e in entries}
    for ename, states in rules.items():
        e = by_name.get(ename)
        if e is None:
            print(f'  ⚠ 覆盖目标未找到：{ename}')
            continue
        img_dir = ctx['img_root'] / e['id']
        img_dir.mkdir(parents=True, exist_ok=True)
        for key, spec in states.items():
            snap = next((s for s in e.get('states') or [] if s['key'] == key), None)
            if snap is None:
                print(f'  ⚠ 覆盖状态未找到：{ename}/{key}')
                continue
            src = ctx['sources'].get(spec.get('fxg') or '')
            paragraphs = []
            asset_dir = None
            if spec.get('skills'):
                if src is None or not src.fxg:
                    print(f'  ⚠ 覆盖源页未找到：{ename}/{key} ({spec.get("fxg")})')
                    continue
                asset_dir = asset_dir_for(src.fxg)
                if asset_dir is None:
                    print(f'  ⚠ 覆盖源缺资源目录：{ename}/{key}（{spec.get("fxg")}）')
                    continue
                paragraphs = fxg_paragraphs(src.fxg)
            primary = key == (e.get('defaultState') or '')
            prefix = '' if primary else f'state-{key}-'
            skills = None
            if spec.get('skills'):
                skills = []
                for i, sk in enumerate(spec['skills']):
                    icon = ''
                    asset = asset_dir / sk['icon'] if sk.get('icon') else None
                    if asset is not None and asset.exists():
                        icon = f'{prefix}skill-{i + 1}.webp'
                        write_skill_icon(asset, img_dir / icon)
                    skills.append({
                        'name': sk['name'],
                        'type': sk.get('type', ''),
                        'icon': icon,
                        'description': _paragraph_at(paragraphs, sk.get('desc'), f'{ename}/{sk["name"]}'),
                    })
                snap['skills'] = skills
            fields = ('name', 'nameEn', 'subtitle', 'tier', 'levelRows', 'resistances',
                      'energy', 'weight', 'defaultLevel', 'baseStats')
            for f in fields:
                if f in spec:
                    snap[f] = spec[f]
            if primary:
                if skills is not None:
                    e['skills'] = skills
                for f in fields:
                    if f in spec:
                        e[f] = spec[f]
            print(f'  覆盖：{ename}/{key}'
                  f'{" 技能 " + str(len(skills)) + " 条" if skills is not None else " 仅字段"}'
                  f'（源 {spec.get("fxg") or "—"}）')


def build_source_only_entries(sources_by_name, curve, energy_index, icon_idx, ref):
    """源独有条目（catalog 未命中）：现算 fragment，尾数字页归并。"""
    reports = json.loads(GEN_REPORT.read_text(encoding='utf-8'))
    unmatched = [r['name'] for r in reports if not r.get('catalog_candidates')]
    groups = {}
    for name in unmatched:
        source = sources_by_name.get(name)
        if source is None:
            continue
        payload, rep = g.generate_fragment(source, curve, energy_index, icon_idx, ref)
        fields = payload[0][name]
        key = noise_key(fields.get('NameZHCN') or name) or name
        score = len(fields.get('Skill') or []) + len(fields.get('Notes') or [])
        cand = groups.get(key)
        if cand is None or score > cand[0]:
            groups[key] = (score, name, fields)
    entries = []
    for key, (_score, name, fields) in sorted(groups.items()):
        source = sources_by_name.get(name)
        if name.lower().startswith('drdata'):
            continue  # 机制标注卡（壁障/蓄能进度）空壳，无怪物数据，且注解已并入左道的胜义尊·融合
        if name in DUPLICATE_SOURCES:
            continue  # 旧版重复图，内容由新版承载
        e = base_entry_from_fields(fields, '')
        e['_source_name'] = name
        e['_raw_fields'] = fields
        if source and re.search(r'tps$', name, re.I):
            e['name'] = real_title(source, e['name'])  # 文件名 → 图内真标题
        state = state_suffix(source) if source else ''
        if state and re.search(r'[a-z]$', name):  # 周本双形态：蚀灭的源焰之主e/s → ·地面/·空中
            base = re.sub(r'[a-z]$', '', e['name'])
            e['name'] = f'{base}·{state}'
        aliases = [old for old, new in DUPLICATE_SOURCES.items() if new == name]
        if aliases:
            e['aliases'] = aliases
        entries.append(e)
    return entries


def main():
    out_dir = WIKI_ROOT / 'src' / 'data' / 'enemies'
    items_dir = out_dir / 'items'
    items_dir.mkdir(parents=True, exist_ok=True)

    curve = g.load_json(SOURCE_ROOT / 'MonsterCurveExcelConfigData.json', dict, '')
    energy_rows_raw = g.load_json(SOURCE_ROOT / 'MonsterEnergyDropExcelData.json', list, '')
    global ENERGY_TABLE
    ENERGY_TABLE = {r['EnergyGroup']: r for r in energy_rows_raw}
    energy_index = g.build_energy_index(energy_rows_raw)
    icon_idx = g.IconHashIndex.build(SOURCE_ROOT / 'icons')
    ref = g.load_reference_catalog([])
    challenges = g.load_leyline_challenges(SOURCE_ROOT / 'LeylineChallengeLevelExcelData.json')

    collected = load_collected()
    id_sources = load_id_sources()
    sources = g.discover_sources(SOURCE_ROOT / 'fxg', SOURCE_ROOT / 'mxml')
    sources_by_name = {s.name: s for s in sources}
    print(f'collected {len(collected)} · sources {len(sources)}')

    def pick_source(id_or_name, source_names):
        for n in source_names or []:
            s = sources_by_name.get(n)
            if s and s.fxg and s.mxml:
                return s
        for n in source_names or []:
            s = sources_by_name.get(n)
            if s:
                return s
        return None

    # 1) catalog 条目
    entries = []
    for internal_id in sorted(collected):
        fields = collected[internal_id]
        e = base_entry_from_fields(fields, internal_id)
        source = pick_source(internal_id, id_sources.get(internal_id))
        e['_source_name'] = source.name if source else ''
        e['energy'] = energy_from_group(
            (fields.get('EnergyDrop') or {}).get('EnergyGroup'),
            (fields.get('EnergyDrop') or {}).get('Type'),
        )
        entries.append(e)

    # 2) 源独有条目
    entries += build_source_only_entries(sources_by_name, curve, energy_index, icon_idx, ref)

    # 3) Wayob 曲线归一（源 bug：BaseHp.Curve 误写 ATK_1）
    for e in entries:
        if e['_internal_id'].startswith('Wayob_Shamansaurus'):
            hp = e['baseStats'].get('hp') or {}
            if hp.get('Curve') == 'ATK_1':
                hp['Curve'] = 'HP_1'

    # 3.5) 源独有 ↔ catalog 同名合并（如「祸津御建鸣神命」：catalog 占位空壳 + 源页有内容）
    catalog_keys = {noise_key(e['name']): e for e in entries if e['_internal_id']}
    keep = []
    for e in entries:
        if e['_internal_id']:
            keep.append(e)
            continue
        c = catalog_keys.get(noise_key(e['name']))
        if c is None:
            keep.append(e)
            continue
        src_score = len(e['skills']) + len(e['notes']) + len(e['levelRows'])
        cat_score = len(c['skills']) + len(c['notes']) + len(c['levelRows'])
        if src_score > cat_score:
            for f in ('notes', 'shields', 'resistances', 'energy',
                      'subtitle', 'nameEn', 'name'):
                if e.get(f):
                    c[f] = e[f]
            c['_raw_fields'] = e.get('_raw_fields') or c.get('_raw_fields')
            if not c.get('_source_name'):
                c['_source_name'] = e.get('_source_name', '')
            print(f'  同名合并：{c["name"]} ← 源页内容（catalog 身份保留）')
        # 技能/等级行永远取并集（TPS 图等补充内容不丢）
        have_skill = {s.get('name') for s in c.get('skills', [])}
        for s in e.get('skills', []):
            if s.get('name') not in have_skill:
                c['skills'].append(s)
                have_skill.add(s.get('name'))
        have_row = {(r.get('label'), r.get('level')) for r in c.get('levelRows', [])}
        for r in e.get('levelRows', []):
            if (r.get('label'), r.get('level')) not in have_row:
                c['levelRows'].append(r)
                have_row.add((r.get('label'), r.get('level')))
        # 源独有重复条目丢弃
    entries = keep

    # 4) id 分配（确定性；nameEn 优先，冲突回退内部名/中文名）
    used = set()
    for e in sorted(entries, key=lambda x: (x['_internal_id'], x['name'])):
        cands = [slugify(e['nameEn']), slugify_zh(e['name']),
                 slugify_zh(noise_key(e['name']))]
        if e['_internal_id']:
            cands.append(slugify(e['_internal_id']))
        eid = next((c for c in cands if c and c not in used), '')
        if not eid:
            eid = 'enemy'
        base_eid, n = eid, 2
        while eid in used:
            eid = f'{base_eid}-{n}'
            n += 1
        used.add(eid)
        e['id'] = eid

    by_name = {}
    for e in entries:
        by_name.setdefault(norm_key(e['name']), e)

    # 5) 幽境变体：挂到母体（challenge 表 → 源名解析 → mxml 文本含母体名，最长命中）
    def is_leyline_entry(e):
        return e['category'] in ('StygianOnslaught', 'LeyLine', 'Leyline')

    def find_base(ley_e, ley_source):
        mid = ley_e['_internal_id']
        candidates = [e for e in entries if e is not ley_e and not is_leyline_entry(e)]

        # 0) 种子改挂：幽境名 → 指定真名条目。母体不是同名家族时用，
        #    如「历经百战的玳龟·坚盾轰霆」应挂地方传奇「科西霍」而不是野怪「玳龟」。
        _rp = _load_leyline_reparent().get(norm_key(ley_e.get('name') or ''))
        if _rp:
            for e in candidates:
                if norm_key(e['name']) == norm_key(_rp):
                    return e
            print(f'  ⚠ 幽境改挂目标未找到：{ley_e["name"]} → {_rp}')

        def match_exact(e, target):
            ek = norm_key(e['name'])
            return ek == target or norm_key(strip_prefixes(ek)) == norm_key(strip_prefixes(target))

        def match_prefix_best(target):
            """家族前缀（双向），公共前缀最长、长度差最小者优先。"""
            best, best_score = None, None
            for e in candidates:
                ek = norm_key(e['name'])
                lo, hi = sorted((ek, target), key=len)
                if len(lo) >= 3 and hi.startswith(lo):
                    score = (len(lo), -abs(len(ek) - len(target)))
                    if best_score is None or score > best_score:
                        best, best_score = e, score
            return best

        def resolve(target):
            for e in candidates:
                if match_exact(e, target):
                    return e
            return match_prefix_best(target)

        for ch in challenges:
            if ch.get('MonsterId') != mid:
                continue
            hit = resolve(norm_key(ch.get('Monster', '')))
            if hit:
                return hit
        if ley_source:
            m = re.match(r'^.+?之役-(?:历经百战的)?(.+?)·', ley_source.name or '')
            if m:
                hit = resolve(norm_key(strip_prefixes(m.group(1))))
                if hit:
                    return hit
            if ley_source.mxml:
                joined = ''.join(re.findall(r'text="([^"]+)"',
                                            ley_source.mxml.read_text(encoding='utf-8')))
                hits = [e for e in entries
                        if e is not ley_e and not is_leyline_entry(e)
                        and len(e['name']) >= 2 and e['name'] in joined]
                if hits:
                    return max(hits, key=lambda e: len(e['name']))
        # 兜底：challenge / 源名都没命中时，直接用条目自身名字解析。
        # 去战役前缀 → 去「历经百战的」→ 取「·」前段，做归一化精确匹配。
        # 例：Mandragora_Leyline「历经百战的十六倍曼陀草·风滚狂蔓」→ 十六倍曼陀草。
        cand = re.sub(r'^.+?之役-', '', ley_e.get('name') or '')
        cand = re.sub(r'^历经百战的', '', cand).split('·')[0].strip()
        if cand:
            for e in candidates:
                if norm_key(e['name']) == norm_key(cand):
                    return e
        return None

    attached = set()
    for ley_e in [e for e in entries if is_leyline_entry(e)]:
        ley_source = sources_by_name.get(ley_e['_source_name']) if ley_e['_source_name'] else None
        base = find_base(ley_e, ley_source)
        if base is None:
            continue
        img_dir = WIKI_ROOT / 'public' / 'images' / 'enemies' / base['id']
        img_dir.mkdir(parents=True, exist_ok=True)
        # 技能图标：IconPath 查 icons/ 树 → fxg 摆放定位；写到母体目录（leyline-skill-N.webp）
        fields_skills = ley_e['skills']
        raw_skills = (collected.get(ley_e['_internal_id'])
                      or ley_e.get('_raw_fields') or {}).get('SkillDiffer') \
            or [{'IconPath': ''} for _ in fields_skills]
        for i, sk in enumerate(raw_skills):
            dest = img_dir / f'leyline-skill-{i + 1}.webp'
            src = resolve_icon_file(sk.get('IconPath'))
            if src:
                write_skill_icon(src, dest)
            elif ley_source and ley_source.fxg and ley_source.mxml:
                asset_dir = asset_dir_for(ley_source.fxg)
                rows = extract_skill_rows(parse_mxml_blocks(ley_source.mxml))
                fb = (find_skill_icons(ley_source.fxg, asset_dir, rows)
                      if rows and asset_dir else [])
                if i < len(fb) and fb[i]:
                    write_skill_icon(fb[i], dest)
                else:
                    continue
            else:
                continue
            if i < len(fields_skills):
                fields_skills[i]['icon'] = dest.name
        portrait = export_portrait(ley_source, img_dir)
        base['leyline'] = {
            'name': ley_e['name'],
            'nameEn': ley_e['nameEn'],
            'category': ley_e['category'],
            'categoryLabel': ley_e['categoryLabel'],
            'portrait': portrait,
            'difficulties': extract_leyline_difficulty(parse_mxml_blocks(ley_source.mxml))
            if ley_source and ley_source.mxml else [],
            'resistances': ley_e['resistances'],
            'skills': ley_e['skills'],
            'notes': ley_e['notes'],
            'shields': ley_e['shields'],
        }
        # 幽境难度兜底：mxml 表拿不到时用 Coefficients/DefaultLevels
        if not base['leyline']['difficulties']:
            co = (collected.get(ley_e['_internal_id']) or {}).get('Coefficients') or {}
            dl = (collected.get(ley_e['_internal_id']) or {}).get('DefaultLevels') or {}
            rows = []
            for key in ('N3', 'N4', 'N5', 'N6'):
                rows.append({
                    'key': key, 'name': DIFFICULTY_NAMES.get(key, key),
                    'level': dl.get(key), 'hp': None, 'atk': None,
                    'multiplier': co.get(key), 'advantage': '',
                })
            base['leyline']['difficulties'] = rows
        # 幽境专属内容图：按「<战役>-<幽境名>」的幽境名匹配 ECLeyLine 种子图，
        # 不放基础图顶替（基础图只属于基础内容块）。
        _ley_src = _load_v2_leyline_map().get(norm_key(base['leyline']['name']))
        if _ley_src and _ley_src.exists():
            shutil.copy2(_ley_src, img_dir / 'leyline.png')
            base['leylineImages'] = ['leyline.png']
        else:
            print(f'  ⚠ 幽境内容图未匹配：{base["name"]} / {base["leyline"]["name"]}')
        # 幽境左侧立绘兜底：export_portrait 拿不到时用 scripts/seed/leyline-art-map.json 的原画。
        # （v2 的 ECLeyLine/*.png 是「全技能一图流」信息卡，不能当立绘用）
        if not base['leyline'].get('portrait'):
            _ley_art = _load_leyline_art_map().get(norm_key(base['leyline']['name']))
            if _ley_art and _ley_art.exists():
                shutil.copy2(_ley_art, img_dir / 'leyline-portrait.png')
                base['leyline']['portrait'] = 'leyline-portrait.png'
        attached.add(id(ley_e))
        print(f'  幽境挂接：{ley_e["name"]} → {base["name"]}')

    entries = [e for e in entries if id(e) not in attached]

    # 5.5) 真名归并：同一只怪在源里同时有 Legends/<Id>_Elite（真名，如「西格德」）与
    #      Veterans/<Id>_Battle（「历经百战的执灯人」）两条时，图鉴只保留真名条目，
    #      旧名进 aliases + 补「历经百战」标签。种子 scripts/seed/realname-merge.json
    #      = {"Veterans 名": "真名"}。
    _rm = _load_realname_merge()
    if _rm:
        _by_norm = {}
        for e in entries:
            _by_norm.setdefault(norm_key(e['name']), e)
        _fold = set()
        for e in entries:
            _host_name = _rm.get(norm_key(e['name']))
            _host = _by_norm.get(norm_key(_host_name)) if _host_name else None
            if not _host or _host is e:
                continue
            # 幽境块若仍挂在变体上（未走 leyline-reparent 改挂），连带资产搬给真名条目
            if e.get('leyline'):
                _src_dir = WIKI_ROOT / 'public' / 'images' / 'enemies' / e['id']
                _dst_dir = WIKI_ROOT / 'public' / 'images' / 'enemies' / _host['id']
                _dst_dir.mkdir(parents=True, exist_ok=True)
                if _src_dir.exists():
                    for _f in _src_dir.iterdir():
                        if _f.name == 'leyline.png' or _f.name.startswith('leyline-'):
                            shutil.copy2(_f, _dst_dir / _f.name)
                if not _host.get('leyline'):
                    _host['leyline'] = e['leyline']
                if e.get('leylineImages') and not _host.get('leylineImages'):
                    _host['leylineImages'] = e['leylineImages']
            _host.setdefault('aliases', [])
            if e['name'] not in _host['aliases']:
                _host['aliases'].append(e['name'])
            _host.setdefault('_extra_tags', [])
            if '历经百战' not in _host['_extra_tags']:
                _host['_extra_tags'].append('历经百战')
            _fold.add(id(e))
            print(f'  真名归并：{e["name"]} → {_host["name"]}')
        entries = [e for e in entries if id(e) not in _fold]

    # 6.0) v2.0 种子占位敌人（CI/离线兜底，GIEnemyChartXML 尚未收录的新/缺图敌人）
    #   仅当图鉴中尚无同名（归一比较）敌人时注入；XML 之后收录会自动让位，重跑不丢。
    _ph_file = WIKI_ROOT / 'scripts' / 'seed' / 'enemy-v2-placeholders.json'
    if _ph_file.exists():
        _existing = {norm_key(e['name']) for e in entries}
        _ph_list = json.loads(_ph_file.read_text(encoding='utf-8'))
        for _ph in _ph_list:
            if norm_key(_ph['name']) in _existing:
                continue
            _seed = _ph.get('seed')
            _entry = {
                '_internal_id': '',
                '_source_name': '',
                '_raw_fields': {},
                'id': _ph.get('id') or slugify_zh(_ph['name']),
                'name': _ph['name'],
                'nameEn': _ph.get('nameEn', ''),
                'subtitle': '',
                'category': _ph['category'],
                'categoryLabel': CATEGORY_LABELS.get(_ph['category'], _ph['category']),
                'tier': '',
                'defaultLevel': None,
                'baseStats': {'hp': {}, 'atk': {}, 'def': {}},
                'resistances': [],
                'elementMastery': 0,
                'multiplayerGroup': '',
                'weight': '',
                'skills': [],
                'notes': [],
                'shields': [],
                'chargebar': [],
                'energy': None,
                'levelRows': [],
                'leyline': None,
            }
            entries.append(_entry)
            _existing.add(norm_key(_ph['name']))
            print(f'  v2 占位：{_ph["name"]}（{_ph["category"]}）')

    # 6.1) 无数据幽境变体：挂到母体（源里没有该变体的条目，只补名称 + 幽境图 + 幽境标签）。
    #      种子形如 {"parent": "浪涛锚定者", "name": "浪涛锚定者·狂飙突噬", "seed": "..."}。
    _lv_file = WIKI_ROOT / 'scripts' / 'seed' / 'leyline-variants.json'
    if _lv_file.exists():
        _by_name = {norm_key(e['name']): e for e in entries}
        for _lv in json.loads(_lv_file.read_text(encoding='utf-8')):
            _base = _by_name.get(norm_key(_lv.get('parent', '')))
            if not _base:
                print(f'  ⚠ 幽境变体母体未找到：{_lv.get("parent")} / {_lv.get("name")}')
                continue
            _img_dir = WIKI_ROOT / 'public' / 'images' / 'enemies' / _base['id']
            _img_dir.mkdir(parents=True, exist_ok=True)
            _seed = WIKI_ROOT / _lv['seed'] if _lv.get('seed') else None
            if _seed and _seed.exists():
                shutil.copy2(_seed, _img_dir / 'leyline.png')
                _base['leylineImages'] = ['leyline.png']
            _base['leyline'] = {
                'name': _lv['name'],
                'nameEn': _lv.get('nameEn', ''),
                'category': 'StygianOnslaught',
                'categoryLabel': CATEGORY_LABELS.get('StygianOnslaught', '幽境危战'),
                'portrait': '',
                'difficulties': [],
                'resistances': [],
                'skills': [],
                'notes': [],
                'shields': [],
            }
            print(f'  幽境变体（无数据）：{_lv["name"]} → {_base["name"]}')

    # 6) 图片 + mxml 补数据（基础条目）
    # 源页缺 Tier、但同族/目录已标首领的周本条目 → 补齐档位（仅标注，不改数值）
    TIER_OVERRIDES = {
        '若陀龙王·水': 'Boss', '若陀龙王·火': 'Boss', '若陀龙王·雷': 'Boss',
        '蚀灭的源焰之主·地面': 'Boss', '蚀灭的源焰之主·空中': 'Boss',
    }
    for e in entries:
        if not e.get('tier') and e['name'] in TIER_OVERRIDES:
            e['tier'] = TIER_OVERRIDES[e['name']]
    img_root = WIKI_ROOT / 'public' / 'images' / 'enemies'
    for e in entries:
        internal = e['_internal_id']
        fields = collected.get(internal) or e.get('_raw_fields') or {}
        source = sources_by_name.get(e['_source_name']) if e['_source_name'] else None
        icon_files, avatar_file = export_images(e, fields, source)
        for i, sk in enumerate(e['skills']):
            sk['icon'] = icon_files[i] if i < len(icon_files) else ''
        # 图标兜底：export_images 是按行号对齐的，源页技能行数一少就整段空着；
        # 这里再按技能名补一遍（门扉前的弈局 / 祸津御建鸣神命 / 凝冰秘法师…）。
        fill_skill_icons(e['skills'], source, img_root / e['id'], '')
        e['icon'] = avatar_file
        enrich_from_mxml(e, source)
        fill_base_stats_from_rows(e, curve)

    # 6.5) 「历经百战」变体页与母体完全重复时合并（须在 enrich 之后比对内容）：
    #   技能 / 注解 / 抗性 / 档位完全一致 → 独立条目删除，变体档位作为额外属性卡挂到母体
    #   （如 波塔波的声援·秘影重现 → 波塔波的声援，只多一张 Lv100 属性卡）
    def _skill_sig(x):
        return [(s.get('name'), s.get('description')) for s in x.get('skills', [])]

    def _note_sig(x):
        return [(n.get('text'), n.get('desc')) for n in x.get('notes', [])]

    by_name = {}
    for e in entries:
        by_name.setdefault(e['name'], []).append(e)

    merged_ids = set()
    for e in list(entries):
        if e.get('category') != 'Veterans':
            continue
        if e['name'].startswith('历经百战的'):
            base_name = e['name'][len('历经百战的'):]
        elif '·' in e['name']:
            base_name = e['name'].rsplit('·', 1)[0]
        else:
            continue
        host = next((h for h in by_name.get(base_name, []) if h is not e), None)
        if host is None:
            continue
        if (_skill_sig(e) != _skill_sig(host)
                or _note_sig(e) != _note_sig(host)
                or (e.get('resistances') or []) != (host.get('resistances') or [])):
            continue
        first_label = ((host.get('levelRows') or [{}])[0] or {}).get('label')
        variants = [dict(r) for r in e.get('levelRows', []) if r.get('label') != first_label]
        if variants:
            bucket = host.setdefault('statVariants', [])
            have = {(v.get('label'), v.get('level')) for v in bucket}
            for r in variants:
                if (r.get('label'), r.get('level')) not in have:
                    bucket.append(r)
        host.setdefault('aliases', [])
        if e['name'] not in host['aliases']:
            host['aliases'].append(e['name'])
        host.setdefault('_extra_tags', [])
        if '历经百战' not in host['_extra_tags']:
            host['_extra_tags'].append('历经百战')
        merged_ids.add(id(e))
        print(f'  变体合并：{e["name"]} → {host["name"]}（额外属性卡 {len(variants)} 档）')
    entries = [e for e in entries if id(e) not in merged_ids]

    # 6.8) 多状态合并（周本多阶段 / 同场多形态）：详情页标签页切换，图鉴只留本体
    entries = merge_state_groups(entries, {
        'sources': sources_by_name,
        'curve': curve,
        'energy_index': energy_index,
        'icon_idx': icon_idx,
        'ref': ref,
        'img_root': img_root,
    })

    # 6.85) 上游源错版时的正版数据覆盖（女士一阶段：mxml 里其实是霜役人）
    apply_state_skill_overrides(entries, {
        'sources': sources_by_name,
        'img_root': img_root,
    })

    # 6.9) 「历经百战」不再单独分类：按母体归类，只保留标签
    def _veteran_host(target, pool):
        tk = norm_key(target)
        best = None
        for cand in pool:
            if cand.get('category') in ('', 'Veterans', 'NonCategorized'):
                continue
            ck = norm_key(cand['name'])
            if not tk or not ck:
                continue
            if ck == tk:
                kind = 0
            elif ck.endswith(tk):
                kind = 1
            elif ck.startswith(tk):
                kind = 2
            elif tk in ck:
                kind = 3
            else:
                continue
            score = (kind, len(ck))
            if best is None or score < best[0]:
                best = (score, cand)
        return best[1] if best else None

    for e in entries:
        if e.get('category') != 'Veterans':
            continue
        base_name = e['name'][len('历经百战的'):] if e['name'].startswith('历经百战的') else e['name']
        host = _veteran_host(base_name, [x for x in entries if x is not e])
        cat = ''
        if host is not None and host.get('category') not in ('', 'Veterans'):
            cat = host['category']
        if not cat:
            cat = VETERAN_CATEGORY_FALLBACK.get(e['name'], '')
        if not cat and e.get('tier') == 'Legend':
            cat = 'Legends'
        if cat:
            e['category'] = cat
            e['categoryLabel'] = CATEGORY_LABELS.get(cat, cat)
        e.setdefault('_extra_tags', [])
        if '历经百战' not in e['_extra_tags']:
            e['_extra_tags'].append('历经百战')
        print(f'  历经百战归类：{e["name"]} → {e["categoryLabel"]}')

    # 7) 标签 + 注解排除 + 输出
    # 用户删减的冗余注解（丘林「机制」与「冰雕」末段重复，已在页面验收时确认删除）
    NOTE_EXCLUDE = {('丘林', '机制')}

    for e in entries:
        tags = []
        if e['categoryLabel']:
            tags.append(e['categoryLabel'])
        if e.get('leyline'):
            tags.append('幽境危战')
        for t in e.get('_extra_tags', []):
            if t not in tags:
                tags.append(t)
        e['tags'] = tags
        for holder in [e] + ([e['leyline']] if e.get('leyline') else []):
            holder['notes'] = [n for n in holder.get('notes', [])
                               if (e['name'], n['text'].strip()) not in NOTE_EXCLUDE]

    # 6.2) 幽境变体并入母体（源里独立成条、实际是母体的幽境形态）：
    #      数据搬进母体 leyline 块，图片复制为 leyline.png，删除独立条目。
    #      scripts/seed/leyline-merge.json → [{"child_id": "...", "parent": "母体名"}]
    _merge_file = WIKI_ROOT / 'scripts' / 'seed' / 'leyline-merge.json'
    if _merge_file.exists():
        for _rule in json.loads(_merge_file.read_text(encoding='utf-8')):
            _child = next((x for x in entries if x['id'] == _rule.get('child_id')), None)
            _parent = next((x for x in entries if x['name'] == _rule.get('parent')), None)
            if not _child or not _parent:
                continue
            _parent['leyline'] = {
                'name': _child['name'],
                'nameEn': _child.get('nameEn', ''),
                'category': _child.get('category', ''),
                'categoryLabel': _child.get('categoryLabel', ''),
                'portrait': '',
                'difficulties': [],
                'resistances': _child.get('resistances') or [],
                'skills': _child.get('skills') or [],
                'notes': _child.get('notes') or [],
                'shields': _child.get('shields') or [],
            }
            _tg = _parent.setdefault('tags', [])
            if '幽境危战' not in _tg:
                _tg.append('幽境危战')
            if _rule.get('alias'):
                _al = _parent.setdefault('aliases', [])
                if _rule['alias'] not in _al:
                    _al.append(_rule['alias'])
            _cimgs = _child.get('images') or []
            if _cimgs:
                _src = WIKI_ROOT / 'public' / 'images' / 'enemies' / _child['id'] / _cimgs[0]
                if _src.exists():
                    _dst_dir = WIKI_ROOT / 'public' / 'images' / 'enemies' / _parent['id']
                    _dst_dir.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(_src, _dst_dir / 'leyline.png')
                    _parent['leylineImages'] = ['leyline.png']
            entries.remove(_child)
            print(f'  合并幽境变体：{_child["name"]} → {_parent["name"]}')

    # 6.95) 模仿类首领的招式补充：如「深邃摹结株·I/II/III型」会模仿 13 个首领的招式，
    #       但源 JSON 只给 2 个本体技能，招式文字只在 fxg 排版里 → 用种子补进 skills，
    #       招式名后缀「 *来源怪物*」（本体「深邃摹结株」不加）。
    #       种子 scripts/seed/papilla-mimic-skills.json = {变体名: [{name, source, description}]}
    _pm_file = WIKI_ROOT / 'scripts' / 'seed' / 'papilla-mimic-skills.json'
    if _pm_file.exists():
        _pm = json.loads(_pm_file.read_text(encoding='utf-8'))
        _by_norm = {norm_key(e['name']): e for e in entries}
        for _ename, _skills in _pm.items():
            _e = _by_norm.get(norm_key(_ename))
            if not _e:
                print(f'  ⚠ 模仿招式目标未找到：{_ename}')
                continue
            _have = {s.get('name') for s in _e.get('skills', [])}
            _added = 0
            for _s in _skills:
                _full = f'{_s["name"]} *{_s["source"]}*'
                if _full in _have:
                    continue
                _e.setdefault('skills', []).append({
                    'name': _full,
                    'type': '',
                    'icon': '',
                    'description': _s.get('description', ''),
                })
                _have.add(_full)
                _added += 1
            if _added:
                print(f'  模仿招式：{_ename} +{_added} 条（共 {len(_e["skills"])}）')

    index = []
    for e in sorted(entries, key=lambda x: (x['categoryLabel'], x['name'])):
        item = {k: v for k, v in e.items() if not k.startswith('_')}
        (items_dir / f'{e["id"]}.json').write_text(
            json.dumps(item, ensure_ascii=False, indent=1), encoding='utf-8')
        index.append({
            'id': e['id'],
            'name': e['name'],
            'nameEn': e['nameEn'],
            'category': e['category'],
            'categoryLabel': e['categoryLabel'],
            'tier': e['tier'],
            'icon': e['icon'],
            'hasLeyline': bool(e.get('leyline')),
            'leyName': (e.get('leyline') or {}).get('name', ''),
            'aliases': e.get('aliases', []),
            'tags': e['tags'],
            'stateCount': len(e.get('states') or []),
        })

    # 清理本轮未产出的旧文件（items json + 图片目录）
    used_ids = {e['id'] for e in entries}
    for p in items_dir.glob('*.json'):
        if p.stem not in used_ids:
            p.unlink()
    img_root = WIKI_ROOT / 'public' / 'images' / 'enemies'
    if img_root.exists():
        for d in img_root.iterdir():
            if d.is_dir() and d.name not in used_ids:
                for f in d.iterdir():
                    f.unlink()
                d.rmdir()

    # 分类表（固定顺序，含计数）
    categories = []
    seen = {}
    for e in index:
        seen[e['category']] = seen.get(e['category'], 0) + 1
    # 幽境危战：跨分类筛选维度。条目保留自身分类（自律机关/地方传奇…），
    # 这里只按「有没有幽境块」计数，让筛选栏的「幽境危战」始终可用。
    _ley_count = sum(1 for e in index if e.get('hasLeyline'))
    for cat, label in CATEGORY_LABELS.items():
        if cat == 'StygianOnslaught':
            if _ley_count:
                categories.append({'key': cat, 'label': label, 'count': _ley_count})
            continue
        if cat in seen and not (cat in ('EnemiesOfNote', 'MysticalBeasts', 'LeyLine', 'Leyline')):
            categories.append({'key': cat, 'label': label, 'count': seen[cat]})
            del seen[cat]

    # 成长曲线倍率表（滑块用）：只导出实际用到的曲线，Lv.1~110
    used_curves = set()
    for e in entries:
        for k in ('hp', 'atk'):
            c = (e['baseStats'].get(k) or {}).get('Curve')
            if c in CURVE_GROW_KEYS:
                used_curves.add(c)
    curves_out = {}
    for name in sorted(used_curves):
        grow = CURVE_GROW_KEYS[name]
        curves_out[name] = [
            (curve.get(str(lv)) or {}).get(grow) for lv in range(1, LEVEL_MAX + 1)
        ]

    (out_dir / 'index.json').write_text(
        json.dumps({'categories': categories, 'enemies': index, 'curves': curves_out},
                   ensure_ascii=False, indent=1),
        encoding='utf-8')
    print(f'✔ index.json {len(index)} 条 · 分类 {len(categories)}')
    print(f'✔ items/ {len(list(items_dir.glob("*.json")))} 文件')


if __name__ == '__main__':
    main()
