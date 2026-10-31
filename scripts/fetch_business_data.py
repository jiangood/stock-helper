#!/usr/bin/env python3
"""Fetch public commodity/spot-futures data for the Stock Helper business tab.

Data providers are accessed through AKShare. The script deliberately writes only
validated numeric observations and never fabricates a quote when a source fails.
"""
from __future__ import annotations

import json
import math
import os
import re
import signal
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "business-data.json"
LOOKBACK_DAYS = 365
SOURCE_TIMEOUT_SECONDS = 35

PRODUCTS = [
    {"id": "soda-ash", "name": "纯碱", "unit": "元/吨", "symbol": "SA", "aliases": ["纯碱", "SA"], "stocks": ["双环科技", "中盐化工", "三友化工"], "chain": "玻璃、光伏玻璃、日用玻璃、硅酸钠", "drivers": "重点看厂家库存、开工率、检修与新增产能；同时跟踪煤炭、合成氨成本。"},
    {"id": "urea", "name": "尿素", "unit": "元/吨", "symbol": "UR", "aliases": ["尿素", "UR"], "stocks": ["四川美丰"], "chain": "煤头/气头生产 → 农业与工业需求", "drivers": "看农业需求季节性、出口政策、日产量、企业库存和煤气成本。"},
    {"id": "methanol", "name": "甲醇", "unit": "元/吨", "symbol": "MA", "aliases": ["甲醇", "MA"], "stocks": ["双环科技"], "chain": "煤/天然气 → 甲醇 → 烯烃、甲醛等", "drivers": "看煤价、天然气、港口库存、装置检修和下游利润；公司实际业务暴露需核实。"},
    {"id": "tio2", "name": "钛白粉", "unit": "元/吨", "symbol": None, "aliases": ["钛白粉", "金红石型钛白粉"], "stocks": ["安纳达"], "chain": "钛矿/硫酸 → 钛白粉 → 涂料、塑料、造纸", "drivers": "看钛矿和硫酸成本、行业开工率、出口、库存及企业调价。"},
    {"id": "aluminium", "name": "电解铝", "unit": "元/吨", "symbol": "AL", "aliases": ["铝", "电解铝", "AL"], "stocks": ["中国铝业"], "chain": "氧化铝/电力 → 电解铝 → 加工材", "drivers": "看铝价与氧化铝、电力成本价差，关注产能约束、库存和下游需求。"},
    {"id": "coal", "name": "煤炭", "unit": "元/吨", "symbol": None, "aliases": ["动力煤", "焦煤", "煤炭", "炼焦煤"], "stocks": ["华阳股份"], "chain": "矿山供给 → 电力、钢铁、化工", "drivers": "动力煤与焦煤用途不同；要区分煤种、产地和交货口径，不能混用价格。"},
    {"id": "rubber", "name": "天然橡胶", "unit": "元/吨", "symbol": "RU", "aliases": ["天然橡胶", "RU"], "stocks": ["海南橡胶"], "chain": "天然橡胶 → 轮胎、汽车、工业制品", "drivers": "看主产区天气、割胶季、库存、轮胎开工和合成胶价差。"},
    {"id": "rare-earth", "name": "稀土（氧化镨钕）", "unit": "元/吨", "symbol": None, "aliases": ["氧化镨钕"], "stocks": ["北方稀土", "盛和资源"], "chain": "稀土矿/分离 → 磁材 → 新能源车、风电、电机", "drivers": "关注配额、分离产量、磁材需求、出口政策和上下游库存。"},
    {"id": "maleic-anhydride", "name": "顺酐", "unit": "元/吨", "symbol": None, "aliases": ["顺酐", "马来酸酐", "顺丁烯二酸酐"], "stocks": ["齐翔腾达"], "chain": "正丁烷氧化 → 顺酐 → 不饱和聚酯树脂、BDO、THF等", "drivers": "关注正丁烷成本、装置开工、厂家库存、下游不饱和聚酯树脂需求及出口。"},
    {"id": "live-hog", "name": "生猪", "unit": "元/公斤", "symbol": None, "aliases": ["生猪", "活猪"], "stocks": ["天康生物"], "chain": "玉米/豆粕等饲料 → 生猪养殖 → 屠宰及猪肉消费", "drivers": "关注能繁母猪存栏、仔猪价格、出栏体重、养殖成本、猪粮比、屠宰开工和冻品库存。"},
    {"id": "corn", "name": "玉米", "unit": "元/吨", "symbol": "C", "aliases": ["玉米", "黄玉米"], "stocks": ["天康生物"], "chain": "玉米 → 饲料加工 → 生猪养殖", "drivers": "关注产区天气、进口、港口库存、深加工需求和饲料采购。"},
    {"id": "soybean-meal", "name": "豆粕", "unit": "元/吨", "symbol": "M", "aliases": ["豆粕"], "stocks": ["天康生物"], "chain": "大豆压榨 → 豆粕 → 饲料 → 生猪养殖", "drivers": "关注大豆到港、压榨开机、油厂库存、基差和饲料需求。"},
    {"id": "gold", "name": "黄金", "unit": "元/克", "symbol": "AU", "aliases": ["黄金", "金锭"], "stocks": ["恒邦股份", "株冶集团"], "chain": "金矿/冶炼 → 黄金及金锭", "drivers": "关注美元、实际利率、央行购金、矿山供给与冶炼加工费。"},
    {"id": "silver", "name": "白银", "unit": "元/千克", "symbol": "AG", "aliases": ["白银", "银锭"], "stocks": ["恒邦股份", "株冶集团"], "chain": "银矿/伴生金属冶炼 → 白银", "drivers": "关注工业需求、光伏用银、金银比、矿山供给及库存。"},
    {"id": "copper", "name": "电解铜", "unit": "元/吨", "symbol": "CU", "aliases": ["铜", "电解铜"], "stocks": ["恒邦股份", "河钢资源"], "chain": "铜矿 → 冶炼 → 电解铜", "drivers": "关注矿端TC、冶炼开工、库存、美元及电网和新能源需求。"},
    {"id": "iron-ore", "name": "铁矿石", "unit": "元/吨", "symbol": "I", "aliases": ["铁矿石", "磁铁矿"], "stocks": ["河钢资源"], "chain": "铁矿开采 → 选矿 → 钢铁冶炼", "drivers": "关注澳巴发运、港口库存、钢厂日耗、高炉开工和钢材利润。"},
    {"id": "tin", "name": "锡", "unit": "元/吨", "symbol": "SN", "aliases": ["锡", "锡锭"], "stocks": ["锡业股份", "华锡有色"], "chain": "锡矿 → 冶炼 → 锡锭", "drivers": "关注缅甸矿供应、冶炼开工、焊料需求、半导体和库存。"},
    {"id": "zinc", "name": "锌", "unit": "元/吨", "symbol": "ZN", "aliases": ["锌", "锌锭"], "stocks": ["株冶集团"], "chain": "锌精矿 → 冶炼 → 锌锭", "drivers": "关注矿端TC、冶炼利润、镀锌开工、基建需求和库存。"},
    {"id": "sugar", "name": "白糖", "unit": "元/吨", "symbol": "SR", "aliases": ["白糖", "食糖"], "stocks": ["中粮糖业"], "chain": "甘蔗/甜菜制糖 → 食糖", "drivers": "关注巴西产量、印度出口政策、国内压榨进度、进口和库存。"},
    {"id": "pvc", "name": "聚氯乙烯", "unit": "元/吨", "symbol": "V", "aliases": ["PVC", "聚氯乙烯"], "stocks": ["中盐化工", "中泰化学", "氯碱化工"], "chain": "电石/乙烯 → PVC → 建材及管材", "drivers": "关注电石成本、装置开工、社会库存、房地产与出口。"},
    {"id": "caustic-soda", "name": "烧碱", "unit": "元/吨", "symbol": "SH", "aliases": ["烧碱", "液碱"], "stocks": ["氯碱化工"], "chain": "氯碱电解 → 烧碱与氯气", "drivers": "关注氧化铝需求、出口、氯碱开工、液碱库存和氯碱综合利润。"},
    {"id": "alumina", "name": "氧化铝", "unit": "元/吨", "symbol": "AO", "aliases": ["氧化铝"], "stocks": ["中国铝业"], "chain": "铝土矿 → 氧化铝 → 电解铝", "drivers": "关注铝土矿供应、氧化铝厂开工、港口库存及电解铝产能。"},
    {"id": "float-glass", "name": "浮法玻璃", "unit": "元/吨", "symbol": "FG", "aliases": ["浮法玻璃"], "stocks": ["耀皮玻璃"], "chain": "纯碱、石英砂、燃料 → 浮法玻璃 → 建筑及汽车玻璃深加工", "drivers": "浮法玻璃期货是行业价格代理，需结合深加工产品结构、库存、产能与燃料成本。"},
    {"id": "pulp", "name": "纸浆", "unit": "元/吨", "symbol": "SP", "aliases": ["纸浆", "针叶浆", "阔叶浆"], "stocks": ["岳阳林纸"], "chain": "木材 → 商品浆 → 文化纸、包装纸", "drivers": "纸浆期货是商品浆成本/价格代理，不等同于公司自制浆或实际销售均价。"},
    {"id": "tdi", "name": "甲苯二异氰酸酯（TDI）", "unit": "元/吨", "symbol": None, "aliases": ["TDI", "甲苯二异氰酸酯"], "stocks": ["沧州大化"], "chain": "甲苯、硝酸、氯气 → TDI → 聚氨酯软泡", "drivers": "关注装置检修、进口、下游海绵需求与原料成本；暂无已接入的可靠连续期货序列。"},
    {"id": "polycarbonate", "name": "聚碳酸酯（PC）", "unit": "元/吨", "symbol": None, "aliases": ["聚碳酸酯", "PC"], "stocks": ["沧州大化"], "chain": "双酚A、碳酸二苯酯/光气 → PC → 电子电器、汽车", "drivers": "关注双酚A成本、装置开工、进口与下游需求；暂无已接入的可靠连续期货序列。"},
    {"id": "phosphate-iron", "name": "磷酸铁", "unit": "元/吨", "symbol": None, "aliases": ["磷酸铁"], "stocks": ["安纳达"], "chain": "磷源、铁源 → 磷酸铁 → 磷酸铁锂正极材料", "drivers": "需区分电池级规格与普通工业级报价；暂无已接入的可靠连续期货序列。"},
    {"id": "molybdenum", "name": "钼产品", "unit": "元/吨", "symbol": None, "aliases": ["钼精矿", "钼铁", "氧化钼", "钼产品"], "stocks": ["金钼股份"], "chain": "钼矿 → 钼精矿、氧化钼、钼铁及深加工", "drivers": "不同加工环节价格不可混用，暂无统一连续期货价格序列。"},
    {"id": "tantalum-niobium", "name": "钽铌产品", "unit": "元/吨", "symbol": None, "aliases": ["钽铌", "钽铌产品", "钽铌及其合金制品"], "stocks": ["东方钽业"], "chain": "钽铌矿 → 氧化物、粉末、合金及制品", "drivers": "产品规格差异大且公开报价口径不统一，暂无可直接比较的连续市场价格。"},
    {"id": "titanium-material", "name": "钛材", "unit": "元/吨", "symbol": None, "aliases": ["钛材", "钛及钛合金", "钛产品"], "stocks": ["宝钛股份", "金天钛业"], "chain": "钛矿 → 海绵钛 → 钛锭、钛板及钛合金材", "drivers": "钛材价格与钛白粉、钛精矿并非同一环节，暂无可直接替代的连续期货序列。"},
    {"id": "vanadium", "name": "钒产品", "unit": "元/吨", "symbol": None, "aliases": ["钒产品", "五氧化二钒", "钒铁"], "stocks": ["钒钛股份"], "chain": "钒钛磁铁矿 → 含钒渣 → 五氧化二钒、钒铁", "drivers": "需区分五氧化二钒与钒铁报价，暂无已接入的可靠连续期货序列。"},
    {"id": "carbon-fiber", "name": "碳纤维", "unit": "元/吨", "symbol": None, "aliases": ["碳纤维"], "stocks": ["中复神鹰"], "chain": "丙烯腈/沥青基原料 → 原丝 → 碳纤维", "drivers": "需按型号、强度等级区分报价，暂无已接入的可靠连续期货序列。"},
    {"id": "viscose-staple-fiber", "name": "粘胶短纤", "unit": "元/吨", "symbol": None, "aliases": ["粘胶短纤", "粘胶短纤维"], "stocks": ["三友化工"], "chain": "棉浆粕/木浆 → 粘胶短纤 → 纺织纱线", "drivers": "关注棉浆粕、烧碱、硫酸成本及纺织开工；暂无连续期货序列。"},
    {"id": "methionine", "name": "蛋氨酸", "unit": "元/吨", "symbol": None, "aliases": ["蛋氨酸", "甲硫氨酸"], "stocks": ["安迪苏"], "chain": "化工合成 → 饲料级蛋氨酸 → 畜禽饲料", "drivers": "关注全球产能、厂家报价、进口与饲料需求；暂无连续期货序列。"},
    {"id": "gasoline", "name": "汽油", "unit": "元/吨", "symbol": None, "aliases": ["汽油", "92#汽油", "95#汽油"], "stocks": ["泰山石油"], "chain": "原油 → 炼化 → 汽油零售", "drivers": "零售/批发地区与牌号差异较大；原油期货不作为汽油售价替代。"},
    {"id": "diesel", "name": "柴油", "unit": "元/吨", "symbol": None, "aliases": ["柴油", "0#柴油"], "stocks": ["泰山石油"], "chain": "原油 → 炼化 → 柴油批零", "drivers": "柴油牌号、地区和批零口径需区分；原油期货不作为柴油售价替代。"},
    {"id": "printing-paper", "name": "印刷用纸", "unit": "元/吨", "symbol": None, "aliases": ["印刷用纸", "文化纸", "双胶纸"], "stocks": ["岳阳林纸"], "chain": "商品浆 → 文化纸 → 印刷出版", "drivers": "纸种、克重与地区报价差异较大，暂无统一连续期货序列。"},
    {"id": "packaging-paper", "name": "包装用纸", "unit": "元/吨", "symbol": None, "aliases": ["包装用纸", "箱板纸", "瓦楞纸"], "stocks": ["岳阳林纸"], "chain": "废纸/木浆 → 包装纸 → 纸箱包装", "drivers": "纸种、克重及再生纤维比例不同，暂无统一连续期货序列。"},
    {"id": "titanium-products", "name": "钛产品", "unit": "元/吨", "symbol": None, "aliases": ["钛产品"], "stocks": ["钒钛股份"], "chain": "钛钒磁铁矿 → 钛精矿、钛渣等钛产品", "drivers": "需按钛精矿、钛渣等产品形态区分，不以钛白粉或钛材报价替代。"},
    {"id": "cathode-materials", "name": "锂电正极材料", "unit": "元/吨", "symbol": None, "aliases": ["正极材料"], "stocks": ["振华新材"], "chain": "锂盐、镍钴锰/磷铁原料 → 正极材料 → 锂电池", "drivers": "不同化学体系和型号价格差异大，未核实具体产品结构前不匹配碳酸锂或单一正极材料报价。"},
    {"id": "cast-superalloy", "name": "铸造高温合金", "unit": "元/吨", "symbol": None, "aliases": ["铸造合金制品"], "stocks": ["钢研高纳"], "chain": "镍、钴、铬等合金原料 → 铸造高温合金 → 航空发动机及燃气轮机", "drivers": "牌号、工艺和应用等级差异显著，暂无统一可比公开连续报价。"},
    {"id": "wrought-superalloy", "name": "变形高温合金", "unit": "元/吨", "symbol": None, "aliases": ["变形合金制品"], "stocks": ["钢研高纳"], "chain": "镍基/钴基合金 → 锻造、轧制高温合金 → 航空发动机及燃气轮机", "drivers": "合金牌号、规格和加工状态不同，暂无统一可比公开连续报价。"},
    {"id": "steel", "name": "钢材", "unit": "元/吨", "symbol": None, "aliases": ["钢材", "钢材销售"], "stocks": ["南钢股份"], "chain": "铁矿石、焦煤、焦炭 → 钢铁冶炼 → 板材、长材及特钢", "drivers": "钢材品种跨度大，未以单一螺纹钢或热卷期货代替公司综合钢材销售价格。"},
    {"id": "compound-fertilizer", "name": "复合肥", "unit": "元/吨", "symbol": None, "aliases": ["复合肥", "复合肥料"], "stocks": ["四川美丰"], "chain": "氮磷钾原料 → 复合肥 → 农业种植", "drivers": "配方、养分含量和区域差异较大，需按主流配方口径核实报价。"},
    {"id": "tungsten-products", "name": "钨产品", "unit": "元/吨", "symbol": None, "aliases": ["钨产品", "钨精矿", "仲钨酸铵", "APT"], "stocks": ["中钨高新"], "chain": "钨矿 → 钨精矿、APT、钨粉、硬质合金", "drivers": "钨产品跨多个加工环节，不同环节价格不可混用，暂无统一连续期货序列。"},
]

def call_with_timeout(seconds: int, function: Any, *args: Any, **kwargs: Any) -> Any:
    """Bound a single public-source request so a stalled provider cannot block refresh forever."""
    def alarm_handler(_signum: int, _frame: Any) -> None:
        raise TimeoutError(f"data source timed out after {seconds}s")
    previous = signal.signal(signal.SIGALRM, alarm_handler)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        return function(*args, **kwargs)
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)

def finite_number(value: Any) -> float | None:
    try:
        if isinstance(value, str):
            value = value.replace(",", "").strip()
        number = float(value)
        return number if math.isfinite(number) and number > 0 else None
    except (TypeError, ValueError):
        return None

def date_text(value: Any) -> str | None:
    if value is None:
        return None
    raw = str(value).strip()
    for fmt in ("%Y-%m-%d", "%Y%m%d", "%Y/%m/%d", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(raw[:19], fmt).date().isoformat()
        except ValueError:
            pass
    return None

def clean_series(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_date: dict[str, dict[str, Any]] = {}
    for row in rows:
        day = date_text(row.get("date"))
        spot = finite_number(row.get("spot"))
        futures = finite_number(row.get("futures"))
        if not day or (spot is None and futures is None):
            continue
        item: dict[str, Any] = {"date": day}
        if spot is not None:
            item["spot"] = round(spot, 4)
        if futures is not None:
            item["futures"] = round(futures, 4)
        by_date[day] = item
    return [by_date[k] for k in sorted(by_date)][-200:]

def normalize_company_list(value: Any, limit: int = 8) -> list[str]:
    """Split source-provided company names without inventing or inferring relationships."""
    if value is None:
        return []
    if isinstance(value, float) and math.isnan(value):
        return []
    text = str(value).strip()
    if not text or text.lower() == "nan" or text in {"-", "--", "暂无", "无"}:
        return []
    names = [name.strip() for name in re.split(r"[,，、;；|]", text) if name.strip()]
    return list(dict.fromkeys(names))[:limit]


def normalize_source_monthly_prices(row: Any) -> list[dict[str, Any]]:
    """Normalize monthly snapshots while retaining explicit dates when the source supplies them."""
    points: list[dict[str, Any]] = []
    for key, label in [
        ("近5月", "5个月前"),
        ("近4月", "4个月前"),
        ("近3月", "3个月前"),
        ("近2月", "2个月前"),
        ("近1月", "1个月前"),
        ("最新价", "最新"),
    ]:
        value = finite_number(row.get(key))
        if value is not None:
            points.append({"label": label, "value": round(value, 4)})
    # Some provider versions use the actual observation dates as column names.
    for key, raw_value in row.items():
        raw_key = str(key).strip()
        value = finite_number(raw_value)
        if value is None:
            continue
        day = date_text(raw_key)
        if day is None and re.fullmatch(r"\d{4}[-/]\d{1,2}", raw_key):
            try:
                day = date.fromisoformat(raw_key.replace("/", "-") + "-01").isoformat()
            except ValueError:
                day = None
        if day and not any(point.get("date") == day for point in points):
            points.append({"label": day[:7], "date": day, "value": round(value, 4)})
    dated = [point for point in points if point.get("date")]
    undated = [point for point in points if not point.get("date")]
    return sorted(dated, key=lambda point: point["date"]) + undated


def normalize_inventory_frame(frame: Any) -> list[dict[str, Any]]:
    """Normalize exchange warehouse receipt/inventory data; this is not total industry inventory."""
    if frame is None or getattr(frame, "empty", True):
        return []
    rows: list[dict[str, Any]] = []
    for _, row in frame.iterrows():
        day = date_text(row.get("日期", row.get("date")))
        raw_value = row.get("库存", row.get("库存量", row.get("inventory")))
        value = finite_number(raw_value)
        if not day or value is None:
            continue
        point: dict[str, Any] = {"date": day, "value": round(value, 4)}
        raw_change = row.get("增减", row.get("change"))
        try:
            change = float(str(raw_change).replace(",", "").strip())
            if math.isfinite(change):
                point["change"] = round(change, 4)
        except (TypeError, ValueError):
            pass
        rows.append(point)
    by_date = {point["date"]: point for point in rows}
    return [by_date[k] for k in sorted(by_date)][-90:]


def normalize_daily_frame(frame: Any) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = {}
    if frame is None or getattr(frame, "empty", True):
        return result
    for _, row in frame.iterrows():
        symbol = str(row.get("symbol", "")).strip().upper()
        if not symbol:
            continue
        day = date_text(row.get("date"))
        spot = finite_number(row.get("spot_price"))
        futures = finite_number(row.get("dom_price"))
        if futures is None:
            futures = finite_number(row.get("dominant_price"))
        if futures is None:
            futures = finite_number(row.get("near_price"))
        if not day or (spot is None and futures is None):
            continue
        result.setdefault(symbol, []).append({"date": day, "spot": spot, "futures": futures})
    return {key: clean_series(value) for key, value in result.items()}

def normalize_monthly_klines(frame: Any) -> list[dict[str, Any]]:
    """Aggregate continuous-futures daily OHLC into true monthly candlesticks."""
    if frame is None or getattr(frame, "empty", True):
        return []
    daily: list[dict[str, Any]] = []
    for _, row in frame.iterrows():
        day = date_text(row.get("日期", row.get("date")))
        if not day:
            continue
        values = {
            "open": finite_number(row.get("开盘价", row.get("open"))),
            "high": finite_number(row.get("最高价", row.get("high"))),
            "low": finite_number(row.get("最低价", row.get("low"))),
            "close": finite_number(row.get("收盘价", row.get("close"))),
        }
        if any(value is None for value in values.values()):
            continue
        daily.append({"date": day, **values})
    daily.sort(key=lambda point: point["date"])
    by_month: dict[str, list[dict[str, Any]]] = {}
    for point in daily:
        by_month.setdefault(point["date"][:7], []).append(point)
    result: list[dict[str, Any]] = []
    for month, points in sorted(by_month.items()):
        result.append({
            "date": month,
            "open": points[0]["open"],
            "high": max(point["high"] for point in points),
            "low": min(point["low"] for point in points),
            "close": points[-1]["close"],
        })
    return result[-180:]


def normalize_sys_frame(frame: Any, today: date | None = None) -> list[dict[str, Any]]:
    """Normalize Business Society's compact MM-DD chart dates into a chronological series."""
    if frame is None or getattr(frame, "empty", True):
        return []
    today = today or date.today()
    raw_points: list[dict[str, Any]] = []
    for _, row in frame.iterrows():
        raw_date = str(row.get("日期", row.get("date", ""))).strip()
        day = date_text(raw_date)
        spot = finite_number(row.get("现货价格", row.get("spot")))
        futures = finite_number(row.get("主力合约", row.get("futures")))
        if futures is None:
            futures = finite_number(row.get("最近合约"))
        raw_points.append({"raw_date": raw_date, "date": day, "spot": spot, "futures": futures})
    if all(p["date"] for p in raw_points):
        return clean_series([p for p in raw_points if p["date"]])
    year = today.year
    previous: tuple[int, int] | None = None
    for point in raw_points:
        if point["date"]:
            continue
        match = re.fullmatch(r"(\d{1,2})-(\d{1,2})", point["raw_date"])
        if not match:
            continue
        month, day_num = int(match.group(1)), int(match.group(2))
        month_day = (month, day_num)
        if previous and month_day < previous:
            year += 1
        try:
            point["date"] = date(year, month, day_num).isoformat()
        except ValueError:
            continue
        previous = month_day
    dated = [p for p in raw_points if p.get("date")]
    if dated and dated[-1]["date"] > today.isoformat():
        for point in dated:
            try:
                point["date"] = date.fromisoformat(point["date"]).replace(year=date.fromisoformat(point["date"]).year - 1).isoformat()
            except ValueError:
                pass
    return clean_series(dated)


def build_payload(daily_by_symbol: dict[str, list[dict[str, Any]]], now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    items: dict[str, Any] = {}
    for product in PRODUCTS:
        series = clean_series(daily_by_symbol.get(product["symbol"], [])) if product["symbol"] else []
        latest = series[-1] if series else {}
        latest_price = latest.get("spot") or latest.get("futures")
        items[product["id"]] = {
            "id": product["id"], "name": product["name"], "unit": product["unit"],
            "symbol": product["symbol"], "series": series,
            "latest": latest_price, "latestDate": latest.get("date"),
            "latestSpot": latest.get("spot"), "latestFutures": latest.get("futures"),
            "futuresSource": "生意社主力合约参考价（历史数据）" if latest.get("futures") else None,
            "futuresSourceUrl": "https://www.100ppi.com/" if latest.get("futures") else None,
            "changePct": None,
            "inventory": None,
            "source": "生意社现货/期货基差数据（经 AKShare 获取）" if series else None,
            "sourceUrl": "https://www.100ppi.com/",
            "stocks": product["stocks"], "chain": product["chain"], "drivers": product["drivers"],
            "status": "ok" if series else "pending",
        }
    return {
        "schemaVersion": 1,
        "updatedAt": now.isoformat(timespec="seconds"),
        "timezone": "UTC",
        "provider": "AKShare; underlying source labels are shown per item",
        "items": items,
    }

def fetch_data() -> dict[str, Any]:
    try:
        import akshare as ak
    except ImportError as exc:
        raise RuntimeError("AKShare is not installed. Install it with: pip install akshare") from exc

    end_day = date.today()
    errors: list[str] = []
    existing_payload: dict[str, Any] = {}
    try:
        existing_payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
        if not isinstance(existing_payload, dict):
            existing_payload = {}
    except (OSError, json.JSONDecodeError):
        existing_payload = {}

    # Keep the existing history and append only new observations on scheduled runs.
    # This avoids re-downloading 120 calendar days four times a day.
    daily_by_symbol: dict[str, list[dict[str, Any]]] = {}
    old_items = existing_payload.get("items", {}) if isinstance(existing_payload.get("items"), dict) else {}
    for product in PRODUCTS:
        code = product.get("symbol")
        old_item = old_items.get(product["id"], {})
        old_series = old_item.get("series", []) if isinstance(old_item, dict) else []
        if code and isinstance(old_series, list):
            daily_by_symbol[code] = clean_series(old_series)

    old_cost_inputs = existing_payload.get("costInputs", {})
    if isinstance(old_cost_inputs, dict):
        old_alumina = old_cost_inputs.get("alumina", {})
        if isinstance(old_alumina, dict) and isinstance(old_alumina.get("series"), list):
            daily_by_symbol["AO"] = clean_series(old_alumina["series"])

    core_codes = ["SA", "UR", "MA", "AL", "RU"]
    missing_history = [code for code in core_codes if len(daily_by_symbol.get(code, [])) < 200]
    fresh_data = False

    # Bootstrap history only when the cache is empty/incomplete. This source is
    # daily but makes one request per calendar day, so do not call it on every refresh.
    if missing_history:
        try:
            start_day = end_day - timedelta(days=LOOKBACK_DAYS)
            frame = call_with_timeout(150, ak.futures_spot_price_daily,
                start_day=start_day.strftime("%Y%m%d"),
                end_day=end_day.strftime("%Y%m%d"),
                vars_list=missing_history,
            )
            new_history = normalize_daily_frame(frame)
            for code, points in new_history.items():
                daily_by_symbol[code] = clean_series(daily_by_symbol.get(code, []) + points)
            if any(new_history.get(code) for code in missing_history):
                fresh_data = True
        except Exception as exc:
            errors.append("futures_spot_price_daily bootstrap: " + str(exc)[:180])

    # Refresh the latest spot/settlement snapshot from Business Society. If today is
    # not a trading day or one product is absent, try the previous few trading dates.
    observed: set[str] = set()
    mapping = {"纯碱": "SA", "尿素": "UR", "甲醇MA": "MA", "甲醇": "MA", "铝": "AL", "氧化铝": "AO", "天然橡胶": "RU"}
    for offset in range(0, 8):
        day = end_day - timedelta(days=offset)
        try:
            frame = call_with_timeout(12, ak.futures_spot_price_previous, day.strftime("%Y%m%d"))
            if frame is None or getattr(frame, "empty", True):
                continue
            for _, row in frame.iterrows():
                label = str(row.get("商品", row.get("symbol", ""))).strip()
                code = mapping.get(label)
                if not code:
                    continue
                spot = finite_number(row.get("现货价格", row.get("spot_price")))
                fut = finite_number(row.get("主力合约价格", row.get("dominant_price")))
                if spot is None and fut is None:
                    continue
                point = {"date": day.isoformat(), "spot": spot, "futures": fut}
                daily_by_symbol[code] = clean_series(daily_by_symbol.get(code, []) + [point])
                observed.add(code)
                fresh_data = True
            if len(observed) == len(core_codes):
                break
        except Exception as exc:
            errors.append("futures_spot_price_previous: " + str(exc)[:120])

    payload = build_payload(daily_by_symbol)

    # Long-range monthly candlesticks come from the provider's main-continuous
    # futures series, kept separate from the spot/basis series above.
    continuous_symbols = {
        "soda-ash": "SA0", "urea": "UR0", "methanol": "MA0", "float-glass": "FG0", "pulp": "SP0",
        "aluminium": "AL0", "rubber": "RU0", "corn": "C0", "soybean-meal": "M0", "gold": "AU0", "silver": "AG0", "copper": "CU0", "iron-ore": "I0", "tin": "SN0", "zinc": "ZN0", "sugar": "SR0", "pvc": "V0", "caustic-soda": "SH0", "alumina": "AO0",
    }
    old_items_for_monthly = existing_payload.get("items", {}) if isinstance(existing_payload.get("items"), dict) else {}
    for product_id, symbol in continuous_symbols.items():
        try:
            frame = call_with_timeout(
                35, ak.futures_main_sina,
                symbol=symbol,
                start_date="20100101",
                end_date=(end_day + timedelta(days=1)).strftime("%Y%m%d"),
            )
            monthly_klines = normalize_monthly_klines(frame)
            if monthly_klines:
                payload["items"][product_id]["monthlyKlines"] = {
                    "label": "主力连续合约月K线",
                    "series": monthly_klines,
                    "source": "新浪财经期货主力连续合约历史行情（经 AKShare 获取）",
                    "sourceUrl": "https://finance.sina.com.cn/futuremarket/",
                    "period": "monthly",
                    "priceType": "main-continuous-futures",
                }
                fresh_data = True
            else:
                prior = old_items_for_monthly.get(product_id, {})
                if isinstance(prior, dict) and isinstance(prior.get("monthlyKlines"), dict):
                    payload["items"][product_id]["monthlyKlines"] = prior["monthlyKlines"]
        except Exception as exc:
            errors.append("futures_main_sina/" + symbol + ": " + str(exc)[:120])
            prior = old_items_for_monthly.get(product_id, {})
            if isinstance(prior, dict) and isinstance(prior.get("monthlyKlines"), dict):
                payload["items"][product_id]["monthlyKlines"] = prior["monthlyKlines"]

    # Exchange warehouse receipts provide a useful, narrow supply-side signal.
    # They are NOT the same as total producer, port, or social inventory.
    inventory_symbols = {
        "soda-ash": "SA", "urea": "尿素", "methanol": "甲醇",
        "aluminium": "沪铝", "rubber": "橡胶",
    }
    for product_id, symbol in inventory_symbols.items():
        try:
            frame = call_with_timeout(15, ak.futures_inventory_em, symbol=symbol)
            series = normalize_inventory_frame(frame)
            if series:
                latest_point = series[-1]
                payload["items"][product_id]["inventory"] = {
                    "label": "期货仓单库存（非全行业库存）",
                    "series": series,
                    "latest": latest_point["value"],
                    "latestDate": latest_point["date"],
                    "change": latest_point.get("change"),
                    "source": "东方财富期货库存数据（经 AKShare 获取）",
                    "sourceUrl": "https://data.eastmoney.com/ifdata/kcsj.html",
                }
                fresh_data = True
        except Exception as exc:
            errors.append("futures_inventory_em/" + product_id + ": " + str(exc)[:100])
        # Keep last successful observations when the provider is unavailable.
        if payload["items"][product_id].get("inventory") is None:
            old_item = old_items.get(product_id, {})
            if isinstance(old_item, dict) and isinstance(old_item.get("inventory"), dict):
                payload["items"][product_id]["inventory"] = old_item["inventory"]

    payload["fetchErrors"] = errors[:5]

    # Add separate futures quotes where the source's product-name mapping supports them.
    for code, chinese_name in {"SA": "纯碱", "UR": "尿素", "C": "玉米", "M": "豆粕"}.items():
        try:
            frame = call_with_timeout(12, ak.futures_zh_realtime, symbol=chinese_name)
            if frame is None or getattr(frame, "empty", True):
                continue
            candidates = []
            for _, row in frame.iterrows():
                contract = str(row.get("symbol", "")).strip().upper()
                name = str(row.get("name", "")).strip()
                price = finite_number(row.get("trade"))
                if price is None:
                    continue
                rank = 0 if contract == code + "0" or "连续" in name else 1
                candidates.append((rank, row, price))
            if not candidates:
                continue
            candidates.sort(key=lambda x: x[0])
            _, row, price = candidates[0]
            target = next((x for x in payload["items"].values() if x.get("symbol") == code), None)
            if target:
                target["latestFutures"] = round(price, 4)
                target["futuresDate"] = date_text(row.get("tradedate")) or date.today().isoformat()
                target["futuresTime"] = str(row.get("ticktime", "")).strip() or None
                target["futuresSource"] = "新浪财经商品期货行情（经 AKShare 获取）"
                target["futuresSourceUrl"] = "https://finance.sina.com.cn/futuremarket/"
                fresh_data = True
        except Exception as exc:
            errors.append("futures_zh_realtime/" + code + ": " + str(exc)[:100])

    # Fetch current spot prices for non-futures commodities only where cache lacks a quote.
    # These products do not have a reliable futures spot series in this pipeline,
    # so refresh their latest quote from Eastmoney on every run.
    # Pull source-reported producer/downstream links for every tracked commodity.
    # The same endpoint can also provide latest spot quotes for products without a
    # reliable daily series, but it must not overwrite the core historical price series.
    industry_categories = {
        "soda-ash": ["化工", "建材"],
        "urea": ["化工", "农副"],
        "methanol": ["能源", "化工"],
        "tio2": ["化工", "建材"],
        "aluminium": ["有色"],
        "coal": ["能源", "钢铁"],
        "rubber": ["化工", "纺织"],
        "rare-earth": ["有色"],
        "maleic-anhydride": ["化工"],
        "corn": ["农副"],
        "soybean-meal": ["农副"],
        "live-hog": ["农副"],
        "gold": ["有色"], "silver": ["有色"], "copper": ["有色"], "iron-ore": ["钢铁"], "tin": ["有色"], "zinc": ["有色"], "sugar": ["农副"], "pvc": ["化工", "建材"], "caustic-soda": ["化工"], "alumina": ["有色"],
        "float-glass": ["建材"], "pulp": ["造纸"],
        "tdi": ["化工"], "polycarbonate": ["化工"], "phosphate-iron": ["化工"],
        "molybdenum": ["有色"], "tantalum-niobium": ["有色"], "titanium-material": ["有色"], "vanadium": ["钢铁", "有色"],
        "carbon-fiber": ["化工"], "viscose-staple-fiber": ["纺织"], "methionine": ["农副", "化工"],
        "gasoline": ["能源"], "diesel": ["能源"], "printing-paper": ["造纸"], "packaging-paper": ["造纸"],
        "titanium-products": ["有色"], "cathode-materials": ["化工"],
        "cast-superalloy": ["有色", "钢铁"], "wrought-superalloy": ["有色", "钢铁"],
        "steel": ["钢铁"], "compound-fertilizer": ["化工", "农副"], "tungsten-products": ["有色"],
    }
    latest_only_products = {"tio2", "coal", "rare-earth", "maleic-anhydride", "live-hog", "tdi", "polycarbonate", "phosphate-iron", "molybdenum", "tantalum-niobium", "titanium-material", "vanadium", "carbon-fiber", "viscose-staple-fiber", "methionine", "gasoline", "diesel", "printing-paper", "packaging-paper", "titanium-products", "cathode-materials", "cast-superalloy", "wrought-superalloy", "steel", "compound-fertilizer", "tungsten-products"}
    categories = list(dict.fromkeys(
        category for values in industry_categories.values() for category in values
    ))
    spot_rows: list[dict[str, Any]] = []
    for category in categories:
        try:
            frame = call_with_timeout(15, ak.futures_spot_stock, symbol=category)
            if frame is not None and not getattr(frame, "empty", True):
                spot_rows.extend(frame.to_dict(orient="records"))
        except Exception as exc:
            errors.append("futures_spot_stock/" + category + ": " + str(exc)[:100])

    for product in PRODUCTS:
        target = payload["items"][product["id"]]
        old_item = old_items.get(product["id"], {})
        for row in spot_rows:
            name = str(row.get("商品名称", row.get("商品", row.get("名称", "")))).strip()
            if not name or name not in product["aliases"]:
                continue

            producers = normalize_company_list(row.get("生产商"))
            downstream = normalize_company_list(row.get("下游用户"))
            target["industryLinks"] = {
                "label": "数据源列示产业链企业",
                "productName": name,
                "producers": producers,
                "downstreamUsers": downstream,
                "source": "东方财富现货与股票数据（经 AKShare 获取）",
                "sourceUrl": "https://data.eastmoney.com/ifdata/xhgp.html",
            }
            monthly_prices = normalize_source_monthly_prices(row)
            if monthly_prices:
                target["monthlyPrices"] = {
                    "label": "来源提供的近月价格快照",
                    "series": monthly_prices,
                    "source": "东方财富现货与股票数据（经 AKShare 获取）",
                    "sourceUrl": "https://data.eastmoney.com/ifdata/xhgp.html",
                }
                fresh_data = True
            elif isinstance(old_item, dict) and isinstance(old_item.get("monthlyPrices"), dict):
                target["monthlyPrices"] = old_item["monthlyPrices"]
            if product["id"] in latest_only_products:
                latest = finite_number(row.get("最新价", row.get("最新价格")))
                if latest is not None:
                    target["name"] = name
                    target["latest"] = round(latest, 4)
                    target["latestDate"] = date.today().isoformat()
                    target["latestSpot"] = round(latest, 4)
                    target["source"] = "东方财富现货与股票数据（经 AKShare 获取）"
                    target["sourceUrl"] = "https://data.eastmoney.com/ifdata/xhgp.html"
                    target["status"] = "latest-only"
                    try:
                        change = float(str(row.get("近半年涨跌幅", "")).replace("%", "").replace(",", "").strip())
                        if math.isfinite(change):
                            target["changePct"] = change
                    except (TypeError, ValueError):
                        pass
                    fresh_data = True
            break

        # Preserve previously sourced industry names when a category endpoint is down.
        if not target.get("industryLinks") and isinstance(old_item, dict) and isinstance(old_item.get("industryLinks"), dict):
            target["industryLinks"] = old_item["industryLinks"]

    # Preserve last good latest-only quotes when a provider is temporarily unavailable.
    for product in PRODUCTS:
        target = payload["items"][product["id"]]
        old_item = old_items.get(product["id"], {})
        if target.get("latest") is None and isinstance(old_item, dict) and old_item.get("latest") is not None:
            for key in ("name", "latest", "latestDate", "latestSpot", "latestFutures", "changePct", "source", "sourceUrl", "status"):
                if old_item.get(key) is not None:
                    target[key] = old_item[key]
            if not target.get("series") and isinstance(old_item.get("series"), list):
                target["series"] = old_item["series"]

    # Cost proxies are matched only against source rows that actually exist in
    # Eastmoney's public spot-and-stock table. Unsupported raw materials remain pending.
    cost_inputs = [
        {"id": "alumina", "name": "氧化铝", "unit": "元/吨", "aliases": ["氧化铝"],
         "relatedProducts": ["电解铝"], "role": "电解铝主要原料之一"},
        {"id": "synthetic-ammonia", "name": "合成氨", "unit": "元/吨", "aliases": ["合成氨", "液氨"],
         "relatedProducts": ["纯碱", "尿素"], "role": "化工原料参考价"},
        {"id": "sulfuric-acid", "name": "硫酸", "unit": "元/吨", "aliases": ["硫酸"],
         "relatedProducts": ["钛白粉"], "role": "硫酸法钛白粉成本参考"},
        {"id": "titanium-concentrate", "name": "钛精矿", "unit": "元/吨", "aliases": ["钛精矿", "钛矿"],
         "relatedProducts": ["钛白粉"], "role": "钛白粉主要原料参考"},
        {"id": "thermal-coal", "name": "动力煤", "unit": "元/吨", "aliases": ["动力煤"],
         "relatedProducts": ["尿素", "甲醇", "纯碱"], "role": "煤化工能源成本参考；煤种/地区口径需核对"},
    ]
    old_cost_inputs = existing_payload.get("costInputs", {})
    if not isinstance(old_cost_inputs, dict):
        old_cost_inputs = {}
    updated_cost_inputs: dict[str, Any] = {}
    for input_meta in cost_inputs:
        input_id = input_meta["id"]
        prior = old_cost_inputs.get(input_id, {})
        item: dict[str, Any] = {
            key: value for key, value in input_meta.items() if key != "aliases"
        }
        source_row = next((
            row for row in spot_rows
            if str(row.get("商品名称", row.get("商品", row.get("名称", "")))).strip()
            in input_meta["aliases"]
        ), None)
        if source_row is not None:
            monthly_prices = normalize_source_monthly_prices(source_row)
            latest_price = finite_number(source_row.get("最新价", source_row.get("最新价格")))
            if latest_price is not None:
                item.update({
                    "series": [],
                    "latest": latest_price,
                    "latestDate": end_day.isoformat(),
                    "source": "东方财富现货与股票数据（经 AKShare 获取）",
                    "sourceUrl": "https://data.eastmoney.com/ifdata/xhgp.html",
                    "status": "latest-only",
                })
                if monthly_prices:
                    item["monthlyPrices"] = monthly_prices
                    item["series"] = [
                        {"date": point["date"], "spot": point["value"]}
                        for point in monthly_prices if point.get("date")
                    ]
                fresh_data = True
            else:
                source_row = None
        if source_row is None:
            if isinstance(prior, dict) and prior.get("latest") is not None:
                item.update(prior)
            else:
                item.update({
                    "series": [], "latest": None, "latestDate": None,
                    "source": None, "sourceUrl": "https://data.eastmoney.com/ifdata/xhgp.html",
                    "status": "pending",
                })
        if input_id == "alumina":
            alumina_series = clean_series(daily_by_symbol.get("AO", []))
            if alumina_series:
                latest_point = alumina_series[-1]
                latest_price = latest_point.get("spot") or latest_point.get("futures")
                if latest_price is not None:
                    item.update({
                        "series": alumina_series[-120:],
                        "latest": latest_price,
                        "latestDate": latest_point["date"],
                        "source": "生意社现货/期货参考价格（经 AKShare 获取）",
                        "sourceUrl": "https://www.100ppi.com/",
                        "status": "ok",
                    })
                    fresh_data = True
        updated_cost_inputs[input_id] = item
    payload["costInputs"] = updated_cost_inputs

    payload["fetchErrors"] = errors[:5]
    payload["hasFreshData"] = fresh_data
    return payload

def main() -> int:
    payload = fetch_data()
    fresh = bool(payload.pop("hasFreshData", False))
    successful = sum(1 for item in payload["items"].values() if item.get("latest"))
    if not fresh or successful == 0:
        raise RuntimeError("No fresh valid commodity observations were fetched; preserving the last good file.")
    # Avoid a commit caused only by advancing the collection timestamp.
    try:
        previous_payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        previous_payload = {}
    comparable = dict(payload)
    comparable.pop("updatedAt", None)
    previous_comparable = dict(previous_payload) if isinstance(previous_payload, dict) else {}
    previous_comparable.pop("updatedAt", None)
    if previous_comparable and comparable == previous_comparable:
        print("No commodity data changes; preserving the previous snapshot.")
        return 0

    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT.name}: {successful}/{len(PRODUCTS)} products with data")
    for item in payload["items"].values():
        if item.get("latest"):
            print(f"- {item['name']}: {item['latest']} {item['unit']} ({item.get('latestDate')})")
    return 0

if __name__ == "__main__":
    sys.exit(main())
