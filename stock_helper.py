import json
import uuid
import time
import re
import requests
from datetime import datetime
from wcwidth import wcswidth
import os

class Stock:
    def __init__(self, id=None, name="", code="", entry_price=None,
                 target_price=None, group="", remark="", created_at=None, updated_at=None):
        self.id = id if id else str(uuid.uuid4())
        self.name = name
        self.code = code
        self.entry_price = entry_price
        self.target_price = target_price
        self.group = group
        self.remark = remark
        self.created_at = created_at if created_at else int(time.time() * 1000)
        self.updated_at = updated_at if updated_at else int(time.time() * 1000)

    def get_display_code(self):
        if self.code.startswith("sh") or self.code.startswith("sz"):
            return self.code[2:]
        return self.code

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "code": self.code,
            "entry_price": self.entry_price,
            "target_price": self.target_price,
            "group": self.group,
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
            entry_price=data.get("entry_price"),
            target_price=data.get("target_price"),
            group=data.get("group", ""),
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


class StockManager:
    _instance = None
    _max_backups = 5

    def __new__(cls, data_file="stocks.json"):
        if cls._instance is None:
            cls._instance = super(StockManager, cls).__new__(cls)
            cls._instance.data_file = data_file
        return cls._instance

    def _backup_data(self):
        import shutil
        backup_file = f"{self.data_file}.bak.{int(time.time())}"
        try:
            shutil.copy2(self.data_file, backup_file)
            self._cleanup_backups()
            return True
        except FileNotFoundError:
            return True
        except Exception as e:
            print(f"备份失败: {e}")
            return False

    def _cleanup_backups(self):
        import glob
        backup_files = sorted(glob.glob(f"{self.data_file}.bak.*"), reverse=True)
        for backup in backup_files[self._max_backups:]:
            try:
                import os
                os.remove(backup)
            except Exception as e:
                print(f"清理旧备份失败: {e}")

    def get_stocks(self):
        try:
            with open(self.data_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                return [Stock.from_dict(item) for item in data]
        except (FileNotFoundError, json.JSONDecodeError):
            return []

    def save_stocks(self, stocks):
        self._backup_data()
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


class StockApiService:
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
            print(f"API搜索失败: {e}")
            return []

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
    REMARK = "group"
    GROUP_PROFIT = "group_profit"

class SortOrder:
    ASC = "asc"
    DESC = "desc"

class StockHelperCLI:
    def __init__(self, readonly=False):
        self.stock_manager = StockManager()
        self.price_map = {}
        self.current_sort_type = SortType.PROFIT
        self.current_sort_order = SortOrder.ASC
        self.current_search_query = ""
        self.stocks_on_screen = []
        self.readonly = readonly

    def run(self):
        try:
            if self.readonly:
                self._run_readonly()
                return
            while True:
                self._clear_screen()
                self._print_header()
                self._refresh_prices(silent=True)
                stocks = self._get_filtered_and_sorted_stocks()
                self.stocks_on_screen = stocks
                self._display_stocks(stocks)
                print()
                self._print_menu()

                choice = input("\n  请输入: ").strip()
                if choice:
                    self._handle_choice(choice, stocks)
        except KeyboardInterrupt:
            print()
            pass

    def _run_readonly(self):
        while True:
            self._clear_screen()
            self._print_header()
            self._refresh_prices(silent=True)
            stocks = self._get_filtered_and_sorted_stocks()
            self.stocks_on_screen = stocks
            self._display_stocks(stocks)
            time.sleep(15)

    def _clear_screen(self):
        os.system("cls" if os.name == "nt" else "clear")

    def _print_header(self):
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print("=" * 100)
        print(f"    股票助手 Stock Helper        {now}")
        print("=" * 100)

    def _display_stocks(self, stocks):
        if not stocks:
            print("  暂无股票数据")
            return

        headers = ["股票名称", "当前价", "推荐买入价", "目标价", "盈亏%", "分组", "备注"]
        table_data = []

        for i, stock in enumerate(stocks, 1):
            price = self.price_map.get(stock.code)
            current_price = price.price if price else 0.0

            entry_price = stock.entry_price if stock.entry_price else 0.0
            profit = ((current_price - entry_price) / entry_price * 100) if entry_price > 0 else 0.0

            profit_color = "\033[91m" if profit >= 0 else "\033[92m"
            reset_color = "\033[0m"

            table_data.append([
                stock.name,
                f"{current_price:.2f}",
                f"{entry_price:.2f}",
                f"{(stock.target_price or 0):.2f}",
                f"{profit_color}{profit:.2f}%{reset_color}",
                stock.group or "-",
                (stock.remark[:10] + "...") if len(stock.remark) > 10 else (stock.remark or "-"),
            ])

        print(self._format_table(headers, table_data))

    @staticmethod
    def _strip_ansi(text):
        return re.sub(r'\033\[[0-9;]*m', '', text)

    @staticmethod
    def _display_width(text):
        visible = StockHelperCLI._strip_ansi(text)
        width = 0
        for char in visible:
            w = wcswidth(char)
            width += w if w > 0 else 1
        return width

    @staticmethod
    def _ljust_to_width(text, width):
        current = StockHelperCLI._display_width(text)
        return text + ' ' * max(0, width - current)

    @staticmethod
    def _rjust_to_width(text, width):
        current = StockHelperCLI._display_width(text)
        return ' ' * max(0, width - current) + text

    @staticmethod
    def _center_to_width(text, width):
        current = StockHelperCLI._display_width(text)
        diff = width - current
        if diff <= 0:
            return text
        left = diff // 2
        right = diff - left
        return ' ' * left + text + ' ' * right

    def _format_table(self, headers, rows):
        num_cols = len(headers)
        col_widths = []
        for j in range(num_cols):
            widths = [self._display_width(h) for h in headers]
            for row in rows:
                widths.append(self._display_width(row[j]))
            col_widths.append(max(widths))

        sep = '  '.join('-' * w for w in col_widths)

        header_cells = []
        for j in range(num_cols):
            header_cells.append(self._center_to_width(headers[j], col_widths[j]))
        header_line = '  '.join(header_cells)

        lines = [sep, header_line, sep]

        for row in rows:
            cells = []
            num_col = [1, 2, 3]  # right-aligned column indices
            for j in range(num_cols):
                if j in num_col:
                    cells.append(self._rjust_to_width(row[j], col_widths[j]))
                else:
                    cells.append(self._ljust_to_width(row[j], col_widths[j]))
            lines.append('  '.join(cells))

        return '\n'.join(lines)

    def _print_menu(self):
        sort_display = {
            SortType.PROFIT: "盈亏",
            SortType.GROUP_PROFIT: "分组+盈亏"
        }
        print("-" * 60)
        print("  [主菜单]")
        print("  1. 刷新价格    2. 排序方式    3. 查看详情")
        if not self.readonly:
            print("  4. 添加股票    5. 编辑股票    6. 删除股票")
        print("  0. 退出程序")
        print("-" * 60)
        print(f"  当前排序: {sort_display[self.current_sort_type]}")
        print("  请输入数字选择操作: ", end="", flush=True)

    def _handle_choice(self, choice, stocks):
        if choice == "1":
            self._refresh_prices_partial()
        elif choice == "2":
            self._toggle_sort()
        elif choice == "3":
            self._view_details(stocks)
        elif self.readonly:
            if choice == "4":
                print("  只读模式，无法添加股票")
            elif choice == "5":
                print("  只读模式，无法编辑股票")
            elif choice == "6":
                print("  只读模式，无法删除股票")
            else:
                print("  无效输入")
        else:
            if choice == "4":
                self._add_stock()
            elif choice == "5":
                self._edit_stock(stocks)
            elif choice == "6":
                self._delete_stock(stocks)
            elif choice == "0":
                print("\n  感谢使用股票助手，再见！")
                exit(0)
            else:
                print("  无效输入")
        time.sleep(0.5)

    def _toggle_sort(self):
        if self.current_sort_type == SortType.PROFIT:
            self.current_sort_type = SortType.GROUP_PROFIT
            print("  已切换为按分组+盈亏排序")
        else:
            self.current_sort_type = SortType.PROFIT
            print("  已切换为按盈亏排序")
        time.sleep(0.5)

    def _get_filtered_and_sorted_stocks(self):
        stocks = self.stock_manager.get_stocks()
        
        if self.current_search_query:
            query = self.current_search_query.lower()
            stocks = [s for s in stocks if query in s.name.lower() or query in s.code.lower()]
        
        return self._sort_stocks(stocks)

    def _sort_stocks(self, stocks):
        if self.current_sort_type == SortType.PROFIT:
            sorted_stocks = sorted(stocks, key=lambda s: self._calculate_profit(s))
        elif self.current_sort_type == SortType.GROUP_PROFIT:
            sorted_stocks = sorted(stocks, key=lambda s: (s.group or "", self._calculate_profit(s)))
        else:
            sorted_stocks = sorted(stocks, key=lambda s: self._calculate_profit(s))
        
        return sorted_stocks

    def _calculate_profit(self, stock):
        entry_price = stock.entry_price if stock.entry_price else 0.0
        current_price = self.price_map.get(stock.code, Price()).price
        if entry_price > 0 and current_price > 0:
            return ((current_price - entry_price) / entry_price) * 100
        return 0.0

    def _add_stock(self):
        print("\n  添加股票")
        print("  --------")
        
        keyword = self._input_text("  搜索股票名称或代码: ")
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
        
        choice_str = self._input_digit("\n  请选择股票序号: ")
        if not choice_str:
            return
        choice = int(choice_str)
        if 1 <= choice <= len(search_results):
            selected_stock = search_results[choice - 1]
        else:
            print("  无效选择")
            time.sleep(0.5)
            return
        
        if self.stock_manager.is_stock_exists(selected_stock.code):
            print("  该股票已存在")
            time.sleep(0.5)
            return
        
        entry_price = self._get_float_input("  推荐买入价: ", allow_empty=True)
        target_price = self._get_float_input("  目标价: ", allow_empty=True)
        group = self._input_text("  分组: ")
        remark = self._input_text("  备注: ")
        
        new_stock = Stock(
            name=selected_stock.name,
            code=selected_stock.code,
            entry_price=entry_price,
            target_price=target_price,
            group=group,
            remark=remark
        )
        
        self.stock_manager.add_stock(new_stock)
        
        stocks = self.stock_manager.get_stocks()
        self.price_map = PriceService.fetch_prices(stocks)
        sorted_stocks = self._sort_stocks(stocks)
        self.stock_manager.save_stocks(sorted_stocks)
        
        self._refresh_prices()
        print("  添加成功")
        time.sleep(0.5)

    def _edit_stock(self, stocks):
        if not stocks:
            print("  暂无股票可编辑")
            time.sleep(0.5)
            return
        
        print("\n  编辑股票")
        print("  --------")

        for i, stock in enumerate(stocks, 1):
            print(f"    {i}. {stock.name} ({stock.get_display_code()})")

        choice_str = self._input_digit("\n  请选择股票序号: ")
        if not choice_str:
            return
        choice = int(choice_str)
        if 1 <= choice <= len(stocks):
            stock = stocks[choice - 1]
        else:
            print("  无效选择")
            time.sleep(0.5)
            return
        
        print(f"\n  当前股票: {stock.name} ({stock.get_display_code()})")
        print(f"  当前买入价: {stock.entry_price or '-'}")
        print(f"  当前目标价: {stock.target_price or '-'}")
        print(f"  当前分组: {stock.group or '-'}")
        print(f"  当前备注: {stock.remark or '-'}")
        
        while True:
            print("\n  选择要编辑的字段:")
            print("    1. 推荐买入价")
            print("    2. 目标价")
            print("    3. 分组")
            print("    4. 备注")
            print("    0. 保存并返回")
            
            field_choice = self._input_digit("  请选择: ")

            if field_choice == "1":
                entry_price = self._get_float_input(f"  推荐买入价 ({stock.entry_price or 0}): ", allow_empty=True)
                if entry_price is not None:
                    stock.entry_price = entry_price
                    print("  买入价已更新")
            elif field_choice == "2":
                target_price = self._get_float_input(f"  目标价 ({stock.target_price or 0}): ", allow_empty=True)
                if target_price is not None:
                    stock.target_price = target_price
                    print("  目标价已更新")
            elif field_choice == "3":
                group = self._input_text(f"  分组: ", stock.group)
                stock.group = group
                print("  分组已更新")
            elif field_choice == "4":
                remark = self._input_text(f"  备注: ", stock.remark)
                stock.remark = remark
                print("  备注已更新")
            elif field_choice == "0":
                self.stock_manager.update_stock(stock)
                print("  修改成功")
                time.sleep(0.5)
                break
            else:
                print("  无效选择")
                time.sleep(0.5)

    def _delete_stock(self, stocks):
        if not stocks:
            print("  暂无股票可删除")
            time.sleep(0.5)
            return
        
        print("\n  删除股票")
        print("  --------")
        
        for i, stock in enumerate(stocks, 1):
            print(f"    {i}. {stock.name} ({stock.get_display_code()})")

        choice_str = self._input_digit("\n  请选择要删除的股票序号: ")
        if not choice_str:
            return
        choice = int(choice_str)
        if 1 <= choice <= len(stocks):
            stock = stocks[choice - 1]
        else:
            print("  无效选择")
            time.sleep(0.5)
            return
        
        confirm = self._input_char(f"  确定删除 {stock.name} 吗? (y/n): ")
        if confirm == "y":
            self.stock_manager.delete_stock(stock.id)
            print("  删除成功")
            time.sleep(0.5)
        else:
            print("  已取消")
            time.sleep(0.5)

    def _refresh_prices(self, silent=False):
        if not silent:
            print("  正在刷新价格...")
        stocks = self.stock_manager.get_stocks()
        self.price_map = PriceService.fetch_prices(stocks)
        if not silent:
            print("  刷新完成！")
            time.sleep(1)

    def _refresh_prices_partial(self):
        stocks = self.stock_manager.get_stocks()
        self.price_map = PriceService.fetch_prices(stocks)


    def _view_details(self, stocks):
        if not stocks:
            print("  暂无股票")
            time.sleep(0.5)
            return
        
        print("\n  查看详情")
        print("  --------")
        
        for i, stock in enumerate(stocks, 1):
            print(f"    {i}. {stock.name} ({stock.get_display_code()})")
        
        choice_str = self._input_digit("\n  请选择股票序号: ")
        if not choice_str:
            return
        choice = int(choice_str)
        if 1 <= choice <= len(stocks):
            stock = stocks[choice - 1]
        else:
            print("  无效选择")
            time.sleep(0.5)
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
        print(f"  推荐买入价: {stock.entry_price or '-'}")
        print(f"  目标价: {stock.target_price or '-'}")
        print(f"  分组: {stock.group or '-'}")
        print(f"  备注: {stock.remark or '-'}")
        print(f"  创建时间: {datetime.fromtimestamp(stock.created_at / 1000)}")
        print(f"  更新时间: {datetime.fromtimestamp(stock.updated_at / 1000)}")
        
        print("\n  按回车键返回...")
        input()

    def _input_text(self, prompt="", default=""):
        prompt_text = prompt
        if default:
            prompt_text = f"{prompt} (默认: {default}) "
        value = input(prompt_text).strip()
        if not value and default:
            return default
        return value

    def _input_digit(self, prompt=""):
        while True:
            c = input(prompt).strip()
            if c.isdigit():
                return c

    def _input_char(self, prompt=""):
        value = input(prompt).strip().lower()
        return value[:1] if value else ""

    def _get_float_input(self, prompt, allow_empty=False):
        while True:
            value = input(prompt).strip()
            if not value:
                if allow_empty:
                    return None
                continue
            try:
                return float(value)
            except ValueError:
                print("  请输入有效数字")

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="股票助手 - 股票跟踪工具")
    parser.add_argument("--readonly", action="store_true", help="只读模式，只显示不操作")
    args = parser.parse_args()

    cli = StockHelperCLI(readonly=args.readonly)
    cli.run()