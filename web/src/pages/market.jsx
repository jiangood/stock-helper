import React from 'react';
import {Alert, Button, Card, Empty, Space, Tag, Typography} from 'antd';
import {ReloadOutlined} from '@ant-design/icons';
import {HttpClient, Page, PageUtils, history} from '@jiangood/open-admin';
import Echart from '../components/Echart';
import Sparkline from '../components/Sparkline';
import {fmt, fmtPct, isNum, num, tone} from '../lib/format';

const {Text} = Typography;

function lineOption(points, name, unit) {
    const data = (Array.isArray(points) ? points : []).filter(p => p && isNum(p.close ?? p.value));
    return {
        animation: false,
        grid: {left: 8, right: 52, top: 10, bottom: 20},
        tooltip: {trigger: 'axis'},
        xAxis: {
            type: 'category',
            boundaryGap: false,
            data: data.map(p => p.date || p.time || ''),
            axisLabel: {fontSize: 9, formatter: v => String(v).slice(2)},
        },
        yAxis: {type: 'value', scale: true, position: 'right', axisLabel: {fontSize: 9}},
        series: [{
            name,
            type: 'line',
            showSymbol: false,
            data: data.map(p => num(p.close ?? p.value)),
            lineStyle: {width: 1.8},
            areaStyle: {opacity: 0.08},
        }],
        tooltipValueFormatter: unit,
    };
}

function Stat({label, value, note, className}) {
    return <div className="sh-stat">
        <div className="sh-stat-label">{label}</div>
        <div className={`sh-stat-value ${className || ''}`}>{value}</div>
        {note ? <div className="sh-mini">{note}</div> : null}
    </div>;
}

function SectorCard({sector}) {
    return <Card size="small" title={<Space><span>{sector.name}</span><Tag>{sector.covered}/{sector.count} 有月线</Tag></Space>}>
        <Space align="baseline" size={10} wrap>
            <span className={`sh-price ${tone(sector.avg)}`} style={{fontSize: 22}}>{fmtPct(sector.avg)}</span>
            <span className="sh-mini">近 12 月平均涨跌</span>
            <span className="sh-mini">涨 {sector.up} · 跌 {sector.down} · 到计划区 {sector.zone}</span>
        </Space>
        <Space size={14} wrap className="sh-section">
            <span>近1月 <b className={tone(sector.avg1)}>{fmtPct(sector.avg1)}</b></span>
            <span>近3月 <b className={tone(sector.avg3)}>{fmtPct(sector.avg3)}</b></span>
            <span>近6月 <b className={tone(sector.avg6)}>{fmtPct(sector.avg6)}</b></span>
        </Space>
        <div className="sh-mini" style={{marginTop: 8}}>月线领先 · 近 12 个月</div>
        <div>
            {(sector.leaders || []).length ? sector.leaders.map(item => <a key={item.code} className="sh-link"
                    style={{marginRight: 10}} onClick={() => PageUtils.open(`/stock/${item.code}`, item.name)}>
                {item.name} <span className={tone(item.change)}>{fmtPct(item.change)}</span>
            </a>) : <span className="sh-mini">暂无有效月线涨跌幅</span>}
        </div>
    </Card>;
}

function BusinessCard({item}) {
    const series = (Array.isArray(item.series) ? item.series : [])
        .filter(p => p && (num(p.spot) > 0 || num(p.futures) > 0))
        .slice(-60);
    const metric = series.some(p => num(p.spot) > 0) ? 'spot' : 'futures';
    const points = series.map(p => ({date: p.date, value: num(p[metric])}));
    const first = points.length ? points[0].value : null;
    const last = points.length ? points[points.length - 1].value : null;
    const delta = first > 0 && last > 0 ? (last / first - 1) * 100 : num(item.changePct);
    const trend = delta === null ? '趋势数据不足' : fmtPct(delta);
    const inventory = item.inventory;
    const links = item.industryLinks;
    const monthly = item.monthlyPrices?.series || [];
    return <Card size="small" title={<Space><span>{item.name}</span><Tag>{item.unit || '价格'}</Tag>
        <Tag color={item.status === 'ok' ? 'green' : item.status === 'latest-only' ? 'blue' : 'default'}>{item.status === 'ok' ? '现货/期货历史' : item.status === 'latest-only' ? '自动最新报价' : '等待可靠数据'}</Tag>
    </Space>}>
        <Space align="baseline" size={12} wrap>
            <span className="sh-price" style={{fontSize: 22}}>{item.latest === null ? '—' : fmt(item.latest)}</span>
            <span className={`${tone(delta)} sh-price`}>{trend}</span>
            <span className="sh-mini">{item.latestDate ? `数据日期 ${item.latestDate}` : '当前没有有效报价'}</span>
        </Space>
        {points.length >= 2 ? <Echart style={{height: 170}} option={lineOption(points, item.name, item.unit)}/> : null}
        {item.latestFutures !== null && item.latestFutures !== undefined
            ? <div className="sh-mini">期货参考价 {fmt(item.latestFutures)} {item.unit} · {item.futuresDate || ''} {item.futuresSource || ''}</div> : null}
        {monthly.length ? <div className="sh-mini" style={{marginTop: 6}}>近月快照：{monthly.map(p => `${p.label} ${fmt(p.value)}`).join(' · ')}</div> : null}
        {inventory && inventory.latest !== null ? <div className="sh-section">
            <div className="sh-mini">{inventory.label || '期货仓单库存'}</div>
            <Space size={10}><b>{fmt(inventory.latest)}</b><span className="sh-mini">较上期 {inventory.change ?? '—'}</span></Space>
            <div className="sh-mini">日期 {inventory.latestDate || '—'} · <a href={inventory.sourceUrl || 'https://data.eastmoney.com/ifdata/kcsj.html'} target="_blank" rel="noreferrer">数据来源</a></div>
        </div> : <div className="sh-mini sh-section">供需指标：该品种暂未取得可靠的自动仓单数据</div>}
        {links ? <div className="sh-section">
            <div className="sh-mini">产业链企业（数据源列示，不代表持股或确定供销关系）</div>
            <div className="sh-mini">生产商：{(links.producers || []).join('、') || '未列示'}</div>
            <div className="sh-mini">下游用户：{(links.downstreamUsers || []).join('、') || '未列示'}</div>
        </div> : <div className="sh-mini sh-section">产业链企业名单：暂未获取到可靠的自动数据</div>}
        <div className="sh-mini sh-section">产业链：{item.chain || '—'}</div>
        <div className="sh-mini" style={{lineHeight: 1.6}}>{item.drivers || ''}</div>
        <div className="sh-section">
            <div className="sh-mini">关联股票池</div>
            {(item.stocks || []).map(name => <Tag key={name} style={{marginBottom: 4}}>{name}</Tag>)}
        </div>
        <div className="sh-mini sh-section">数据源：{item.source || '暂未匹配到可靠的自动报价源'}
            {item.sourceUrl ? <> · <a href={item.sourceUrl} target="_blank" rel="noreferrer">查看来源</a></> : null}</div>
    </Card>;
}

function CostCard({input}) {
    const points = (Array.isArray(input.series) ? input.series : [])
        .filter(p => p && isNum(p.spot ?? p.futures ?? p.value))
        .map(p => ({date: p.date, value: num(p.spot ?? p.futures ?? p.value)}));
    const first = points.length ? points[0].value : null;
    const last = points.length ? points[points.length - 1].value : null;
    const change = first > 0 && last > 0 ? (last / first - 1) * 100 : null;
    return <Card size="small" title={<Space><span>{input.name}</span><Tag>{input.unit || '元/吨'}</Tag></Space>}>
        <Space align="baseline" size={12} wrap>
            <span className="sh-price" style={{fontSize: 22}}>{input.latest === null ? '—' : fmt(input.latest)}</span>
            <span className={`sh-price ${tone(change)}`}>{change === null ? '趋势数据不足' : fmtPct(change)}</span>
            <span className="sh-mini">{input.latestDate ? `数据日期 ${input.latestDate}` : '当前没有有效报价'}</span>
        </Space>
        {points.length >= 2 ? <Echart style={{height: 150}} option={lineOption(points, input.name, input.unit)}/> : null}
        <div className="sh-mini">关联观察：{(input.relatedProducts || []).join('、') || '—'}</div>
        <div className="sh-mini">{input.role || '原料价格参考'} · {input.status === 'pending' ? '等待可靠数据' : input.status}</div>
        <div className="sh-mini">来源：{input.source || '尚未获取到可靠数据'}</div>
    </Card>;
}

export default class MarketPage extends React.Component {
    state = {loading: false, data: null, error: ''};

    onShow() {
        this.load();
    }

    load = async () => {
        this.setState({loading: true, error: ''});
        try {
            const rs = await HttpClient.get('admin/market/overview');
            this.setState({data: rs.data || null, loading: false});
        } catch (e) {
            this.setState({loading: false, error: e.message || '读取失败'});
        }
    };

    render() {
        const {data} = this.state;
        if (!data) {
            return <Page title="行情概览" actions={[{label: '刷新', icon: <ReloadOutlined/>, onClick: this.load}]}>
                {this.state.error ? <Alert type="error" showIcon message={this.state.error}/> :
                    <Empty description={this.state.loading ? '正在读取行情数据…' : '暂无行情数据'}/>}
            </Page>;
        }
        const meta = data.meta || {};
        const pulse = data.pulse || {};
        return <Page title="行情概览"
                     description={`行情日 ${meta.marketDate || '未知'} · 缓存生成 ${meta.quoteUpdatedAt ? new Date(meta.quoteUpdatedAt).toLocaleString('zh-CN', {hour12: false}) : '未知'} · 板块月线 ${meta.sectorCovered || 0}/${meta.sectorTotal || 0} 只`}
                     actions={[{label: '刷新', icon: <ReloadOutlined/>, onClick: this.load}]}>
            {meta.stale && !this.state.loading ? <Alert type="warning" showIcon style={{marginBottom: 12}}
                message="行情缓存不是今日数据，可能滞后；页面只展示已发布的静态快照，不请求外部行情源。"/> : null}

            <div className="sh-index-grid">
                {(data.indices || []).map(index => <Card key={index.code} size="small">
                    <div className="sh-mini">{index.name}</div>
                    <Space align="baseline" size={10}>
                        <span className="sh-price" style={{fontSize: 26}}>{index.price ?? '—'}</span>
                        <span className={`sh-price ${tone(index.todayChange)}`}>{fmtPct(index.todayChange)}</span>
                    </Space>
                    <div className="sh-mini">近 {index.monthly?.length || 0} 个月月线</div>
                    <Sparkline points={index.monthly || []} height={42} positive={(index.monthly?.length || 0) > 1
                        && num(index.monthly[index.monthly.length - 1].close) >= num(index.monthly[0].close)}/>
                    <div className="sh-mini">按月收盘价连线 · 本月数据可能尚未收盘</div>
                </Card>)}
            </div>

            <div className="sh-index-grid" style={{marginTop: 12}}>
                <Stat label="涨 / 跌 / 平" value={`${pulse.up || 0} / ${pulse.down || 0} / ${pulse.flat || 0}`} note="仅统计本股票池，不代表全市场"/>
                <Stat label="股票池平均涨跌" value={fmtPct(pulse.avgChange)} note="等权平均温度参考"/>
                <Stat label="到计划价区" value={`${pulse.zoneCount || 0} 只`} note="按股票池入场 / 重仓计划价统计"/>
            </div>

            <Card size="small" title="板块月线强弱" style={{marginTop: 12}}>
                <div className="sh-mini" style={{marginBottom: 8}}>按月线收盘价计算板块内等权平均涨跌幅，主导指标为近 12 个月；本月数据可能尚未收盘。</div>
                <div className="sh-sector-grid">
                    {(data.sectors || []).map(sector => <SectorCard sector={sector} key={sector.name}/>)}
                </div>
            </Card>

            <Card size="small" title={`全球资产 · 最近报价`} style={{marginTop: 12}}>
                <div className="sh-index-grid">
                    {(data.globalAssets || []).map(asset => <Card size="small" key={asset.id}>
                        <Space align="baseline" size={8} wrap>
                            <b>{asset.name}</b><Tag>{asset.kind}</Tag>
                            <span className={`sh-price ${tone(asset.changePct)}`} style={{fontSize: 18}}>{fmt(asset.price)}</span>
                            <span className={`${tone(asset.changePct)} sh-price`}>{fmtPct(asset.changePct)}</span>
                        </Space>
                        <Sparkline points={asset.history || []} height={36}/>
                        <div className="sh-mini">{asset.status} · {asset.quoteTime ? new Date(asset.quoteTime).toLocaleString('zh-CN', {hour12: false}) : '报价日期未知'}</div>
                    </Card>)}
                </div>
                <div className="sh-mini" style={{marginTop: 8}}>
                    <a onClick={() => history.push('/global-assets')}>查看全球资产趋势对比与排行 →</a>
                </div>
            </Card>

            <Card size="small" title={`产业链商品 · ${data.business?.validCount || 0}/${(data.business?.items || []).length} 个品种有有效报价`}
                  extra={<span className="sh-mini">数据非逐笔实时</span>} style={{marginTop: 12}}>
                <div className="sh-business-grid">
                    {(data.business?.items || []).map(item => <BusinessCard item={item} key={item.id}/>)}
                </div>
            </Card>

            <Card size="small" title="成本原料参考" style={{marginTop: 12}}>
                <div className="sh-business-grid">
                    {(data.business?.costInputs || []).map(input => <CostCard input={input} key={input.id}/>)}
                </div>
            </Card>
        </Page>;
    }
}
