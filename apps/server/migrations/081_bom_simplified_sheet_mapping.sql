-- 导入改按业务方简化清单样表（序号/产品名称/产品型号/尺寸规格(mm)/数量/单价/总价/ERP编码），旧映射生成的预览不能再提交
ALTER TABLE bom_imports ALTER COLUMN mapping_revision SET DEFAULT 6;
