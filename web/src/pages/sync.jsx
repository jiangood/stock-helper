import React from 'react';
import {Alert, Button, Card, Space, Table, Tag, Typography} from 'antd';
import {ReloadOutlined, SyncOutlined} from '@ant-design/icons';
import {HttpClient, Page, PermActions} from '@jiangood/open-admin';
import {fmtDuration, fmtTime} from '../lib/format';

const {Text} = Typography;

const typeLabel = {
    quotes: '股票行情',
    fundamentals: '基本面',
    'global-assets': '全球资产',
    business: '产业链商品',
    all: '全部',
};

const statusColor = status => status === 'success' ? 'green' : status === 'failed' ? 'red' : 'processing';

export default class SyncPage extends React.Component {
    state = {loading: false, status: null, error: '', timer: null};

    onShow() {
        this.load();
        this.startPolling();
    }

    componentWillUnmount() {
        this.stopPolling();
    }

    startPolling() {
        this.stopPolling();
        const timer = setInterval(() => {
            if (this.state.status?.running) {
                this.load();
            }
        }, 5000);
        this.setState({timer});
    }

    stopPolling() {
        if (this.state.timer) {
            clearInterval(this.state.timer);
            this.setState({timer: null});
        }
    }

    load = async () => {
        this.setState({loading: true, error: ''});
        try {
            const rs = await HttpClient.get('admin/sync/status');
            this.setState({status: rs.data || null, loading: false});
        } catch (e) {
            this.setState({loading: false, error: e.message || '读取失败'});
        }
    };

    run = async type => {
        try {
            await HttpClient.post(`admin/sync/run?type=${encodeURIComponent(type)}`);
            setTimeout(this.load, 800);
        } catch (e) {
            // HttpClient 已提示错误，保留页面状态
        }
    };

    render() {
        const {status, error} = this.state;
        const counts = status?.counts || {};
        const lastSuccess = status?.lastSuccess || {};
        const logs = status?.logs || [];
        return <Page title="数据同步"
                     description="行情、基本面、全球资产与产业链商品由服务端采集；定时任务默认在 A 股收盘后运行。失败时保留上一次有效数据。"
                     actions={[{label: '刷新状态', icon: <ReloadOutlined/>, onClick: this.load}]}>
            {error ? <Alert type="error" showIcon message={error} style={{marginBottom: 12}}/> : null}
            {status?.running ? <Alert type="info" showIcon style={{marginBottom: 12}}
                message={`正在运行：${typeLabel[status.runningType] || status.runningType}。页面每 5 秒自动刷新状态。`}/> : null}

            <div className="sh-index-grid">
                <div className="sh-stat">
                    <div className="sh-stat-label">股票池</div>
                    <div className="sh-stat-value">{counts.stocks || 0} 只</div>
                    <div className="sh-mini">行情 {counts.quotes || 0} 条</div>
                </div>
                <div className="sh-stat">
                    <div className="sh-stat-label">机器评分</div>
                    <div className="sh-stat-value">{counts.scores || 0} 只</div>
                    <div className="sh-mini">板块月线 {counts.sectors || 0} 只</div>
                </div>
                {['quotes', 'fundamentals', 'global-assets', 'business'].map(type => <div className="sh-stat" key={type}>
                    <div className="sh-stat-label">{typeLabel[type]}最近成功</div>
                    <div className="sh-stat-value" style={{fontSize: 13}}>{lastSuccess[type] ? fmtTime(lastSuccess[type]) : '暂无记录'}</div>
                </div>)}
            </div>

            <Card size="small" title="手动触发采集" style={{marginTop: 12}}
                  extra={<PermActions actions={[{label: '全部采集', perm: 'sync:run', type: 'primary', icon: <SyncOutlined/>,
                      disabled: status?.running, onClick: () => this.run('all')}]}/>}>
                <Space wrap>
                    {['quotes', 'fundamentals', 'global-assets', 'business'].map(type => <Button key={type}
                        disabled={status?.running} onClick={() => this.run(type)}>
                        {typeLabel[type]}
                    </Button>)}
                </Space>
                <div className="sh-mini" style={{marginTop: 8}}>
                    「全部采集」会依次执行行情、基本面、全球资产与产业链商品；同一时间只允许一个采集任务运行。
                </div>
            </Card>

            <Card size="small" title="最近运行记录" style={{marginTop: 12}}>
                <Table size="small" rowKey="id" loading={this.state.loading} dataSource={logs} pagination={false}
                       locale={{emptyText: '暂无采集记录'}}
                       columns={[
                           {title: '类型', dataIndex: 'syncType', width: 110, render: v => typeLabel[v] || v},
                           {
                               title: '状态', dataIndex: 'status', width: 90,
                               render: v => <Tag color={statusColor(v)}>{v === 'success' ? '成功' : v === 'failed' ? '失败' : '运行中'}</Tag>,
                           },
                           {title: '触发', dataIndex: 'triggerType', width: 80, render: v => v === 'manual' ? '手动' : '定时'},
                           {title: '开始', dataIndex: 'startedAt', width: 170, render: v => fmtTime(v)},
                           {title: '耗时', dataIndex: 'durationMs', width: 90, render: v => fmtDuration(v)},
                           {title: '结果', dataIndex: 'message', render: v => <Text style={{fontSize: 12}}>{v || '—'}</Text>},
                       ]}/>
            </Card>
            <div className="sh-mini" style={{marginTop: 8}}>
                采集数据会写入 H2；缺失值保持 null，不做模拟填充。定时 cron 可在 application.yml 的 stock.sync 下调整。
            </div>
        </Page>;
    }
}
