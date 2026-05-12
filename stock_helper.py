import json
import uuid
import time
import requests
from datetime import datetime
from tabulate import tabulate

class Stock:
    def __init__(self, id=None, name="", code="", entry_price1=None, entry_price2=None,
                 target_price1=None, target_price2=None, remark="", created_at=None, updated_at=None):
        self.id = id if id else str(uuid.uuid4())
        self.name = name
        self.code = code
        self.entry_price1 = entry_price1
        self.entry_price2 = entry_price2
        self.target_price1 = target_price1
        self.target_price2 = target_price2
        self.remark = remark
        self.created_at = created_at if created_at else int(time.time() * 1000)
        self.updated_at = updated_at if updated_at else int(time.time() * 1000)

    def get_display_code(self):
        if self.code.startswith("sh") or self.code.startswith("sz"):
            return self.code[2:]
        return self.code

    def get_market_prefix(self):
        return "1" if self.code.startswith("sh") else "0"

    def get_tencent_code(self):
        if self.code.startswith("sh"):
            return "1" + self.code[2:]
        elif self.code.startswith("sz"):
            return "0" + self.code[2:]
        return self.code

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "code": self.code,
            "entry_price1": self.entry_price1,
            "entry_price2": self.entry_price2,
            "target_price1": self.target_price1,
            "target_price2": self.target_price2,
            "remark": self.remark,
            "created_at": self.created_at,
            "updated_at": self.updated_at
        }

    @classmethod
    def from_dict(cls, data):
        return cls(
            id=data.get("id"),
            name=data.get("name", ""),
            code=data.get("code", ""),
            entry_price1=data.get("entry_price1"),
            entry_price2=data.get("entry_price2"),
            target_price1=data.get("target_price1"),
            target_price2=data.get("target_price2"),
            remark=data.get("remark", ""),
            created_at=data.get("created_at"),
            updated_at=data.get("updated_at")
        )

class Price:
    def __init__(self, code="", price=0.0, change=0.0, change_percent=0.0, update_time=None):
        self.code = code
        self.price = price
        self.change = change
        self.change_percent = change_percent
        self.update_time = update_time if update_time else int(time.time() * 1000)

    def to_dict(self):
        return {
            "code": self.code,
            "price": self.price,
            "change": self.change,
            "change_percent": self.change_percent,
            "update_time": self.update_time
        }

class StockManager:
    _instance = None

    def __new__(cls, data_file="stocks.json"):
        if cls._instance is None:
            cls._instance = super(StockManager, cls).__new__(cls)
            cls._instance.data_file = data_file
        return cls._instance

    def get_stocks(self):
        try:
            with open(self.data_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                return [Stock.from_dict(item) for item in data]
        except (FileNotFoundError, json.JSONDecodeError):
            return []

    def save_stocks(self, stocks):
        try:
            with open(self.data_file, "w", encoding="utf-8") as f:
                json.dump([stock.to_dict() for stock in stocks], f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"保存失败: {e}")

    def add_stock(self, stock):
        stocks = self.get_stocks()
        stock.updated_at = int(time.time() * 1000)
        stocks.append(stock)
        self.save_stocks(stocks)

    def update_stock(self, updated_stock):
        stocks = self.get_stocks()
        for i, stock in enumerate(stocks):
            if stock.id == updated_stock.id:
                updated_stock.updated_at = int(time.time() * 1000)
                stocks[i] = updated_stock
                self.save_stocks(stocks)
                return True
        return False

    def delete_stock(self, stock_id):
        stocks = self.get_stocks()
        stocks = [s for s in stocks if s.id != stock_id]
        self.save_stocks(stocks)

    def is_stock_exists(self, code):
        return any(s.code.lower() == code.lower() for s in self.get_stocks())

class StockSearchService:
    stock_database = [
        Stock(name="贵州茅台", code="sh600519"),
        Stock(name="五粮液", code="sz000858"),
        Stock(name="宁德时代", code="sz300750"),
        Stock(name="比亚迪", code="sz002594"),
        Stock(name="招商银行", code="sh600036"),
        Stock(name="中国平安", code="sh601318"),
        Stock(name="贵州燃气", code="sh600903"),
        Stock(name="美的集团", code="sz000333"),
        Stock(name="格力电器", code="sz000651"),
        Stock(name="恒瑞医药", code="sh600276"),
        Stock(name="片仔癀", code="sh600436"),
        Stock(name="云南白药", code="sz000538"),
        Stock(name="海天味业", code="sh603288"),
        Stock(name="伊利股份", code="sh600887"),
        Stock(name="双汇发展", code="sz000895"),
        Stock(name="长江电力", code="sh600900"),
        Stock(name="上海机场", code="sh600009"),
        Stock(name="中国中免", code="sh601888"),
        Stock(name="顺丰控股", code="sz002352"),
        Stock(name="立讯精密", code="sz002475"),
        Stock(name="歌尔股份", code="sz002241"),
        Stock(name="京东方A", code="sz000725"),
        Stock(name="TCL科技", code="sz000100"),
        Stock(name="海尔智家", code="sh600690"),
        Stock(name="小米集团-W", code="hk1810"),
        Stock(name="腾讯控股", code="hk00700"),
        Stock(name="阿里巴巴-SW", code="hk09988"),
        Stock(name="美团-W", code="hk03690"),
        Stock(name="京东集团-SW", code="hk09618"),
        Stock(name="拼多多", code="usPDD"),
        Stock(name="阿里巴巴", code="usBABA"),
        Stock(name="腾讯音乐", code="usTME"),
        Stock(name="蔚来", code="usNIO"),
        Stock(name="理想汽车-W", code="hk02015"),
        Stock(name="小鹏汽车-W", code="hk09868"),
        Stock(name="工业富联", code="sh601138"),
        Stock(name="海康威视", code="sz002415"),
        Stock(name="大华股份", code="sz002236"),
        Stock(name="科大讯飞", code="sz002230"),
        Stock(name="汇顶科技", code="sh603160"),
        Stock(name="兆易创新", code="sh603986"),
        Stock(name="北方华创", code="sz002371"),
        Stock(name="中芯国际", code="sh688981"),
        Stock(name="韦尔股份", code="sh603501"),
        Stock(name="闻泰科技", code="sh600745"),
        Stock(name="三安光电", code="sh600703"),
        Stock(name="长电科技", code="sh600584"),
        Stock(name="通富微电", code="sz002156"),
        Stock(name="晶方科技", code="sh603005"),
        Stock(name="华天科技", code="sz002185"),
        Stock(name="紫光国微", code="sz002049"),
        Stock(name="圣邦股份", code="sz300661"),
        Stock(name="卓胜微", code="sz300782"),
        Stock(name="景旺电子", code="sh603228"),
        Stock(name="深南电路", code="sz002916"),
        Stock(name="沪电股份", code="sz002463"),
        Stock(name="生益科技", code="sh600183"),
        Stock(name="中航光电", code="sz002179"),
        Stock(name="航天电器", code="sz002025"),
        Stock(name="振华科技", code="sz000733"),
        Stock(name="鸿远电子", code="sh603267"),
        Stock(name="火炬电子", code="sh603678"),
        Stock(name="国瓷材料", code="sz300285"),
        Stock(name="三环集团", code="sz300408"),
        Stock(name="顺络电子", code="sz002138"),
        Stock(name="风华高科", code="sz000636"),
        Stock(name="横店东磁", code="sz002056"),
        Stock(name="中科三环", code="sz000970"),
        Stock(name="正海磁材", code="sz300224"),
        Stock(name="宁波韵升", code="sh600366"),
        Stock(name="广联达", code="sz002410"),
        Stock(name="用友网络", code="sh600588"),
        Stock(name="金山办公", code="sh688111"),
        Stock(name="宝信软件", code="sh600845"),
        Stock(name="恒生电子", code="sh600570"),
        Stock(name="东方财富", code="sz300059"),
        Stock(name="同花顺", code="sz300033"),
        Stock(name="中信证券", code="sh600030"),
        Stock(name="中信建投", code="sh601066"),
        Stock(name="华泰证券", code="sh601688"),
        Stock(name="国泰君安", code="sh601211"),
        Stock(name="海通证券", code="sh600837"),
        Stock(name="招商证券", code="sh600999"),
        Stock(name="光大证券", code="sh601788"),
        Stock(name="兴业证券", code="sh601377"),
        Stock(name="东吴证券", code="sh601555"),
        Stock(name="方正证券", code="sh601901"),
        Stock(name="中国建筑", code="sh601668"),
        Stock(name="中国中铁", code="sh601390"),
        Stock(name="中国铁建", code="sh601186"),
        Stock(name="中国交建", code="sh601800"),
        Stock(name="中国电建", code="sh601669"),
        Stock(name="中国能建", code="sh601868"),
        Stock(name="上海建工", code="sh600170"),
        Stock(name="北京城建", code="sh600266"),
        Stock(name="万科A", code="sz000002"),
        Stock(name="保利发展", code="sh600048"),
        Stock(name="绿地控股", code="sh600606"),
        Stock(name="华夏幸福", code="sh600340"),
        Stock(name="新城控股", code="sh601155"),
        Stock(name="阳光城", code="sz000671"),
        Stock(name="金科股份", code="sz000656"),
        Stock(name="中南建设", code="sz000961"),
        Stock(name="荣盛发展", code="sz002146"),
        Stock(name="蓝光发展", code="sh600466"),
        Stock(name="中国石油", code="sh601857"),
        Stock(name="中国石化", code="sh600028"),
        Stock(name="中海油服", code="sh601808"),
        Stock(name="杰瑞股份", code="sz002353"),
        Stock(name="油服工程", code="sh600583"),
        Stock(name="中国神华", code="sh601088"),
        Stock(name="兖州煤业", code="sh600188"),
        Stock(name="陕西煤业", code="sh601225"),
        Stock(name="中煤能源", code="sh601898"),
        Stock(name="山西焦煤", code="sz000983"),
        Stock(name="潞安环能", code="sh601699"),
        Stock(name="国电电力", code="sh600795"),
        Stock(name="华能国际", code="sh600011"),
        Stock(name="大唐发电", code="sh601991"),
        Stock(name="华电国际", code="sh600027"),
        Stock(name="粤电力A", code="sz000539"),
        Stock(name="申能股份", code="sh600642"),
        Stock(name="华能水电", code="sh600025"),
        Stock(name="桂冠电力", code="sh600236"),
        Stock(name="文山电力", code="sh600995"),
        Stock(name="三峡水利", code="sh600116"),
        Stock(name="川投能源", code="sh600674"),
        Stock(name="湖北能源", code="sz000883"),
        Stock(name="长江投资", code="sh600119"),
        Stock(name="国投电力", code="sh600886"),
        Stock(name="甘肃电投", code="sz000791"),
        Stock(name="内蒙华电", code="sh600863"),
        Stock(name="东方电气", code="sh600875"),
        Stock(name="上海电气", code="sh601727"),
        Stock(name="特变电工", code="sh600089"),
        Stock(name="中国西电", code="sh601179"),
        Stock(name="平高电气", code="sh600312"),
        Stock(name="许继电气", code="sz000400"),
        Stock(name="思源电气", code="sz002028"),
        Stock(name="金风科技", code="sz002202"),
        Stock(name="明阳智能", code="sh601615"),
        Stock(name="运达股份", code="sz300772"),
        Stock(name="天顺风能", code="sz002531"),
        Stock(name="中材科技", code="sz002080"),
        Stock(name="日月股份", code="sh603218"),
        Stock(name="泰胜风能", code="sz300129"),
        Stock(name="禾望电气", code="sh603063"),
        Stock(name="阳光电源", code="sz300274"),
        Stock(name="锦浪科技", code="sz300763"),
        Stock(name="固德威", code="sh688390"),
        Stock(name="德业股份", code="sh605117"),
        Stock(name="福斯特", code="sh603806"),
        Stock(name="东方雨虹", code="sz002271"),
        Stock(name="科顺股份", code="sz300737"),
        Stock(name="伟星新材", code="sz002372"),
        Stock(name="永高股份", code="sz002641"),
        Stock(name="海螺水泥", code="sh600585"),
        Stock(name="华新水泥", code="sh600801"),
        Stock(name="塔牌集团", code="sz002233"),
        Stock(name="冀东水泥", code="sz000401"),
        Stock(name="金隅集团", code="sh601992"),
        Stock(name="上峰水泥", code="sz000672"),
        Stock(name="万年青", code="sz000789"),
        Stock(name="祁连山", code="sh600720"),
        Stock(name="青松建化", code="sh600425"),
        Stock(name="天山股份", code="sz000877"),
        Stock(name="华特达因", code="sz000915"),
        Stock(name="莱茵生物", code="sz002166"),
        Stock(name="沃森生物", code="sz300142"),
        Stock(name="智飞生物", code="sz300122"),
        Stock(name="康泰生物", code="sz300601"),
        Stock(name="华兰生物", code="sz002007"),
        Stock(name="天坛生物", code="sh600161"),
        Stock(name="上海莱士", code="sz002252"),
        Stock(name="博雅生物", code="sz300294"),
        Stock(name="安科生物", code="sz300009"),
        Stock(name="长春高新", code="sz000661"),
        Stock(name="康缘药业", code="sh600557"),
        Stock(name="以岭药业", code="sz002603"),
        Stock(name="步长制药", code="sh603858"),
        Stock(name="同仁堂", code="sh600085"),
        Stock(name="广誉远", code="sh600771"),
        Stock(name="东阿阿胶", code="sz000423"),
        Stock(name="九芝堂", code="sz000989"),
        Stock(name="华润三九", code="sz000999"),
        Stock(name="葵花药业", code="sz002737"),
        Stock(name="江中制药", code="sh600750"),
        Stock(name="白云山", code="sh600332"),
        Stock(name="丽珠集团", code="sz000513"),
        Stock(name="健康元", code="sh600380"),
        Stock(name="华海药业", code="sh600521"),
        Stock(name="天宇股份", code="sz300702"),
        Stock(name="美诺华", code="sh603538"),
        Stock(name="浙江医药", code="sh600216"),
        Stock(name="新和成", code="sz002001"),
        Stock(name="亿帆医药", code="sz002019"),
        Stock(name="海普瑞", code="sz002399"),
        Stock(name="健友股份", code="sh603707"),
        Stock(name="普利制药", code="sz300630"),
        Stock(name="科伦药业", code="sz002422"),
        Stock(name="复星医药", code="sh600196"),
        Stock(name="药明康德", code="sh603259"),
        Stock(name="泰格医药", code="sz300347"),
        Stock(name="凯莱英", code="sz002821"),
        Stock(name="昭衍新药", code="sh603127"),
        Stock(name="康龙化成", code="sh300759"),
        Stock(name="药石科技", code="sz300725"),
        Stock(name="博腾股份", code="sz300363"),
        Stock(name="九洲药业", code="sh603456"),
        Stock(name="联化科技", code="sz002250"),
        Stock(name="美迪西", code="sh688202"),
        Stock(name="爱尔眼科", code="sz300015"),
        Stock(name="通策医疗", code="sh600763"),
        Stock(name="迈瑞医疗", code="sz300760"),
        Stock(name="万孚生物", code="sz300482"),
        Stock(name="安图生物", code="sh603658"),
        Stock(name="金域医学", code="sh603882"),
        Stock(name="迪安诊断", code="sz300244"),
        Stock(name="艾德生物", code="sz300685"),
        Stock(name="凯普生物", code="sz300639"),
        Stock(name="华大基因", code="sz300676"),
        Stock(name="贝瑞基因", code="sz000710"),
        Stock(name="达安基因", code="sz002030"),
        Stock(name="中国医药", code="sh600056"),
        Stock(name="国药一致", code="sz000028"),
        Stock(name="上海医药", code="sh601607"),
        Stock(name="华润医药", code="hk03320"),
        Stock(name="九州通", code="sh600998"),
        Stock(name="老百姓", code="sh603883"),
        Stock(name="大参林", code="sh603233"),
        Stock(name="益丰药房", code="sh603939"),
        Stock(name="一心堂", code="sz002727"),
        Stock(name="健之佳", code="sh605266"),
        Stock(name="漱玉平民", code="sz301017"),
        Stock(name="中通快递-W", code="hk02057"),
        Stock(name="圆通速递", code="sh600233"),
        Stock(name="申通快递", code="sz002468"),
        Stock(name="韵达股份", code="sz002120"),
        Stock(name="德邦股份", code="sh603056"),
        Stock(name="顺丰同城", code="hk09699"),
        Stock(name="唯品会", code="usVIPS"),
        Stock(name="网易", code="usNTES"),
        Stock(name="百度", code="usBIDU"),
        Stock(name="快手-W", code="hk01024"),
        Stock(name="哔哩哔哩", code="usBILI"),
        Stock(name="爱奇艺", code="usIQ"),
        Stock(name="芒果超媒", code="sz300413"),
        Stock(name="东方明珠", code="sh600637"),
        Stock(name="分众传媒", code="sz002027"),
        Stock(name="蓝色光标", code="sz300058"),
        Stock(name="华扬联众", code="sh603825"),
        Stock(name="利欧股份", code="sz002131"),
        Stock(name="三人行", code="sh605168"),
        Stock(name="省广集团", code="sz002400"),
        Stock(name="华媒控股", code="sz000607"),
        Stock(name="电广传媒", code="sz000917"),
        Stock(name="人民网", code="sh603000"),
        Stock(name="新华网", code="sh603888"),
        Stock(name="中新赛克", code="sz002912"),
        Stock(name="卫士通", code="sz002268"),
        Stock(name="启明星辰", code="sz002439"),
        Stock(name="深信服", code="sz300454"),
        Stock(name="奇安信-U", code="sh688561"),
        Stock(name="天融信", code="sz002212"),
        Stock(name="绿盟科技", code="sz300369"),
        Stock(name="山石网科", code="sh688030"),
        Stock(name="中孚信息", code="sz300659"),
        Stock(name="北信源", code="sz300352"),
        Stock(name="美亚柏科", code="sz300188"),
        Stock(name="拓尔思", code="sz300229"),
        Stock(name="东方国信", code="sz300166"),
        Stock(name="金蝶国际", code="hk00268"),
        Stock(name="指南针", code="sz300803"),
        Stock(name="财富趋势", code="sh688318"),
        Stock(name="顶点软件", code="sh603383"),
        Stock(name="金证股份", code="sh600446"),
        Stock(name="赢时胜", code="sz300377"),
        Stock(name="中科软", code="sh603927"),
        Stock(name="华宇软件", code="sz300271"),
        Stock(name="中国软件", code="sh600536"),
        Stock(name="浪潮软件", code="sh600756"),
        Stock(name="久其软件", code="sz002279"),
        Stock(name="远光软件", code="sz002063"),
        Stock(name="航天信息", code="sh600271"),
        Stock(name="同方股份", code="sh600100"),
        Stock(name="太极股份", code="sz002368"),
        Stock(name="中电兴发", code="sz002298"),
        Stock(name="数字政通", code="sz300075"),
        Stock(name="易华录", code="sz300212"),
        Stock(name="银江技术", code="sz300020"),
        Stock(name="千方科技", code="sz002373"),
        Stock(name="华测检测", code="sz300012"),
        Stock(name="广电计量", code="sz002967"),
        Stock(name="安车检测", code="sz300572"),
        Stock(name="南华仪器", code="sz300417"),
        Stock(name="中国电研", code="sh688128"),
        Stock(name="谱尼测试", code="sz300887"),
        Stock(name="国检集团", code="sh603060"),
        Stock(name="建科机械", code="sz300823"),
        Stock(name="华铁应急", code="sh603300"),
        Stock(name="浙江鼎力", code="sh603338"),
        Stock(name="杭叉集团", code="sh603298"),
        Stock(name="安徽合力", code="sh600761"),
        Stock(name="中联重科", code="sz000157"),
        Stock(name="三一重工", code="sh600031"),
        Stock(name="徐工机械", code="sz000425"),
        Stock(name="柳工机械", code="sz000528"),
        Stock(name="山推股份", code="sz000680"),
        Stock(name="厦工股份", code="sh600815"),
        Stock(name="山河智能", code="sz002097"),
        Stock(name="铁拓机械", code="sz300428"),
        Stock(name="中国中车", code="sh601766"),
        Stock(name="时代新材", code="sh600458"),
        Stock(name="晋西车轴", code="sh600495"),
        Stock(name="晋亿实业", code="sh601002"),
        Stock(name="天铁股份", code="sz300587"),
        Stock(name="祥和实业", code="sh603500"),
        Stock(name="中国通号", code="sh688009"),
        Stock(name="交控科技", code="sh688015"),
        Stock(name="佳都科技", code="sh600728"),
        Stock(name="世纪瑞尔", code="sz300150"),
        Stock(name="辉煌科技", code="sz002296"),
        Stock(name="高新兴", code="sz300098"),
        Stock(name="移远通信", code="sh603236"),
        Stock(name="广和通", code="sz300638"),
        Stock(name="日海智能", code="sz002313"),
        Stock(name="宜通世纪", code="sz300310"),
        Stock(name="中科创达", code="sz300496"),
        Stock(name="诚迈科技", code="sz300598"),
        Stock(name="润和软件", code="sz300339"),
        Stock(name="常山北明", code="sz000158"),
        Stock(name="东方通", code="sz300379"),
        Stock(name="科蓝软件", code="sz300663"),
        Stock(name="宇信科技", code="sz300674"),
        Stock(name="长亮科技", code="sz300348"),
        Stock(name="润欣科技", code="sz300493"),
        Stock(name="中颖电子", code="sz300327"),
        Stock(name="全志科技", code="sz300458"),
        Stock(name="瑞芯微", code="sh603893"),
        Stock(name="晶晨股份", code="sh688099"),
        Stock(name="国科微", code="sz300672"),
        Stock(name="景嘉微", code="sz300474"),
        Stock(name="航锦科技", code="sz000818"),
        Stock(name="上海贝岭", code="sh600171"),
        Stock(name="华微电子", code="sh600360"),
        Stock(name="士兰微", code="sh600460"),
        Stock(name="扬杰科技", code="sz300373"),
        Stock(name="华灿光电", code="sz300323"),
        Stock(name="乾照光电", code="sz300102"),
        Stock(name="阳光照明", code="sh600261"),
        Stock(name="欧普照明", code="sh603515"),
        Stock(name="佛山照明", code="sz000541"),
        Stock(name="雷曼光电", code="sz300162"),
        Stock(name="利亚德", code="sz300296"),
        Stock(name="洲明科技", code="sz300232"),
        Stock(name="艾比森", code="sz300389"),
        Stock(name="联建光电", code="sz300269"),
        Stock(name="聚飞光电", code="sz300303"),
        Stock(name="木林森", code="sz002745"),
        Stock(name="飞乐音响", code="sh600651"),
        Stock(name="长方集团", code="sz300301"),
        Stock(name="超频三", code="sz300647"),
        Stock(name="茂硕电源", code="sz002660"),
        Stock(name="英飞特", code="sz300582"),
        Stock(name="麦格米特", code="sz002851"),
        Stock(name="欧陆通", code="sz300870"),
        Stock(name="中能电气", code="sz300062"),
        Stock(name="通合科技", code="sz300491"),
        Stock(name="可立克", code="sz002782"),
        Stock(name="奥特迅", code="sz002227"),
        Stock(name="动力源", code="sh600405"),
        Stock(name="科士达", code="sz002518"),
        Stock(name="易事特", code="sz300376"),
        Stock(name="科华恒盛", code="sz002335")
    ]

    @classmethod
    def search_stocks(cls, keyword):
        if not keyword:
            return cls.stock_database
        
        lower_keyword = keyword.lower()
        results = [stock for stock in cls.stock_database if 
                   keyword in stock.name or 
                   lower_keyword in stock.name.lower() or
                   keyword in stock.code or
                   lower_keyword in stock.code.lower()]
        
        results.sort(key=lambda stock: cls._get_sort_key(stock, keyword))
        return results[:20]

    @classmethod
    def _get_sort_key(cls, stock, keyword):
        name_match = keyword.lower() in stock.name.lower()
        code_match = keyword.lower() in stock.code.lower()
        prefix_match = stock.name.lower().startswith(keyword.lower()) or stock.code.lower().startswith(keyword.lower())
        
        if prefix_match:
            return 0
        elif name_match:
            return 1
        elif code_match:
            return 2
        return 3

    @classmethod
    def get_stock_by_name(cls, name):
        return next((s for s in cls.stock_database if s.name == name), None)

    @classmethod
    def get_stock_by_code(cls, code):
        return next((s for s in cls.stock_database if s.code.lower() == code.lower()), None)

class StockApiService:
    BASE_URL = "https://push2.eastmoney.com"

    @classmethod
    def search_stocks(cls, keyword):
        if not keyword:
            return []
        
        url = f"http://suggest3.sinajs.cn/suggest/type=111&key={keyword}"
        
        try:
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            return cls._parse_sina_response(response.text)
        except Exception as e:
            print(f"API搜索失败，使用本地搜索: {e}")
            return StockSearchService.search_stocks(keyword)

    @classmethod
    def _parse_sina_response(cls, response):
        stocks = []
        try:
            start_idx = response.find('"')
            end_idx = response.rfind('"')
            if start_idx == -1 or end_idx == -1 or start_idx >= end_idx:
                return []
            
            data = response[start_idx + 1:end_idx]
            items = data.split(";")
            
            for item in items:
                parts = item.split(",")
                if len(parts) >= 6:
                    name = parts[0].strip()
                    code = parts[2].strip()
                    
                    if name.startswith(('sh', 'sz', 'hk')):
                        name = parts[4].strip()
                    
                    if name and code and not name.startswith(('sh', 'sz', 'hk')):
                        stocks.append(Stock(name=name, code=code))
        except Exception as e:
            print(f"解析失败: {e}")
            pass
        
        return stocks[:20]

    @classmethod
    def fetch_prices(cls, stocks):
        if not stocks:
            return {}
        
        codes = ",".join(stock.code for stock in stocks)
        url = f"https://hq.sinajs.cn/list={codes}"
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://finance.sina.com.cn/'
        }
        
        try:
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()
            return cls._parse_sina_price_response(response.text, stocks)
        except Exception as e:
            print(f"获取价格失败: {e}")
            return {}

    @classmethod
    def _parse_sina_price_response(cls, response, stocks):
        prices = {}
        try:
            lines = response.strip().split("\n")
            
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                
                start_idx = line.find('"')
                end_idx = line.rfind('"')
                if start_idx == -1 or end_idx == -1:
                    continue
                
                data = line[start_idx + 1:end_idx]
                parts = data.split(",")
                
                if len(parts) >= 4:
                    code = cls._extract_code_from_line(line)
                    price = float(parts[3])
                    prev_close = float(parts[2])
                    change = price - prev_close
                    change_percent = (change / prev_close) * 100 if prev_close != 0 else 0
                    
                    prices[code] = Price(
                        code=code,
                        price=price,
                        change=change,
                        change_percent=change_percent
                    )
        except Exception as e:
            print(f"解析价格失败: {e}")
            pass
        
        return prices

    @classmethod
    def _extract_code_from_line(cls, line):
        if 'hq_str_sh' in line or 'hq_str_sz' in line or 'hq_str_hk' in line:
            parts = line.split('_')
            if len(parts) >= 3:
                code_part = parts[2].split('"')[0]
                return code_part.replace('=', '')
        return ''

class PriceService:
    @staticmethod
    def fetch_prices(stocks):
        return StockApiService.fetch_prices(stocks)

class SortType:
    NAME = "name"
    PRICE = "price"
    CHANGE = "change"
    PROFIT = "profit"
    UPDATE_TIME = "update_time"

class SortOrder:
    ASC = "asc"
    DESC = "desc"

class StockHelperCLI:
    def __init__(self):
        self.stock_manager = StockManager()
        self.price_map = {}
        self.current_sort_type = SortType.NAME
        self.current_sort_order = SortOrder.ASC
        self.current_search_query = ""

    def run(self):
        while True:
            self._clear_screen()
            self._print_header()
            stocks = self._get_filtered_and_sorted_stocks()
            self._display_stocks(stocks)
            self._print_menu()
            choice = input("请输入操作编号: ").strip()
            self._handle_choice(choice, stocks)

    def _clear_screen(self):
        import os
        os.system("cls" if os.name == "nt" else "clear")

    def _print_header(self):
        print("=" * 100)
        print("                    股票助手 Stock Helper                    ")
        print("=" * 100)

    def _display_stocks(self, stocks):
        if not stocks:
            print("  暂无股票数据")
            return
        
        headers = ["序号", "股票名称", "代码", "当前价", "涨跌幅", "买入价1", "目标价1", "盈亏%"]
        table_data = []
        
        for i, stock in enumerate(stocks, 1):
            price = self.price_map.get(stock.code)
            current_price = price.price if price else 0.0
            change_percent = price.change_percent if price else 0.0
            
            entry_price = stock.entry_price1 if stock.entry_price1 else 0.0
            profit = ((current_price - entry_price) / entry_price * 100) if entry_price > 0 else 0.0
            
            change_color = "\033[92m" if change_percent >= 0 else "\033[91m"
            profit_color = "\033[92m" if profit >= 0 else "\033[91m"
            reset_color = "\033[0m"
            
            table_data.append([
                i,
                stock.name,
                stock.get_display_code(),
                f"{current_price:.2f}",
                f"{change_color}{change_percent:.2f}%{reset_color}",
                f"{entry_price:.2f}",
                f"{(stock.target_price1 or 0):.2f}",
                f"{profit_color}{profit:.2f}%{reset_color}"
            ])
        
        print(tabulate(table_data, headers=headers, tablefmt="grid", stralign="center", numalign="right"))

    def _print_menu(self):
        print("-" * 100)
        print("  操作菜单:")
        print("    1. 添加股票")
        print("    2. 编辑股票")
        print("    3. 删除股票")
        print("    4. 搜索股票")
        print("    5. 刷新价格")
        print("    6. 排序设置")
        print("    7. 查看详情")
        print("    0. 退出")
        print("-" * 100)

    def _handle_choice(self, choice, stocks):
        if choice == "0":
            print("  感谢使用股票助手，再见！")
            exit(0)
        elif choice == "1":
            self._add_stock()
        elif choice == "2":
            self._edit_stock(stocks)
        elif choice == "3":
            self._delete_stock(stocks)
        elif choice == "4":
            self._search_stocks()
        elif choice == "5":
            self._refresh_prices()
        elif choice == "6":
            self._sort_settings()
        elif choice == "7":
            self._view_details(stocks)
        else:
            input("  无效输入，请按回车继续...")

    def _get_filtered_and_sorted_stocks(self):
        stocks = self.stock_manager.get_stocks()
        
        if self.current_search_query:
            query = self.current_search_query.lower()
            stocks = [s for s in stocks if query in s.name.lower() or query in s.code.lower()]
        
        return self._sort_stocks(stocks)

    def _sort_stocks(self, stocks):
        if self.current_sort_type == SortType.NAME:
            sorted_stocks = sorted(stocks, key=lambda s: s.name)
        elif self.current_sort_type == SortType.PRICE:
            sorted_stocks = sorted(stocks, key=lambda s: self.price_map.get(s.code, Price()).price)
        elif self.current_sort_type == SortType.CHANGE:
            sorted_stocks = sorted(stocks, key=lambda s: self.price_map.get(s.code, Price()).change_percent)
        elif self.current_sort_type == SortType.PROFIT:
            sorted_stocks = sorted(stocks, key=lambda s: self._calculate_profit(s))
        elif self.current_sort_type == SortType.UPDATE_TIME:
            sorted_stocks = sorted(stocks, key=lambda s: s.updated_at)
        else:
            sorted_stocks = stocks
        
        return reversed(sorted_stocks) if self.current_sort_order == SortOrder.DESC else sorted_stocks

    def _calculate_profit(self, stock):
        entry_price = stock.entry_price1 if stock.entry_price1 else 0.0
        current_price = self.price_map.get(stock.code, Price()).price
        if entry_price > 0 and current_price > 0:
            return ((current_price - entry_price) / entry_price) * 100
        return 0.0

    def _add_stock(self):
        print("\n  添加股票")
        print("  --------")
        
        keyword = input("  搜索股票名称或代码: ").strip()
        if not keyword:
            input("  请输入搜索关键词，按回车返回...")
            return
        
        search_results = StockApiService.search_stocks(keyword)
        if not search_results:
            input("  未找到匹配的股票，按回车返回...")
            return
        
        print("\n  搜索结果:")
        for i, stock in enumerate(search_results, 1):
            print(f"    {i}. {stock.name} ({stock.get_display_code()})")
        
        try:
            choice = int(input("\n  请选择股票序号: ").strip())
            if 1 <= choice <= len(search_results):
                selected_stock = search_results[choice - 1]
            else:
                input("  无效选择，按回车返回...")
                return
        except ValueError:
            input("  请输入有效数字，按回车返回...")
            return
        
        if self.stock_manager.is_stock_exists(selected_stock.code):
            input("  该股票已存在，按回车返回...")
            return
        
        entry_price1 = self._get_float_input("  买入价1: ", allow_empty=True)
        entry_price2 = self._get_float_input("  买入价2: ", allow_empty=True)
        target_price1 = self._get_float_input("  目标价1: ", allow_empty=True)
        target_price2 = self._get_float_input("  目标价2: ", allow_empty=True)
        remark = input("  备注: ").strip()
        
        new_stock = Stock(
            name=selected_stock.name,
            code=selected_stock.code,
            entry_price1=entry_price1,
            entry_price2=entry_price2,
            target_price1=target_price1,
            target_price2=target_price2,
            remark=remark
        )
        
        self.stock_manager.add_stock(new_stock)
        self._refresh_prices()
        input("  添加成功，按回车返回...")

    def _edit_stock(self, stocks):
        if not stocks:
            input("  暂无股票可编辑，按回车返回...")
            return
        
        print("\n  编辑股票")
        print("  --------")
        
        for i, stock in enumerate(stocks, 1):
            print(f"    {i}. {stock.name} ({stock.get_display_code()})")
        
        try:
            choice = int(input("\n  请选择股票序号: ").strip())
            if 1 <= choice <= len(stocks):
                stock = stocks[choice - 1]
            else:
                input("  无效选择，按回车返回...")
                return
        except ValueError:
            input("  请输入有效数字，按回车返回...")
            return
        
        print(f"\n  当前股票: {stock.name} ({stock.get_display_code()})")
        entry_price1 = self._get_float_input(f"  买入价1 ({stock.entry_price1 or 0}): ", allow_empty=True)
        entry_price2 = self._get_float_input(f"  买入价2 ({stock.entry_price2 or 0}): ", allow_empty=True)
        target_price1 = self._get_float_input(f"  目标价1 ({stock.target_price1 or 0}): ", allow_empty=True)
        target_price2 = self._get_float_input(f"  目标价2 ({stock.target_price2 or 0}): ", allow_empty=True)
        remark = input(f"  备注 ({stock.remark}): ").strip()
        
        if entry_price1 is not None:
            stock.entry_price1 = entry_price1
        if entry_price2 is not None:
            stock.entry_price2 = entry_price2
        if target_price1 is not None:
            stock.target_price1 = target_price1
        if target_price2 is not None:
            stock.target_price2 = target_price2
        if remark:
            stock.remark = remark
        
        self.stock_manager.update_stock(stock)
        input("  修改成功，按回车返回...")

    def _delete_stock(self, stocks):
        if not stocks:
            input("  暂无股票可删除，按回车返回...")
            return
        
        print("\n  删除股票")
        print("  --------")
        
        for i, stock in enumerate(stocks, 1):
            print(f"    {i}. {stock.name} ({stock.get_display_code()})")
        
        try:
            choice = int(input("\n  请选择要删除的股票序号: ").strip())
            if 1 <= choice <= len(stocks):
                stock = stocks[choice - 1]
            else:
                input("  无效选择，按回车返回...")
                return
        except ValueError:
            input("  请输入有效数字，按回车返回...")
            return
        
        confirm = input(f"  确定删除 {stock.name} 吗? (y/n): ").strip().lower()
        if confirm == "y":
            self.stock_manager.delete_stock(stock.id)
            input("  删除成功，按回车返回...")
        else:
            input("  已取消，按回车返回...")

    def _search_stocks(self):
        print("\n  实时搜索股票")
        print("  ------------")
        
        while True:
            query = input("  请输入搜索关键词 (回车返回主菜单): ").strip()
            
            if not query:
                print("  返回主菜单...")
                time.sleep(0.5)
                return
            
            print(f"  正在搜索: {query}...")
            search_results = StockApiService.search_stocks(query)
            
            if not search_results:
                print("  未找到匹配的股票")
                continue
            
            print("\n  搜索结果:")
            print(f"  {'序号':<4} {'股票名称':<12} {'代码':<10}")
            print("  " + "-" * 30)
            for i, stock in enumerate(search_results, 1):
                print(f"  {i:<4} {stock.name:<12} {stock.get_display_code():<10}")
            
            add_choice = input("\n  是否添加股票? (输入序号添加，其他键继续搜索): ").strip()
            if add_choice.isdigit():
                idx = int(add_choice)
                if 1 <= idx <= len(search_results):
                    selected_stock = search_results[idx - 1]
                    if self.stock_manager.is_stock_exists(selected_stock.code):
                        print(f"  {selected_stock.name} 已存在")
                        time.sleep(1)
                        continue
                    
                    entry_price1 = self._get_float_input("  买入价1: ", allow_empty=True)
                    entry_price2 = self._get_float_input("  买入价2: ", allow_empty=True)
                    target_price1 = self._get_float_input("  目标价1: ", allow_empty=True)
                    target_price2 = self._get_float_input("  目标价2: ", allow_empty=True)
                    remark = input("  备注: ").strip()
                    
                    new_stock = Stock(
                        name=selected_stock.name,
                        code=selected_stock.code,
                        entry_price1=entry_price1,
                        entry_price2=entry_price2,
                        target_price1=target_price1,
                        target_price2=target_price2,
                        remark=remark
                    )
                    
                    self.stock_manager.add_stock(new_stock)
                    self._refresh_prices()
                    print(f"  已添加: {selected_stock.name}")
                    time.sleep(1)
                    break

    def _refresh_prices(self):
        print("  正在刷新价格...")
        stocks = self.stock_manager.get_stocks()
        self.price_map = PriceService.fetch_prices(stocks)
        print("  刷新完成！")
        time.sleep(1)

    def _sort_settings(self):
        sort_options = [
            ("股票名称", SortType.NAME),
            ("当前价格", SortType.PRICE),
            ("涨跌幅", SortType.CHANGE),
            ("盈亏比例", SortType.PROFIT),
            ("更新时间", SortType.UPDATE_TIME)
        ]
        
        print("\n  排序设置")
        print("  --------")
        for i, (name, _) in enumerate(sort_options, 1):
            print(f"    {i}. {name}")
        
        try:
            choice = int(input("\n  请选择排序方式: ").strip())
            if 1 <= choice <= len(sort_options):
                new_sort_type = sort_options[choice - 1][1]
                if new_sort_type == self.current_sort_type:
                    self.current_sort_order = SortOrder.DESC if self.current_sort_order == SortOrder.ASC else SortOrder.ASC
                else:
                    self.current_sort_type = new_sort_type
                    self.current_sort_order = SortOrder.ASC
                
                order_text = "降序" if self.current_sort_order == SortOrder.DESC else "升序"
                print(f"  已设置: {sort_options[choice - 1][0]} {order_text}")
            else:
                print("  无效选择")
        except ValueError:
            print("  请输入有效数字")
        
        time.sleep(1)

    def _view_details(self, stocks):
        if not stocks:
            input("  暂无股票，按回车返回...")
            return
        
        print("\n  查看详情")
        print("  --------")
        
        for i, stock in enumerate(stocks, 1):
            print(f"    {i}. {stock.name} ({stock.get_display_code()})")
        
        try:
            choice = int(input("\n  请选择股票序号: ").strip())
            if 1 <= choice <= len(stocks):
                stock = stocks[choice - 1]
            else:
                input("  无效选择，按回车返回...")
                return
        except ValueError:
            input("  请输入有效数字，按回车返回...")
            return
        
        price = self.price_map.get(stock.code)
        current_price = price.price if price else 0.0
        change = price.change if price else 0.0
        change_percent = price.change_percent if price else 0.0
        
        print(f"\n  股票详情")
        print(f"  --------")
        print(f"  名称: {stock.name}")
        print(f"  代码: {stock.code} ({stock.get_display_code()})")
        print(f"  当前价: {current_price:.2f}")
        print(f"  涨跌额: {change:.2f}")
        print(f"  涨跌幅: {change_percent:.2f}%")
        print(f"  买入价1: {stock.entry_price1 or '-'}")
        print(f"  买入价2: {stock.entry_price2 or '-'}")
        print(f"  目标价1: {stock.target_price1 or '-'}")
        print(f"  目标价2: {stock.target_price2 or '-'}")
        print(f"  备注: {stock.remark or '-'}")
        print(f"  创建时间: {datetime.fromtimestamp(stock.created_at / 1000)}")
        print(f"  更新时间: {datetime.fromtimestamp(stock.updated_at / 1000)}")
        
        input("\n  按回车返回...")

    def _get_float_input(self, prompt, allow_empty=False):
        while True:
            value = input(prompt).strip()
            if allow_empty and not value:
                return None
            try:
                return float(value)
            except ValueError:
                print("  请输入有效数字")

if __name__ == "__main__":
    cli = StockHelperCLI()
    cli.run()