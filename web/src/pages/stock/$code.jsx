import React from 'react';
import {Alert, Button, Card, Descriptions, Empty, InputNumber, Segmented, Space, Table, Tag, Tooltip, Typography} from 'antd';
import {ExportOutlined, ReloadOutlined, SearchOutlined} from '@ant-design/icons';
import {HttpClient, Page, history} from '@jiangood/open-admin';
import Echart from '../../components/Echart';
import {fmt, fmtAmount, fmtCap, fmtPct, isNum, num, pctText, scoreTone, tone} from '../../lib/format';

const {Text, Title} = Typography;

const levelColor = {
    heavy: '#389e0d',
    entry: '#1677ff',
    tp1: '#f59e0b',
    tp2: '#8b5cf6',
};

function klineOption(bars, period) {
    const dates = bars.map(b => b.time);
    const candle = bars.map(b => [b.open, b.close, b.low, b.high]);
    const volumes = bars.map(b => ({
        value: b.volume || 0,
        itemStyle: {color: b.close >= b.open ? 'rgba(207,19,34,0.45)' : 'rgba(56,158,13,0.45)'},
    }));
    return {
        animation: false,
        grid: [
            {left: 46, right: 56, top: 16, height: '60%'},
            {left: 46, right: 56, top: '76%', bottom: 28},
        ],
        axisPointer: {link: [{xAxisIndex: 'all'}], label: {fontSize: 10}},
        tooltip: {
            trigger: 'axis',
            axisPointer: {type: 'cross'},
            formatter: params => {
                const hit = (params || []).find(p => p.seriesType === 'candlestick');
                if (!hit) return '';
                const bar = bars[hit.dataIndex];
                return `<b>${bar.time}</b><br/>开 ${fmt(bar.open)} · 高 ${fmt(bar.high)}<br/>`
                    + `低 ${fmt(bar.low)} · 收 <b>${fmt(bar.close)}</b><br/>量 ${fmtAmount(bar.volume)}`;
            },
        },
        xAxis: [
            {
                type: 'category', data: dates, boundaryGap: true,
                axisTick: {show: false}, splitLine: {show: false},
                axisLabel: {fontSize: 10, hideOverlap: true, formatter: v => period === 'month' ? String(v).slice(0, 7) : String(v).slice(5)},
            },
            {type: 'category', gridIndex: 1, data: dates, boundaryGap: true, axisLabel: {show: false}, axisTick: {show: false}},
        ],
        yAxis: [
            {scale: true, position: 'right', axisLabel: {fontSize: 10, formatter: v => Number(v).toFixed(2)}, splitLine: {opacity: 0.4}},
            {gridIndex: 1, scale: true, splitNumber: 2, axisLabel: {show: false}, splitLine: {show: false}},
        ],
        dataZoom: [{type: 'inside', xAxisIndex: [0, 1], minValueSpan: 20, zoomOnMouseWheel: 'ctrl'}],
        series: [
            {
                type: 'candlestick', name: 'K线', data: candle,
                itemStyle: {
                    color: '#cf1322', color0: '#389e0d',
                    borderColor: '#cf1322', borderColor0: '#389e0d',
                },
            },
            {type: 'bar', name: '成交量', xAxisIndex: 1, yAxisIndex: 1, data: volumes},
        ],
    };
}

function CheckRows({checks}) {
    if (!checks || !checks.length) return <Text type="secondary">暂无检查项</Text>;
    return <div>
        {checks.map((item, index) => <div className="sh-check-row" key={index}>
            <span className={`sh-check-tone ${item.tone}`}>{item.tone === 'ok' ? '✓' : item.tone === 'bad' ? '×' : item.tone === 'warn' ? '!' : '·'}</span>
            <div style={{flex: 1}}>
                <span className="sh-check-value">{item.label}</span>
                {item.value ? <span> · {item.value}</span> : null}
                {item.note ? <div className="sh-check-note">{item.note}</div> : null}
            </div>
        </div>)}
    </div>;
}

function StatGrid({items}) {
    return <div className="sh-stat-grid">
        {items.map(([label, value, className]) => <div className="sh-stat" key={label}>
            <div className="sh-stat-label">{label}</div>
            <div className={`sh-stat-value ${className || ''}`}>{value}</div>
        </div>)}
    </div>;
}

function Ruler({plan, price}) {
    const levels = (plan?.levels || []).filter(level => isNum(level.value) && level.value > 0);
    if (!levels.length || !isNum(price)) return <Empty description="未配置计划价"/>;
    const values = levels.map(level => level.value).concat(price);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const span = hi - lo || hi * 0.02 || 1;
    const pos = value => (value - lo) / span * 100;
    return <div className="sh-section">
        <div className="sh-ruler">
            {levels.map(level => <span key={level.key} className="sh-ruler-tick"
                    style={{left: `${pos(level.value)}%`, background: levelColor[level.key] || '#999'}}/>)}
            <span className="sh-ruler-current" style={{left: `${pos(price)}%`}}/>
            {levels.map(level => <span key={`label-${level.key}`} className="sh-ruler-label"
                    style={{left: `${pos(level.value)}%`}}>{level.label} {fmt(level.value)}</span>)}
            <span className="sh-ruler-label" style={{left: `${pos(price)}%`, top: 36}}>现价 {fmt(price)}</span>
        </div>
    </div>;
}

function ScorePanel({score}) {
    if (!score || score.kind === 'none') {
        return <Empty description={score?.message || '暂无评分'}/>;
    }
    const primary = score.primary || {};
    const report = score.report;
    const machine = score.machine;
    const items = machine?.items || {};
    const metrics = machine?.metrics || {};
    const labels = [
        ['owner', '国资背景', 10, metrics.owner || metrics.ownerType],
        ['focus', '主营集中', 9, metrics.mainItem ? `最大品类 ${(100 * (metrics.mainRatio || 0)).toFixed(0)}%（${metrics.mainItem}）` : '主营构成未取到'],
        ['profit', '扣非净利增长', 14, isNum(metrics.profitYoy) ? `最近年报扣非同比 ${fmt(metrics.profitYoy, 1)}%` : '扣非数据未取到'],
        ['cap', '总市值', 8, isNum(metrics.capYi) ? `${Math.round(metrics.capYi)} 亿` : '市值缺失'],
        ['consolidation', '盘整 2-3 年', 9, isNum(metrics.boxHeight) ? `近 36 月箱体 ${(metrics.boxHeight * 100).toFixed(0)}% · 高点距今 ${metrics.months ?? '—'} 个月` : '月K不足'],
        ['bottom', '月线底部', 9, isNum(metrics.pAll) ? `全历史分位 ${fmt(metrics.pAll, 0)}% · 52 周位置 ${fmt(metrics.p52, 0)}%` : '月K不足'],
        ['volume', '底部放量', 6, isNum(metrics.volRatio) ? `近 6 月 / 前 36 月 量比 ${fmt(metrics.volRatio, 2)}` : '成交量不足'],
    ];
    return <>
        <Space align="baseline" size={12} wrap>
            <Title level={3} style={{margin: 0, color: 'inherit'}}>
                <span className={scoreTone(primary.bandLabel === '位置优秀' ? 'good' : primary.bandLabel === '位置偏高' ? 'high' : 'mid')}>
                    {fmt(primary.score, 1)} 分
                </span>
            </Title>
            <span>{primary.bandLabel}</span>
            {report ? <Tag color={report.stale ? 'orange' : 'blue'}>研报原始分</Tag> : <Tag>机器复算</Tag>}
        </Space>
        <div className="sh-mini sh-section">{score.message || (report
            ? `来源：${report.source} · 报告日期 ${report.date}${report.stale ? '（可能已过时）' : ''}`
            : '')}</div>
        {machine?.percent !== null && machine?.percent !== undefined ? <div className="sh-section">
            <div className="sh-mini">机器分 {fmt(machine.percent, 1)} / 100（{machine.points}/{machine.max}）· {machine.bandLabel} · 覆盖 65/100 权重</div>
        </div> : null}
        <Table size="small" pagination={false} rowKey="key" className="sh-section"
               dataSource={labels.map(([key, label, max, note]) => ({key, label, max, note, value: items[key]}))}
               columns={[
                   {title: '指标', dataIndex: 'label', width: 130},
                   {
                       title: '得分', dataIndex: 'value', width: 90, align: 'right',
                       render: (v, row) => <span className={isNum(v) ? (v / row.max >= 0.75 ? 'sh-good' : v / row.max >= 0.45 ? 'sh-mid' : 'sh-bad') : ''}>{fmt(v, 1)} / {row.max}</span>,
                   },
                   {title: '说明', dataIndex: 'note', render: v => <span className="sh-mini">{v}</span>},
               ]}/>
        <div className="sh-mini sh-section">评分只用于筛选与记录，不构成投资建议；未覆盖「独一无二 / 产品持续涨价 / 盈利模式」35 分权重。</div>
    </>;
}

export default class StockDetailPage extends React.Component {
    state = {
        loading: false, error: '', data: null,
        period: 'day', chartLoading: false, bars: [],
        codeInput: '',
        calc: {p: '', c: '', q: '', discount: 0.65, multiple: 20},
    };

    componentDidMount() {
        this.load();
        this.loadChart();
    }

    componentDidUpdate(prevProps) {
        if (prevProps.params?.code !== this.props.params?.code) {
            this.load();
            this.loadChart();
        }
    }

    onShow() {
        this.load();
    }

    get code() {
        return this.props.params?.code;
    }

    load = async () => {
        this.setState({loading: true, error: ''});
        try {
            const rs = await HttpClient.get('admin/stock-detail/info', {code: this.code});
            this.setState({data: rs.data || null, loading: false});
            this.loadCalc();
        } catch (e) {
            this.setState({loading: false, error: e.message || '读取失败', data: null});
        }
    };

    loadChart = async (period = this.state.period) => {
        this.setState({chartLoading: true});
        try {
            const rs = await HttpClient.get('admin/stock-detail/kline', {
                code: this.code,
                period,
                adjust: period === 'month' ? 'qfq' : 'qfq',
                count: period === 'month' ? 120 : 250,
            });
            this.setState({bars: rs.data?.bars || [], chartLoading: false});
        } catch (e) {
            this.setState({chartLoading: false});
        }
    };

    loadCalc() {
        try {
            const saved = JSON.parse(localStorage.getItem(`croc-valuation:${this.code}`) || '{}');
            this.setState({calc: {...this.state.calc, ...saved}});
        } catch (e) {
            // 忽略本机设置读取失败
        }
    }

    updateCalc = (key, value) => {
        const calc = {...this.state.calc, [key]: value};
        this.setState({calc});
        try {
            localStorage.setItem(`croc-valuation:${this.code}`, JSON.stringify(calc));
        } catch (e) {
            // 忽略本机设置写入失败
        }
    };

    calcResult() {
        const {calc} = this.state;
        const detail = this.state.data?.quote || {};
        const p = Number(calc.p);
        const c = Number(calc.c);
        const q = Number(calc.q);
        const discount = Number(calc.discount) || 0.65;
        const multiple = Number(calc.multiple) || 20;
        if (!calc.p || !calc.c || !calc.q || !isFinite(p) || !isFinite(c) || !isFinite(q) || p <= 0 || c < 0 || q <= 0) {
            return '填写 P / C / Q 后自动计算。';
        }
        const gross = (p - c) * q * 1e4;
        const net = gross * discount;
        const fair = net * multiple;
        const wild = net * 40;
        const cap = num(detail.totalCap);
        const shares = isNum(detail.totalShares) && detail.totalShares > 0
            ? detail.totalShares
            : (cap !== null && isNum(detail.price) && detail.price > 0 ? cap / detail.price : null);
        const implied = shares ? fair / shares : null;
        const space = cap !== null && cap > 0 ? (fair / cap - 1) * 100 : null;
        return `年化毛利 ${fmtAmount(gross)} · 保守净利 ${fmtAmount(net)} · 合理市值 ${fmtAmount(fair)}（${multiple}×）`
            + ` · 当前 ${fmtAmount(cap)} · 空间 ${fmtPct(space)} · 对应股价 ${fmt(implied)}`
            + ` · 狂热上限（40×）${fmtAmount(wild)}`
            + (gross <= 0 ? ' · 当前价格不高于成本，毛利为负：先确认 P / C 是否填反。' : '');
    }

    renderHeader(data) {
        const stock = data.stock || {};
        const quote = data.quote || {};
        const eastmoneyUrl = `https://quote.eastmoney.com/${stock.code}.html`;
        return <div className="sh-toolbar" style={{justifyContent: 'space-between'}}>
            <div className="sh-quote-head">
                <span className="sh-quote-price">{fmt(quote.price)}</span>
                <span className={`sh-quote-change ${tone(quote.todayChange)}`}>{fmtPct(quote.todayChange)}</span>
                <span className={`${tone(quote.change)} sh-mini`}>{quote.change === null ? '' : `${quote.change > 0 ? '+' : ''}${fmt(quote.change)}`}</span>
                <span className="sh-mini">{quote.quoteTime ? new Date(quote.quoteTime).toLocaleString('zh-CN', {hour12: false}) : '行情时间未提供'}</span>
            </div>
            <Space>
                <InputNumber addonBefore={<SearchOutlined/>} placeholder="6 位代码" style={{width: 170}}
                             value={this.state.codeInput} onChange={codeInput => this.setState({codeInput})}
                             onPressEnter={() => {
                                 const value = String(this.state.codeInput || '').trim();
                                 if (/^\d{6}$/.test(value) || /^(sh|sz)\d{6}$/i.test(value)) {
                                     history.push(`/stock/${value.toLowerCase()}`);
                                 }
                             }}/>
                <Button icon={<ReloadOutlined/>} onClick={this.load}>刷新</Button>
                <Button icon={<ExportOutlined/>} href={eastmoneyUrl} target="_blank">东方财富</Button>
            </Space>
        </div>;
    }

    render() {
        const {data, error, loading} = this.state;
        if (error) {
            return <Page title="个股详情" actions={[{label: '刷新', icon: <ReloadOutlined/>, onClick: this.load}]}>
                <Alert type="error" showIcon message={error}/>
            </Page>;
        }
        if (!data) {
            return <Page title="个股详情"><Empty description={loading ? '正在读取行情…' : '暂无数据'}/></Page>;
        }
        const stock = data.stock || {};
        const quote = data.quote || {};
        const plan = data.plan || {};
        const historyData = data.history || {};
        const peer = data.peer || {};
        const add = data.add || {};
        const discipline = data.discipline || {};
        const score = data.score || {};
        const title = <Space><span>{stock.name}</span><Tag>{stock.code}</Tag>{stock.group ? <Tag>{stock.group}</Tag> : null}
            {stock.alias ? <Tag>{stock.alias}</Tag> : null}</Space>;

        const valuationItems = [
            ['市盈率(动)', quote.pe === null ? '—' : fmt(quote.pe)],
            ['市盈率(TTM)', quote.peTtm === null ? '—' : quote.peTtm < 0 ? '亏损' : fmt(quote.peTtm)],
            ['市盈率(静)', quote.peStatic === null ? '—' : fmt(quote.peStatic)],
            ['市净率', fmt(quote.pb)],
            ['每股净资产', fmt(quote.navPerShare)],
            ['ROE', quote.roe === null ? '—' : `${fmt(quote.roe)}%`],
            ['毛利率', quote.grossMargin === null ? '—' : `${fmt(quote.grossMargin)}%`],
            ['净利率', quote.netMargin === null ? '—' : `${fmt(quote.netMargin)}%`],
            ['营收同比', <span className={tone(quote.revenueYoY)}>{fmtPct(quote.revenueYoY)}</span>],
            ['净利同比', <span className={tone(quote.profitYoY)}>{fmtPct(quote.profitYoY)}</span>],
            ['营业收入', fmtAmount(quote.revenue)],
            ['净利润', fmtAmount(quote.profit)],
            ['总市值', fmtCap(quote.totalCap)],
            ['股息率', quote.divYield > 0 ? `${fmt(quote.divYield)}%` : '—'],
        ];

        const planMeta = plan.meta || {};
        return <Page title={title} description={`${stock.code6 || ''} · ${stock.updDate ? '计划复核 ' + stock.updDate : '计划复核日期未设置'} · 辅助参考，不构成投资建议`}
                     actions={[{label: '刷新', icon: <ReloadOutlined/>, onClick: this.load}]}>
            {this.renderHeader(data)}

            <Card size="small" style={{marginTop: 8}}>
                <StatGrid items={[['昨收', fmt(quote.prevClose)], ['成交额', fmtAmount(quote.amount)], ['换手率', quote.turnover === null ? '—' : `${fmt(quote.turnover)}%`]]}/>
            </Card>

            <Card size="small" style={{marginTop: 12}} title="K 线"
                  extra={<Segmented size="small" value={this.state.period}
                      onChange={period => { this.setState({period}); this.loadChart(period); }}
                      options={[{label: '日 K', value: 'day'}, {label: '月 K', value: 'month'}]}/>}>
                {this.state.bars.length
                    ? <Echart option={klineOption(this.state.bars, this.state.period)} style={{height: 380}}/>
                    : <Empty description={this.state.chartLoading ? 'K 线加载中…' : '暂无 K 线数据'}/>}
            </Card>

            <div className="sh-index-grid" style={{marginTop: 12}}>
                <Card size="small" title="估值与财务">
                    <StatGrid items={valuationItems}/>
                </Card>
                <Card size="small" title="周期位置">
                    <div className="sh-mini">52 周区间：{fmt(quote.low52)} — {fmt(quote.high52)}</div>
                    <div className="sh-ruler" style={{marginTop: 16}}>
                        <span className="sh-ruler-tick" style={{left: `${quote.position52 ?? 0}%`, background: '#1677ff'}}/>
                        <span className="sh-ruler-label" style={{left: `${Math.min(100, Math.max(0, quote.position52 ?? 0))}%`}}>
                            {quote.position52 === null ? '区间缺失' : `分位 ${quote.position52.toFixed(0)}% · ${quote.zone52}`}
                        </span>
                    </div>
                    <div className="sh-mini">距低点 {fmtPct(quote.toLow)} · 距高点 {fmtPct(quote.toHigh)}</div>
                    <div className="sh-mini sh-section">历史分位（月 K）：{historyData.pos === null ? '—' : `${historyData.pos.toFixed(0)}%`}
                        {historyData.count ? ` · ${historyData.count} 根月K · 低 ${fmt(historyData.lo)} / 高 ${fmt(historyData.hi)}` : ''}</div>
                    <div className="sh-mini sh-section">同组比价：{peer.summary || '暂无同组数据'}</div>
                </Card>
            </div>

            <Card size="small" title="跟踪计划" style={{marginTop: 12}}
                  extra={<Space>{['破净', '八折'].map(flag => quote.pb !== null && quote.pb > 0 && ((flag === '八折' && quote.pb <= 0.8) || (flag === '破净' && quote.pb < 1))
                      ? <Tag key={flag} color={flag === '八折' ? 'green' : 'blue'}>{flag}</Tag> : null)}</Space>}>
                <Ruler plan={plan} price={quote.price}/>
                <Table size="small" pagination={false} rowKey="key" dataSource={plan.levels || []}
                       columns={[
                           {title: '档位', dataIndex: 'label', width: 80},
                           {title: '价格', dataIndex: 'value', align: 'right', render: v => fmt(v)},
                           {
                               title: '距现价', dataIndex: 'diffPct', align: 'right',
                               render: (v, row) => v === null ? '—' : <span className={tone(v)}>{row.direction} {fmt(Math.abs(v))}%</span>,
                           },
                           {
                               title: '状态', dataIndex: 'statusLabel', align: 'right',
                               render: (v, row) => <Tag color={row.status === 'reached' ? 'green' : row.status === 'blocked' ? 'red' : row.status === 'unset' ? 'default' : 'blue'}>{v}</Tag>,
                           },
                       ]}/>
                <StatGrid items={[
                    ['年初价', fmt(planMeta.yearInit)],
                    ['年初至今', <span className={tone(planMeta.ytd)}>{fmtPct(planMeta.ytd)}</span>],
                    ['昨日涨幅', <span className={tone(planMeta.prevChg)}>{fmtPct(planMeta.prevChg)}</span>],
                    ['分组', planMeta.group || '—'],
                    ['更新日期', planMeta.updDate || '—'],
                    ['别名', planMeta.alias || '—'],
                ]}/>
                {plan.buyBlock ? <Alert style={{marginTop: 10}} type="error" showIcon message={`买入资格：${plan.buyBlock}`}/> : null}
            </Card>

            <div className="sh-index-grid" style={{marginTop: 12}}>
                <Card size="small" title="补仓参考" extra={<Tag color={add.score >= 3 ? 'green' : add.score === 2 ? 'gold' : 'default'}>{add.badge}</Tag>}>
                    <CheckRows checks={add.checks}/>
                    <div className="sh-mini sh-section">{add.hint}</div>
                    <StatGrid items={[['POC', add.stats?.find(s => s.label === 'POC')?.value || '—'],
                        ['MA20', add.stats?.find(s => s.label === 'MA20')?.value || '—'],
                        ['日线 MFI', add.stats?.find(s => s.label === '日线 MFI')?.value || '—'],
                        ['距支撑', add.stats?.find(s => s.label === '距支撑')?.value || '—']]}/>
                </Card>
                <Card size="small" title="鳄鱼纪律" extra={<Tag color={discipline.allPass ? 'green' : 'default'}>纪律 {discipline.passed}/{discipline.total}{discipline.complete ? '' : '?'}</Tag>}>
                    <CheckRows checks={discipline.checks}/>
                    {discipline.limitUp && discipline.limitUp.count >= 2 ? <Alert style={{marginTop: 10}} type="warning" showIcon
                        message={`连续 ${discipline.limitUp.count} 个涨停（最近 ${discipline.limitUp.lastDate}）${discipline.limitUp.opened ? '，最近交易日涨停已打开' : ''}`}
                        description="按「卖其疯狂」纪律：不再猜顶，涨停打开时清仓或分批卖出。"/> : null}
                </Card>
            </div>

            <div className="sh-index-grid" style={{marginTop: 12}}>
                <Card size="small" title="评分" extra={score.kind === 'machine' ? <Tag>机器复算</Tag> : score.kind === 'report' ? <Tag color="blue">研报原始分</Tag> : null}>
                    <ScorePanel score={score}/>
                </Card>
                <Card size="small" title="资源股估值计算">
                    <Space wrap>
                        <InputNumber style={{width: 120}} addonBefore="P 价格" value={this.state.calc.p}
                                     onChange={v => this.updateCalc('p', v)} placeholder="元/吨"/>
                        <InputNumber style={{width: 120}} addonBefore="C 成本" value={this.state.calc.c}
                                     onChange={v => this.updateCalc('c', v)} placeholder="元/吨"/>
                        <InputNumber style={{width: 120}} addonBefore="Q 年产量" value={this.state.calc.q}
                                     onChange={v => this.updateCalc('q', v)} placeholder="万吨"/>
                        <InputNumber style={{width: 130}} addonBefore="折价" min={0} max={1} step={0.05}
                                     value={this.state.calc.discount} onChange={v => this.updateCalc('discount', v)}/>
                        <InputNumber style={{width: 120}} addonBefore="倍数" min={1}
                                     value={this.state.calc.multiple} onChange={v => this.updateCalc('multiple', v)}/>
                    </Space>
                    <Alert style={{marginTop: 12}} type="info" message={this.calcResult()}/>
                    <div className="sh-mini" style={{marginTop: 8}}>公式：(P − C) × Q × 1e4 × 折价 × 倍数 = 合理市值；仅用于资源股粗算，参数保存在本机。</div>
                </Card>
            </div>
            <div className="sh-mini" style={{marginTop: 10}}>
                数据日期 {quote.listedAt ? `上市 ${quote.listedAt}` : ''} · 行情源未提供的数据显示「—」，不填充推测值。辅助参考，不构成投资建议。
            </div>
        </Page>;
    }
}
