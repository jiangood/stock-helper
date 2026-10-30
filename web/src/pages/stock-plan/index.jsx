import React from 'react';
import {Form, Input, InputNumber, Switch} from 'antd';
import {PlusOutlined} from '@ant-design/icons';
import {FormModal, HttpClient, Page, PermActions, ProTable} from '@jiangood/open-admin';

export default class StockPlanPage extends React.Component {
    modalRef = React.createRef();
    tableRef = React.createRef();

    handleAdd = () => this.modalRef.current.open({});
    handleEdit = record => this.modalRef.current.open({...record});

    onFinish = async values => {
        const isNew = !values.id;
        const url = isNew ? 'admin/stock/create' : 'admin/stock/update';
        await HttpClient.post(url, values);
        this.tableRef.current?.reload();
    };

    handleDelete = record => {
        HttpClient.post('admin/stock/delete', {id: record.id}).then(() => this.tableRef.current?.reload());
    };

    columns = [
        {title: '代码', dataIndex: 'code', width: 110},
        {title: '名称', dataIndex: 'name', width: 110},
        {title: '别名', dataIndex: 'alias', width: 150, render: v => v || '—'},
        {title: '分组', dataIndex: 'groupName', width: 90},
        {title: '年初价', dataIndex: 'yearInit', width: 90, align: 'right'},
        {title: '入场', dataIndex: 'entry', width: 90, align: 'right'},
        {title: '重仓', dataIndex: 'heavy', width: 90, align: 'right'},
        {title: '止盈1', dataIndex: 'tp1', width: 90, align: 'right'},
        {title: '止盈2', dataIndex: 'tp2', width: 90, align: 'right'},
        {title: '昨日涨幅', dataIndex: 'prevChg', width: 90, align: 'right'},
        {title: '复核日期', dataIndex: 'updDate', width: 110},
        {title: '股票池', dataIndex: 'pool', width: 80, render: v => v ? '是' : '否'},
        {
            title: '操作', dataIndex: 'option', width: 120, fixed: 'right',
            render: (_, record) => <PermActions actions={[
                {label: '编辑', perm: 'stock:update', onClick: () => this.handleEdit(record)},
                {
                    label: '删除', perm: 'stock:delete', danger: true, confirm: `确定删除 ${record.name}？`,
                    onClick: () => this.handleDelete(record),
                },
            ]}/>,
        },
    ];

    render() {
        return <Page title="股票池与计划" description="维护股票基础资料、分组与入场 / 重仓 / 止盈计划；行情与评分由采集任务自动维护。">
            <ProTable
                actionRef={this.tableRef}
                request={params => HttpClient.get('admin/stock/page', params)}
                columns={this.columns}
                searchFormRender={() => <>
                    <Form.Item label="名称" name="name"><Input allowClear/></Form.Item>
                    <Form.Item label="分组" name="group"><Input allowClear/></Form.Item>
                </>}
                toolBarRightRender={() => <PermActions actions={[
                    {label: '新增标的', perm: 'stock:create', type: 'primary', icon: <PlusOutlined/>, onClick: this.handleAdd},
                ]}/>}
            />
            <FormModal ref={this.modalRef} title="股票池标的" width={680} onFinish={this.onFinish}>
                <Form.Item label="代码" name="code" rules={[{required: true, message: '请输入 6 位代码或 sh/sz 前缀'}]}>
                    <Input placeholder="sz002408 / 002408"/>
                </Form.Item>
                <Form.Item label="名称" name="name" rules={[{required: true}]}><Input/></Form.Item>
                <Form.Item label="别名" name="alias"><Input placeholder="多个别名用中文顿号分隔"/></Form.Item>
                <Form.Item label="分组" name="groupName"><Input placeholder="化工 / 有色 / 农业..."/></Form.Item>
                <Form.Item label="年初价" name="yearInit"><InputNumber style={{width: '100%'}} min={0} precision={4}/></Form.Item>
                <Form.Item label="计划入场价" name="entry"><InputNumber style={{width: '100%'}} min={0} precision={4}/></Form.Item>
                <Form.Item label="计划重仓价" name="heavy"><InputNumber style={{width: '100%'}} min={0} precision={4}/></Form.Item>
                <Form.Item label="止盈1" name="tp1"><InputNumber style={{width: '100%'}} min={0} precision={4}/></Form.Item>
                <Form.Item label="止盈2" name="tp2"><InputNumber style={{width: '100%'}} min={0} precision={4}/></Form.Item>
                <Form.Item label="昨日涨幅(%)" name="prevChg"><InputNumber style={{width: '100%'}} precision={2}/></Form.Item>
                <Form.Item label="计划复核日期" name="updDate"><Input placeholder="YYYY-MM-DD"/></Form.Item>
                <Form.Item label="纳入股票池" name="pool" valuePropName="checked"><Switch/></Form.Item>
            </FormModal>
        </Page>;
    }
}
