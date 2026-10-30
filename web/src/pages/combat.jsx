import React from 'react';
import {Alert, Button, Empty, Space, Table, Tag, Tooltip, Typography} from 'antd';
import {ReloadOutlined} from '@ant-design/icons';
import {HttpClient, Page, PageUtils, history} from '@jiangood/open-admin';
import {fmt, fmtPct, isNum, num, tone} from '../lib/format';

const {Text} = Typography;

const kindColor = kind => ({
    'add-ready': 'green',
    'add-watch': 'gold',
    risk: 'red',
    data: 'default',
    exit: 'volcano',
    watch: 'blue',
}[kind] || 'default');

function quoteLabel(value) {
    if (!value) return '报价时间未提供';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '报价时间异常';
    return `报价 ${d.toLocaleString('zh-CN', {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false})}`;
}

function reviewLabel(stock) {
    const value = stock?.updDate;
    if (!value) return '计划复核日期未设置';
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return '计划复核日期无效';
    const age = Math.floor((Date.now() - date.getTime()) / 86400000);
    if (age < 0) return '计划复核日期在未来，请核对';
    return `计划复核 ${value}${age > 180 ? ` · 已 ${age} 天未复核` : ` · ${age} 天前`}`;
}

function Chips({items, empty}) {
    if (!items || !items.length) return <span className="sh-mini">{empty || '暂无'}</span>;
    return <div className="sh-chips">
        {items.map((item, index) => <span className="sh-chip" key={index}>{item}</span>)}
    </div>;
}

function CheckGrid({checks}) {
    if (!checks || !checks.length) return <Text type="secondary">暂无检查项</Text>;
    return <div>
        {checks.map((item, index) => <div className="sh-check-row" key={index}>
            <span className={`sh-check-tone ${item.tone}`}>{item.tone === 'ok' ? '✓' : item.tone === 'bad' ? '×' : item.tone === 'warn' ? '!' : '·'}</span>
            <div>
                <div className="sh-check-value">{item.label} · {item.value}</div>
                {item.note ? <div className="sh-check-note">{item.note}</div> : null}
            </div>
        </div>)}
    </div>;
}

function detail(record) {
    const add = record.add;
    const exit = record.exit;
    const ind = record.indicators;
    const macd = ind?.macd;
    const cooling = exit && exit.cooldownDays > 0;
    const plan = [
        num(record.stock?.entry) > 0 ? `入场 ${fmt(record.stock.entry)}` : null,
        num(record.stock?.heavy) > 0 ? `重仓 ${fmt(record.stock.heavy)}` : null,
        num(record.stock?.tp1) > 0 ? `止盈1 ${fmt(record.stock.tp1)}` : null,
        num(record.stock?.tp2) > 0 && record.stock.tp2 !== record.stock.tp1 ? `止盈2 ${fmt(record.stock.tp2)}` : null,
    ].filter(Boolean).join(' · ');

    let buySection;
    if (cooling) {
        buySection = <>
            <div className="sh-card-title">买入检查 · 冷却期</div>
            <Chips items={[
                `止盈已触发 ${exit.barsSinceTrigger} 个交易日前`,
                `冷却剩余 ${exit.cooldownDays} 个交易日，不生成买入信号`,
            ]}/>
        </>;
    } else if (!record.inZone) {
        buySection = <>
            <div className="sh-card-title">买入检查 · 未到买入区</div>
            <Chips items={[(record.primary?.reasons || [])[0] || '现价不低于入场价', '规则要求现价低于入场价，不追高']}/>
        </>;
    } else if (!add || !add.dataReady) {
        buySection = <>
            <div className="sh-card-title">买入检查</div>
            <Chips items={[(add?.reasons || [])[0] || '日K不足，无法计算']}/>
        </>;
    } else {
        buySection = <>
            <div className="sh-card-title">买入检查 · {add.score}/4 · {add.regimeLabel}</div>
            <Chips items={add.reasons || []}/>
            <div className="sh-mini sh-section">RSI {fmt(ind?.rsi, 1)} · MFI {fmt(ind?.mfi, 1)}
                · MACD 柱 {macd ? fmt(macd.histogram, 3) : '—'} · MA20 {fmt(ind?.ma20)}
                {add.veto ? ' · 一票否决生效' : ''}</div>
        </>;
    }

    return <div className="sh-combat-detail">
        <Space size={[8, 6]} wrap>
            <Tag color={kindColor(record.primary?.kind)}>{record.primary?.status}</Tag>
            {add && add.dataReady && add.inZone ? <Tag color={kindColor(add.kind)}>买入评分 {add.score}/4</Tag> : null}
            {exit?.state === '已触发' ? <Tag color="volcano">止盈 · 已触发</Tag> : null}
            {exit?.state === '跟踪中' ? <Tag color="blue">止盈 · 跟踪中</Tag> : null}
            {cooling ? <Tag>离场冷却 {exit.cooldownDays} 日</Tag> : null}
            <span className="sh-mini">{plan || '未配置计划价'}</span>
            <span className="sh-mini">{quoteLabel(record.quote?.quoteTime)}</span>
            <span className="sh-mini">{reviewLabel(record.stock)}</span>
        </Space>

        <div className="sh-section">{buySection}</div>

        {exit ? <div className="sh-section">
            <div className="sh-card-title">止盈跟踪 · {exit.state}{cooling ? `（冷却 ${exit.cooldownDays} 日）` : ''}</div>
            <Chips items={exit.reasons || []}/>
        </div> : null}

        <div className="sh-section">
            <div className="sh-card-title">技术指标 · RSI / MACD / MFI / 均线 / OBV</div>
            <div className="sh-indicator-grid">
                <div className="sh-indicator">
                    <div className="sh-mini">RSI(14) · 相对强弱</div>
                    <strong>{fmt(ind?.rsi, 1)}</strong>
                    <span>{ind?.rsiState || '数据不足'} · {ind?.rsiTrend || '—'}</span>
                    <small>下跌趋势需 ≤30，回调需 25–35，上涨需 ≤45。</small>
                </div>
                <div className="sh-indicator">
                    <div className="sh-mini">MACD(12,26,9) · 趋势动能</div>
                    <strong>{macd ? `DIF ${fmt(macd.dif, 3)}` : '—'}</strong>
                    <span>{ind?.macdState || '数据不足'} · {ind?.macdCross || '—'}</span>
                    <small>{macd ? `DEA ${fmt(macd.dea, 3)} · 柱 ${fmt(macd.histogram, 3)}` : '历史K线不足'}</small>
                </div>
                <div className="sh-indicator">
                    <div className="sh-mini">MFI(14) · 资金流量</div>
                    <strong>{fmt(ind?.mfi, 1)}</strong>
                    <span>{ind?.mfi === null || ind?.mfi === undefined ? '数据不足'
                        : ind.mfi < 20 ? '低位（下跌趋势中否决）' : ind.mfi > 80 ? '高位' : '中间区间'}</span>
                    <small>下跌趋势要求 ≥30；回调 / 上涨要求 &lt;25。</small>
                </div>
                <div className="sh-indicator">
                    <div className="sh-mini">MA20 · 20日均线</div>
                    <strong>{fmt(ind?.ma20)}</strong>
                    <span>{ind?.ma20Relation || '数据不足'}</span>
                    <small>现价≥MA20 为上涨；MA20≥MA60 为回调；否则为下跌趋势。</small>
                </div>
                <div className="sh-indicator">
                    <div className="sh-mini">OBV · 能量潮</div>
                    <strong>{ind?.obv === null || ind?.obv === undefined ? '—' : Number(ind.obv).toLocaleString('zh-CN')}</strong>
                    <span>累计量价方向指标</span>
                    <small>上涨日加量、下跌日减量，用于动能项的第二判据。</small>
                </div>
                <div className="sh-indicator">
                    <div className="sh-mini">数据口径</div>
                    <strong>{ind?.bars || 0} 根日K</strong>
                    <span>{ind?.bars >= 60 ? '可计算全部信号' : '历史长度不足'}</span>
                    <small>RSI 用 14 期 Wilder 平滑；MACD 12/26/9；均线用前复权日 K。</small>
                </div>
            </div>
            <div className="sh-mini sh-section">四项评分只决定是否进入买入观察，不代表可以重仓；卖出侧只有一条回撤止盈规则，不设止损。</div>
        </div>

        <Alert className="sh-section" type="warning" showIcon
               message="计划失效 / 退出复核"
               description={<ul style={{margin: 0, paddingLeft: 18}}>
                   <li>行情过期、计划长期未复核或纪律拦截时，暂停新增操作并先核验数据。</li>
                   <li>商品供需 / 周期转向、公司经营假设被证伪时，重新评估持有逻辑与估值。</li>
                   <li>止盈触发后按规则次日卖出；卖出后 60 个交易日内不再买回。</li>
                   <li>本规则不设止损，亏损由仓位控制承担。</li>
               </ul>}/>
        <div className="sh-mini sh-section">{record.dataNote || '辅助参考，不构成投资建议'} · 计划价需结合最新基本面与商品周期复核</div>
    </div>;
}

export default class CombatPage extends React.Component {
    state = {loading: false, rows: [], counts: {}, error: '', generatedAt: null};

    onShow() {
        this.load();
    }

    load = async () => {
        this.setState({loading: true, error: ''});
        try {
            const rs = await HttpClient.get('admin/combat/list');
            const data = rs.data || {};
            this.setState({
                rows: Array.isArray(data.rows) ? data.rows : [],
                counts: data.counts || {},
                generatedAt: data.generatedAt || null,
                loading: false,
            });
        } catch (e) {
            this.setState({loading: false, error: e.message || '读取失败'});
        }
    };

    columns = [
        {
            title: '名称', dataIndex: 'name', width: 150, fixed: 'left',
            sorter: (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh'),
            render: (_, row) => <a className="sh-link" onClick={() => PageUtils.open(`/stock/${row.stock?.code}`, row.name)}>{row.name}</a>,
        },
        {
            title: '现价', dataIndex: 'price', width: 100, align: 'right',
            sorter: (a, b) => (num(a.price) ?? -Infinity) - (num(b.price) ?? -Infinity),
            render: (v, row) => <span className={tone(row.quote?.todayChange)}>
                <span className="sh-price">{fmt(v)}</span>
                {row.quote?.todayChange !== null ? <span className="sh-sub">{fmtPct(row.quote.todayChange)}</span> : null}
            </span>,
        },
        {
            title: '信号', dataIndex: ['primary', 'status'], width: 150,
            sorter: (a, b) => (a.priority || 0) - (b.priority || 0),
            render: (_, row) => <Tag color={kindColor(row.primary?.kind)}>{row.primary?.status}</Tag>,
        },
        {
            title: '买入评分', dataIndex: 'scoreValue', width: 100, align: 'center',
            sorter: (a, b) => (num(a.scoreValue) ?? -Infinity) - (num(b.scoreValue) ?? -Infinity),
            render: (v, row) => {
                if (v === null || v === undefined) {
                    return <Text type="secondary">—</Text>;
                }
                const color = v >= 3 ? 'green' : v === 2 ? 'gold' : 'red';
                return <div><Tag color={color}>{v}/4</Tag>
                    {row.add?.regimeLabel ? <span className="sh-sub">{row.add.regimeLabel}</span> : null}</div>;
            },
        },
        {
            title: '入场', dataIndex: ['stock', 'entry'], width: 100, align: 'right',
            sorter: (a, b) => (num(a.stock?.entry) ?? -Infinity) - (num(b.stock?.entry) ?? -Infinity),
            render: (v, row) => {
                if (!isNum(v)) return '—';
                const price = num(row.price);
                const gap = price !== null && v > 0 ? (price / v - 1) * 100 : null;
                return <>{fmt(v)}{gap === null ? null : <span className={`sh-sub ${tone(gap)}`}>{fmtPct(gap)}</span>}</>;
            },
        },
        {
            title: '重仓', dataIndex: ['stock', 'heavy'], width: 85, align: 'right',
            sorter: (a, b) => (num(a.stock?.heavy) ?? -Infinity) - (num(b.stock?.heavy) ?? -Infinity),
            render: v => isNum(v) ? fmt(v) : '—',
        },
        {
            title: '止盈状态', dataIndex: ['exit', 'state'], width: 95, align: 'center',
            sorter: (a, b) => String(a.exit?.state || '').localeCompare(String(b.exit?.state || ''), 'zh'),
            render: v => v ? <Tag>{v}</Tag> : '—',
        },
        {
            title: '止盈线', dataIndex: 'exitLine', width: 95, align: 'right',
            sorter: (a, b) => {
                const av = a.exit ? (a.exit.armed ? a.exit.exitLine : a.exit.armLine) : null;
                const bv = b.exit ? (b.exit.armed ? b.exit.exitLine : b.exit.armLine) : null;
                return (num(av) ?? -Infinity) - (num(bv) ?? -Infinity);
            },
            render: (_, row) => row.exit ? fmt(row.exit.armed ? row.exit.exitLine : row.exit.armLine) : '—',
        },
        {
            title: '日K', dataIndex: ['indicators', 'bars'], width: 80, align: 'right',
            sorter: (a, b) => (a.indicators?.bars || 0) - (b.indicators?.bars || 0),
            render: v => v ? `${v} 根` : '—',
        },
    ];

    render() {
        const {counts} = this.state;
        const cards = [
            ['买入观察', counts.add || 0, '现价低于入场价且评分 ≥2', 'green'],
            ['触发止盈', counts.exit || 0, '近 3 日触发，次日确认', 'volcano'],
            ['止盈跟踪中', counts.tracking || 0, '已启动，未到离场线', 'blue'],
            ['离场冷却', counts.cooling || 0, '60 个交易日内不买回', 'default'],
            ['风险拦截', counts.risk || 0, '纪律门槛优先', 'red'],
            ['数据不足', counts.data || 0, '不生成确定信号', 'default'],
        ];
        return <Page title="交易作战"
                     description={`覆盖 ${this.state.rows.length} 只股票池标的 · 买入观察 ${counts.add || 0} · 触发止盈 ${counts.exit || 0} · 跟踪中 ${counts.tracking || 0} · ${this.state.generatedAt ? '计算于 ' + new Date(Number(this.state.generatedAt)).toLocaleTimeString('zh-CN', {hour12: false}) : '等待计算'}`}
                     actions={[{label: '刷新', icon: <ReloadOutlined/>, onClick: this.load}]}>
            <div className="sh-index-grid" style={{marginBottom: 12}}>
                {cards.map(([label, value, note, color]) => <div className="sh-stat" key={label}>
                    <div className="sh-stat-label">{label}</div>
                    <div className={`sh-stat-value ${color === 'green' ? 'sh-good' : color === 'volcano' || color === 'red' ? 'sh-bad' : ''}`}>{value}</div>
                    <div className="sh-mini">{note}</div>
                </div>)}
            </div>
            <Table
                rowKey={row => row.stock?.code}
                size="small"
                loading={this.state.loading}
                columns={this.columns}
                dataSource={this.state.rows}
                pagination={false}
                scroll={{x: 1000, y: 'calc(100vh - 470px)'}}
                expandable={{
                    expandedRowRender: record => detail(record),
                    rowExpandable: () => true,
                    columnWidth: 36,
                }}
                locale={{emptyText: <div className="sh-empty"><Empty description={this.state.error || '暂无可展示的标的'}/></div>}}
            />
        </Page>;
    }
}
