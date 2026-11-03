/**
 * palette.js — 配色单一数据源的运行时出口。
 * tokens.css 由 scripts/build-palette.mjs 从同一份 palette.json 生成；
 * JS 里需要具体色值（hexToRgba、内联 style）时从这里取，避免各处硬编码。
 */
import palette from '../data/palette.json';

export default palette;

/** 元素主色（key 与 palette.element 一致：pyro / hydro / …） */
export const ELEMENT_HEX = Object.fromEntries(
  Object.entries(palette.element).map(([key, el]) => [key, el.color.hex]),
);

/** 元素浅色 / 描边等变体 */
export const elementVariant = (key, variant = 'color') =>
  palette.element[key]?.[variant]?.hex || palette.element.physical.color.hex;

/** 稀有度（'5' … '1'、'special5'）取色 */
export const rarityHex = (star, part = 'bg') =>
  palette.rarity[String(star)]?.[part]?.hex || palette.rarity['3'][part].hex;

/** 站点旧元素 id（火/水/雷/冰/风/岩/草）→ palette key */
export const LEGACY_ELEMENT_KEY = {
  fire: 'pyro',
  water: 'hydro',
  thunder: 'electro',
  ice: 'cryo',
  wind: 'anemo',
  rock: 'geo',
  grass: 'dendro',
};
