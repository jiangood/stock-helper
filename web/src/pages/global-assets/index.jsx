import React from 'react';
import {Button, Card, Empty, Segmented, Space, Tag, Typography} from 'antd';
import {ReloadOutlined} from '@ant-design/icons';
import {HttpClient, Page} from '@jiangood/open-admin';
import Echart from '../../components/Echart';
import Sparkline from '../../components/Sparkline';
import {fmt, fmtPct, isNum, num, tone} from '../../lib/format';

const {Text} = Typography;

const fmtPrice = (value, id) => {
    const n = num(value);
    if (n === null || n <= 0) return '—';
    const digits = id === 'bitcoin' ? 0 : id === 'usdcny' ? 4 : 2;
    return n.toLocaleString('en-US', {minimumFractionDigits: digits, maximumFractionDigits: digits});
};

const historyOf = (asset, range) => {
    const list = (asset?.history || []).filter(p => p && num(p.close) > 0);
    return range === '1w' ? list.slice(-5) : list.slice(-22);
};

function rangeChange(asset, range) {
    const points = historyOf(asset, range);
    if (points.length >= 2) {
        const first = num(points[0].close);
        const last = num(points[points.length - 1].close);
        return first > 0 ? (last - first) / first * 100 : null;
    }
    return num(asset?.changePct);
}

export default class GlobalAssetsPage extends React.Component {
    state = {loading: false, data: null, error: '', range: '1m'};

    onShow() {
        this.load();
    }

    load = async () => {
        this.setState({loading: true, error: ''});
        try {
            const rs = await HttpClient.get('admin/global-assets/list');
            this.setState({data: rs.data || null, loading: false});
        } catch (e) {
            this.setState({loading: false, error: e.message || '读取失败'});
        }
    };

    comparisonOption() {
        const assets = this.state.data?.assets || [];
        const range = this.state.range;
        const seriesData = assets.map(asset => {
            const points = historyOf(asset, range);
            if (points.length < 2) return null;
            const base = num(points[0].close);
            if (!(base > 0)) return null;
            return {
                name: asset.name,
                points: points.map(p => ({date: String(p.date), value: num(p.close) / base * 100})),
            };
        }).filter(Boolean);
        if (!seriesData.length) return null;
        const dates = Array.from(new Set(seriesData.flatMap(s => s.points.map(p => p.date)))).sort();
        const values = seriesData.flatMap(s => s.points.map(p => p.value));
        const min = Math.floor(Math.min(...values, 100) - 1);
        const max = Math.ceil(Math.max(...values, 100) + 1);
        return {
            animation: false,
            color: ['#2563eb', '#7c3aed', '#0891b2', '#d97706', '#db2777', '#16a34a', '#64748b', '#dc2626'],
            legend: {top: 0, type: 'scroll', textStyle: {fontSize: 11}},
            grid: {left: 46, right: 16, top: 36, bottom: 28},
            tooltip: {trigger: 'axis'},
            xAxis: {type: 'category', data: dates, axisLabel: {fontSize: 10}},
            yAxis: {type: 'value', scale: true, axisLabel: {fontSize: 10, formatter: v => Number(v).toFixed(0)}},
            series: seriesData.map(s => ({
                name: s.name,
                type: 'line',
                showSymbol: false,
                smooth: true,
                data: dates.map(date => {
                    const point = s.points.find(p => p.date === date);
                    return point ? Number(point.value.toFixed(2)) : null;
                }),
            })),
        };
    }

    render() {
        const {data} = this.state;
        if (!data) {
            return <Page title="全球资产" actions={[{label: '刷新', icon: <ReloadOutlined/>, onClick: this.load}]}>
                {this.state.error ? <Empty description={this.state.error}/> :
                    <Empty description={this.state.loading ? '正在读取全球资产行情…' : '暂无数据'}/>}
            </Page>;
        }
        const assets = data.assets || [];
        const ranked = assets.map(asset => ({asset, change: num(asset.changePct)}))
            .filter(item => item.change !== null)
            .sort((a, b) => b.change - a.change);
        const option = this.comparisonOption();
        return <Page title="全球资产"
                     description={`${data.updatedAt ? '最近报价 ' + new Date(data.updatedAt).toLocaleString('zh-CN', {hour12: false}) : '尚无抓取记录'} · ${data.source || ''}`}
                     actions={[{label: '刷新', icon: <ReloadOutlined/>, onClick: this.load}]}>
            <div className="sh-index-grid" style={{marginBottom: 12}}>
                {ranked.map((item, index) => <Card size="small" key={item.asset.id}>
                    <Space align="baseline" size={8}>
                        <span className="sh-mini">NO.{index + 1}</span>
                        <b>{item.asset.name}</b>
                        <span className={`sh-price ${tone(item.change)}`}>{item.change > 0 ? '▲' : item.change < 0 ? '▼' : '—'} {Math.abs(item.change).toFixed(2)}%</span>
                    </Space>
                    <Sparkline points={historyOf(item.asset, '1m')} height={38}/>
                    <div className="sh-mini">{item.asset.status || '行情状态未知'}</div>
                </Card>)}
            </div>

            <Card size="small" title="趋势对比" extra={<Segmented size="small" value={this.state.range}
                    onChange={range => this.setState({range})}
                    options={[{label: '近 1 周', value: '1w'}, {label: '近 1 月', value: '1m'}]}/>}>
                <div className="sh-mini">将各资产区间起点归一为 100，比较相对涨跌，不比较绝对价格。缺失数据不补值；VIX 是波动率指标，方向含义与风险资产不同。</div>
                {option ? <Echart option={option} style={{height: 320}}/> : <Empty description="趋势对比数据正在积累"/>}
            </Card>

            <div className="sh-index-grid" style={{marginTop: 12}}>
                {assets.map(asset => <Card size="small" key={asset.id}>
                    <Space align="baseline" size={8} wrap>
                        <b>{asset.name}</b>
                        <Tag>{asset.kind} · {asset.currency || asset.unit}</Tag>
                        <Tag>{asset.status}</Tag>
                    </Space>
                    <div className="sh-price" style={{fontSize: 26, marginTop: 6}}>{fmtPrice(asset.price, asset.id)}</div>
                    <div className={`sh-price ${tone(asset.changePct)}`}>{fmtPct(asset.changePct)}</div>
                    <Sparkline points={historyOf(asset, '1m')} height={40}/>
                    {asset.id === 'vix' ? <div className="sh-mini">VIX 衡量标普 500 期权隐含的预期波动；上升通常代表市场担忧增强，不是方向预测。</div> : null}
                    {asset.id === 'usdcny' ? <div className="sh-mini">报价含义：1 美元可兑换多少人民币。数值上升代表美元走强、人民币相对走弱。</div> : null}
                    <div className="sh-mini">报价日期：{asset.quoteTime ? new Date(asset.quoteTime).toLocaleString('zh-CN', {hour12: false}) : '未知'}</div>
                    <div className="sh-mini">代码：{asset.sourceSymbol || '—'} · <a href={asset.sourceUrl || 'https://finance.yahoo.com/'} target="_blank" rel="noreferrer">行情来源</a></div>
                </Card>)}
            </div>
        </Page>;
    }
}
