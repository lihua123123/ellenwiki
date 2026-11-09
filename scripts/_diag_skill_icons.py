#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""诊断：哪些条目的技能没有图标，以及原因分类。

用法：
    set ELLEN_CHART_ROOT=D:\\EllenDB\\workspace\\ec_tmp\\gixml
    python scripts/_diag_skill_icons.py [--list]
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

WIKI = Path(__file__).resolve().parents[1]
ITEMS = WIKI / 'src' / 'data' / 'enemies' / 'items'
IMG_ROOT = WIKI / 'public' / 'images' / 'enemies'

spec_path = WIKI / 'scripts' / 'generate-enemies.py'
import importlib.util

spec = importlib.util.spec_from_file_location('ge', spec_path)
ge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ge)

_SRC = None


def sources():
    global _SRC
    if _SRC is None:
        _SRC = ge.g.discover_sources(ge.SOURCE_ROOT / 'fxg', ge.SOURCE_ROOT / 'mxml')
    return _SRC


def lookup(page):
    """页名 → source（先精确，再按 stem 归一）。"""
    if not page:
        return None
    for s in sources():
        if s.name == page:
            return s
    for s in sources():
        if s.name.lower() == str(page).lower():
            return s
    return None


def icon_pool(fxg):
    asset_dir = ge.asset_dir_for(fxg)
    if asset_dir is None:
        return 0
    n = 0
    for x, y, asset in ge.parse_fxg_images(fxg):
        if not asset:
            continue
        size = ge.asset_size(asset_dir, asset)
        if size and 110 <= size[0] <= 140 and 110 <= size[1] <= 140:
            n += 1
    return n


def probe(page, missing):
    """给定页名与缺失数量，返回 (原因, 明细)。"""
    s = lookup(page)
    if s is None or s.fxg is None:
        return '无 fxg 源', f'{page or "(空)"}'
    pool = icon_pool(s.fxg)
    if pool == 0:
        return 'fxg 里没有 128×128 图标', f'{page}'
    if s.mxml is None:
        return '有图标素材但没有 mxml 行', f'{page}(池{pool})'
    blocks = ge.parse_mxml_blocks(s.mxml)
    rows = [t for t in blocks
            if re.match(r'^([^<>]+?)-([\u4e00-\u9fa5]{2,4})$', t[2].strip().replace('\n', ''))]
    if len(rows) < missing:
        return 'mxml 技能行少于技能数', f'{page}(行{len(rows)}<缺{missing})'
    if pool < missing:
        return '图标素材少于技能数', f'{page}(池{pool}<缺{missing})'
    return '行列匹配落空（位置偏差）', f'{page}(行{len(rows)}池{pool})'


def main():
    show_list = '--list' in sys.argv
    groups = {g['base']: g for g in ge.STATE_GROUPS}
    reason = Counter()
    by_entry = []
    total_missing = 0

    for path in sorted(ITEMS.glob('*.json')):
        entry = json.loads(path.read_text(encoding='utf-8'))
        grp = groups.get(entry.get('name'))
        fallback = [entry.get('name'), *(entry.get('aliases') or [])]
        jobs = [('顶层', entry.get('skills') or [], fallback)]
        for st in entry.get('states') or []:
            sp = next((s for s in grp['states'] if s['key'] == st.get('key')), None) if grp else None
            pages = [sp.get('page') or sp.get('src')] if sp else []
            jobs.append((f'state-{st.get("key")}', st.get('skills') or [], pages + fallback))

        miss_here, why = 0, []
        for label, skills, pages in jobs:
            missing = [s for s in skills if not s.get('icon')]
            if not missing:
                continue
            miss_here += len(missing)
            hit, detail = '无 fxg 源', ''
            for pg in pages:
                hit, detail = probe(pg, len(missing))
                if hit != '无 fxg 源':
                    break
            reason[hit] += len(missing)
            why.append(f'{label}:{detail}')
        if miss_here:
            total_missing += miss_here
            by_entry.append((entry['name'], entry['id'], miss_here, '; '.join(why)))

    print(f'缺图标技能 {total_missing} 个 / {len(by_entry)} 个条目\n')
    for k, v in reason.most_common():
        print(f'  {v:4d}  {k}')
    if show_list:
        print()
        for name, eid, n, why in sorted(by_entry, key=lambda t: -t[2]):
            print(f'  {n:3d}  {name} ({eid})  — {why}')


if __name__ == '__main__':
    main()
