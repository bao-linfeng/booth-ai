# LiveHelperChat、Zoho SalesIQ、网易七鱼海外版对比

> 更新时间：2026-09-23  
> 适用项目：灵通 AI 展台方案平台  
> 核心场景：国内中文客服服务全球客户，需要网页实时聊天、双向翻译、海外访问稳定，并考虑后续与询价、CRM、订单系统打通。

---

## 1. 三者定位

| 方案 | 产品形态 | 核心定位 | 更适合的企业 |
|---|---|---|---|
| **LiveHelperChat** | 开源 / 自托管 | 自己掌控客服系统、数据和二次开发能力 | 有技术团队，希望长期自建客服中台 |
| **Zoho SalesIQ** | 国际 SaaS | 全球在线客服 + 实时翻译 + 访客追踪 + CRM/自动化 | 希望快速上线国际客服，又不想自己运维 |
| **网易七鱼海外版** | 国内厂商 SaaS | 面向中国客服团队的出海客服方案 | 国内客服团队为主，希望中文后台和厂商服务 |

---

# 2. 核心能力对比

| 对比项 | LiveHelperChat | Zoho SalesIQ | 网易七鱼海外版 |
|---|---|---|---|
| 部署方式 | 自建服务器 / Docker | SaaS | SaaS |
| 软件授权 | 开源免费，Apache-2.0 | 按套餐 / 坐席收费 | 商务询价 |
| 数据掌控 | **完全自持** | Zoho 云 | 网易七鱼云 |
| 中文客服后台 | 支持多语言，可本地化 | **支持简体中文** | **原生中文体验最好** |
| 网页实时聊天 | ✅ | ✅ | ✅ |
| 双向实时翻译 | ✅ 支持自动翻译 | ✅ 原生支持 | ✅ 海外版重点能力 |
| 翻译引擎 | 可自行集成第三方翻译服务 | Zoho Translate / Google / Azure / DeepL 等 | 以七鱼海外版能力为主，需商务确认具体引擎 |
| 翻译语言 | 取决于所接翻译服务 | 官方当前列出约 75 种消息翻译语言 | 宣传资料称支持多语言，正式数量建议商务书面确认 |
| 海外访问能力 | 取决于自己服务器、CDN、节点 | 国际 SaaS，多区域服务能力 | 海外版面向跨境场景，节点/SLA需正式确认 |
| 国内客服访问 | 取决于部署位置 | 中国区可用，支持中国服务体系 | **强** |
| API | **非常开放** | 完整 REST / JS API | 有开放接口，具体能力和权限需按版本确认 |
| Webhook | **可自由扩展** | 高级 Webhook 能力受套餐限制 | 需按采购版本确认 |
| 自定义字段 | ✅ | ✅ | ✅ |
| 将方案 ID / 询价 ID 带入客服 | ✅ 可深度定制 | ✅ JS API / Visitor Info | ✅ 可通过开放接口/客户信息集成实现 |
| CRM 集成 | 自己开发 | **Zoho CRM 原生集成，兼容多种第三方应用** | 可与 CRM / 工单 / 订单系统集成 |
| AI Bot | ✅ 可接任意第三方 AI | ✅ Zobot / AI Agent / BYOAI | ✅ 智能机器人 / 智能辅助 |
| WhatsApp 等海外渠道 | ✅ 可扩展 | ✅ 支持多渠道 | ✅ 海外版支持多渠道接入 |
| 运维成本 | **最高** | 很低 | 很低 |
| 二次开发自由度 | **最高** | 中高 | 中 |
| 上线速度 | 数天～数周 | **最快，通常几小时～几天** | 快，依赖商务开通与配置 |
| 厂商锁定 | **低** | 中 | 中高 |
| 长期做客服中台 | **非常合适** | 合适 | 合适，但受厂商能力限制 |

---

# 3. LiveHelperChat

## 3.1 产品简介

LiveHelperChat 是一套长期维护的开源在线客服系统。

它不是简单的聊天组件，而是一整套客服平台，包含：

- 网站聊天 Widget
- 客服工作台
- 多客服 / 部门
- 自动分配
- 排队
- 历史会话
- Bot
- REST API
- Webhook / Hooks
- 第三方 AI
- WhatsApp / Messenger / Instagram 等渠道扩展
- Voice / Video / ScreenShare
- Docker
- S3
- Elasticsearch

官方 GitHub 显示其采用 **Apache-2.0** 开源许可证，并持续维护。

### 官网

- 官网：https://livehelperchat.com/
- GitHub：https://github.com/LiveHelperChat/livehelperchat
- 官方文档：https://doc.livehelperchat.com/
- REST API 文档：https://doc.livehelperchat.com/docs/development/rest-api

---

## 3.2 双向翻译

LiveHelperChat 提供聊天自动翻译能力。

典型流程：

```text
德国客户
   ↓ 德语
LiveHelperChat
   ↓ 自动翻译
中国客服看到中文

中国客服输入中文
   ↓
LiveHelperChat 自动翻译
   ↓
德国客户看到德语
```

后台聊天工具栏提供 **Auto translate** 功能，也有专门的 Translation 权限和翻译模块。

由于它是自托管系统，翻译能力的最终效果和成本主要取决于你接入的翻译服务。

可以考虑：

- DeepL
- Google Cloud Translation
- Azure AI Translator
- 自建 Translation Gateway
- Gemini / GPT 等大模型作为补充

---

## 3.3 最大优势：数据完全自己掌控

LiveHelperChat 官方的核心理念之一就是：

> Your server, your data.

也就是：

```text
客户
 ↓
LiveHelperChat
 ↓
自己的服务器
 ↓
自己的数据库
 ↓
Fastify
 ↓
PostgreSQL
 ↓
询价 / CRM / 客户画像 / 订单
```

对于灵通 AI 展台平台，后续可以直接把：

- 用户 ID
- 方案 ID
- 询价 ID
- 国家
- 展位尺寸
- 开口数量
- 预算
- 效果图地址
- 客户语言
- 聊天记录

全部沉淀到自己的业务系统里。

---

## 3.4 最大缺点：运维全部自己负责

选择 LiveHelperChat 后，需要自己承担：

- 服务器
- Docker
- Nginx
- HTTPS
- 数据库
- 备份
- 日志
- 监控
- 安全
- 升级
- CDN
- 海外节点
- 翻译 API
- 故障恢复

因此它虽然软件授权免费，但并不是零成本。

对于全球客户场景，更合理的部署通常是：

```text
海外云服务器
     +
Cloudflare / CDN
     +
LiveHelperChat
     +
数据库
     +
备份
     +
Translation API
```

而不是单纯部署到中国大陆服务器。

---

## 3.5 适合灵通的方式

不建议直接魔改 LiveHelperChat 内核。

建议将其作为独立服务：

```text
灵通 AI 展台平台
    │
    ├── Vue3
    ├── Fastify
    ├── PostgreSQL
    │
    └──── REST API / Webhook
                 │
                 ↓
         LiveHelperChat
                 │
                 ↓
        Translation Gateway
                 │
       ┌─────────┼─────────┐
       ↓         ↓         ↓
     DeepL     Azure     Google
```

### 适合程度

**最适合：**
- 想长期打造自己的客服中台
- 数据必须掌握在自己手里
- 后面需要大量二次开发
- 客服、询价、CRM、订单要深度融合

**不太适合：**
- 一期需要非常快速上线
- 不想维护服务器
- 没有专人负责系统运维

---

# 4. Zoho SalesIQ

## 4.1 产品简介

Zoho SalesIQ 是 Zoho 的在线客户互动与客服 SaaS。

除了聊天，还包含：

- 实时在线客服
- 网站访客追踪
- 客户行为分析
- 自动触发消息
- 客户分流
- Zobot
- AI Agent
- CRM 集成
- 移动 SDK
- 多渠道客服
- 多语言翻译
- 报表和客服监控

### 官网

- 中国官网：https://www.zoho.com.cn/salesiq/
- 国际官网：https://www.zoho.com/salesiq/
- 中国帮助中心：https://help.zoho.com.cn/portal/zh/kb/salesiq-2-0
- 国际帮助中心：https://help.zoho.com/portal/en/kb/salesiq-2-0
- 价格：https://www.zoho.com.cn/salesiq/pricing.html
- 翻译说明：https://help.zoho.com/portal/en/kb/salesiq-2-0/for-administrators/translation/articles/translation

---

## 4.2 实时双向翻译

这是 Zoho SalesIQ 对灵通项目最重要的功能之一。

典型流程：

```text
德国客户：
Wir benötigen einen 6x6 Meter Messestand.

          ↓

中国客服：
我们需要一个 6 × 6 米的展台。

中国客服回复：
请问需要双层结构吗？

          ↓

德国客户：
看到自动翻译后的德语
```

Zoho 官方当前资料显示：

- 支持实时聊天翻译
- 客户消息可翻译为客服熟悉的语言
- 客服回复可翻译回客户语言
- 官方规格页当前列出约 **75 种消息翻译语言**

覆盖：

- 中文
- 英文
- 德文
- 法文
- 俄文
- 日文
- 西班牙文
- 意大利文
- 葡萄牙文
- 阿拉伯文
- 马来文
- 韩文
- 等

---

## 4.3 翻译引擎

SalesIQ 当前支持或集成：

- Zoho Translate
- Google Translate
- Azure AI Translator
- DeepL Translate

对于欧洲客户较多的展览业务，DeepL 值得重点测试。

例如需要专门测试：

```text
island booth
peninsula booth
fascia
lightbox
truss
double-deck booth
storage room
reception counter
```

不能只测试“你好 / Hello”这种简单句子。

---

## 4.4 中文客服体验

SalesIQ Operator Portal 官方支持 **Chinese (Simplified)**。

因此可以实现：

```text
国外客户
    ↓
英文 / 德文 / 法文 / 日文 / 俄文
    ↓
SalesIQ
    ↓
自动翻译
    ↓
中文客服后台
```

这是它相较很多国际客服 SaaS 的重要优势。

---

## 4.5 与灵通平台集成

SalesIQ 可以通过网页嵌入代码直接加入 Vue3 项目。

基本架构：

```text
Vue3
 ↓
SalesIQ Widget
 ↓
Zoho Cloud
 ↓
客服工作台
```

还可以通过 Visitor Info、JS API 等方式把业务上下文一起传进去。

例如：

```text
客户 ID
方案 ID
询价 ID
国家
语言
6m × 6m
三面开口
预算 €25,000
效果图 URL
```

这样客户点击“申请报价”后，客服无需重新询问背景信息。

---

## 4.6 最大优势

### 1. 上线快

无需自己维护：

- WebSocket
- 聊天服务器
- 客服后台
- 数据库
- 全球基础设施
- 系统升级

### 2. 全球化能力成熟

比单纯国内客服系统更偏全球 SaaS。

### 3. 中文后台

常州客服人员使用门槛低。

### 4. 双向翻译成熟

非常符合“中国客服服务海外客户”的核心需求。

### 5. CRM / 访客行为能力更强

SalesIQ 不只是客服软件，也偏向销售线索和客户转化。

---

## 4.7 缺点

- 数据托管在 Zoho 体系
- 高级 API / Webhook / 自动化可能受套餐限制
- 深度定制不如自建
- 长期使用存在厂商锁定
- 中国区和海外数据中心功能可能存在差异，需要在正式采购前确认
- 翻译质量仍需要用真实展览行业术语进行 PoC

---

## 4.8 适合灵通的场景

### 非常适合

- 一期快速上线
- 3～10 人左右客服团队
- 国内客服服务全球客户
- 不想自己运维客服基础设施
- 希望与 CRM、客户信息、询价逐步打通

### 推荐测试版本

优先测试：

**Professional**

重点测试：

- 实时双向翻译
- DeepL
- 中文后台
- 客户信息传递
- 方案 ID / 询价 ID
- API
- Webhook
- 中国客服访问
- 欧洲 / 美国 / 日本客户访问

---

# 5. 网易七鱼海外版

## 5.1 产品定位

网易七鱼是网易旗下企业智能客服产品。

海外版更适合：

> 中国客服团队服务全球客户

其优势不是单纯“国际 SaaS”，而是更贴近国内企业客服团队的工作习惯。

### 官网

- 网易七鱼入口：https://qiyukf.com/
- 当前该入口会跳转到网易企业服务相关的智能客服产品页面。

---

## 5.2 客服体验

网易七鱼最大的天然优势是：

**中文后台和国内客服工作习惯。**

典型功能包括：

- 待接入
- 正在咨询
- 历史会话
- 客户资料
- 工单
- 快捷回复
- 知识库
- 转接
- 坐席
- 报表
- AI 客服
- 多渠道客服

对于常州客服团队，培训和上手成本通常会比纯海外 SaaS 更低。

---

## 5.3 海外版重点能力

用户现有选型资料中，网易七鱼海外版的重点包括：

- 海外客服
- 实时双向翻译
- 海外渠道
- 中文客服后台
- 多语言机器人
- 工单翻译
- GDPR / CCPA 等国际化能力

典型场景：

```text
德国客户
 ↓ 德文
七鱼海外版
 ↓ 自动翻译
中国客服看到中文

中国客服
 ↓ 中文回复
七鱼
 ↓ 自动翻译
德国客户看到德文
```

---

## 5.4 最大优势

### 1. 最贴合中国客服团队

员工几乎没有学习英文后台的成本。

### 2. 国内厂商商务支持

采购、实施、培训、售后沟通方便。

### 3. 海外版针对出海场景

不像普通国内客服产品简单增加一个英文 Widget。

### 4. 与国内业务系统衔接更自然

后续可以结合：

```text
AI 展台方案
 ↓
申请报价
 ↓
在线客服
 ↓
询价
 ↓
CRM
 ↓
订单
```

---

## 5.5 需要重点核实的地方

与 Zoho 和 LiveHelperChat 相比，网易七鱼海外版的公开技术资料相对少。

因此以下指标不建议仅根据宣传材料直接写入正式采购结论：

- 海外节点具体位置
- 全球消息延迟 SLA
- “<200ms”等延迟指标
- 实时翻译支持的确切语言数量
- 使用什么翻译引擎
- 海外数据实际存储区域
- GDPR DPA
- CCPA
- WhatsApp / LINE / Facebook 等渠道具体支持范围
- API 调用限制
- Webhook 能力
- 海外版套餐价格

建议让商务在 PoC / 采购阶段以书面方式确认。

---

## 5.6 适合灵通的场景

### 非常适合

- 客服团队全部在中国
- 非技术客服人员较多
- 希望有国内厂商培训和售后
- 需要中文管理后台
- 希望快速上线海外客服

### 最大的不确定性

不是功能是否存在，而是：

**海外节点、翻译质量、开放 API、价格和数据合规需要经过真实 PoC 和商务确认。**

---

# 6. 三种路线本质区别

可以把三个方案理解成三种完全不同的路线。

## 路线 A：LiveHelperChat

```text
我要自己掌握系统
      ↓
自己部署
      ↓
自己管理数据
      ↓
自己接翻译
      ↓
自己接 CRM / 询价 / AI
```

特点：

**自由度最高，长期成本可控，但技术和运维责任最大。**

---

## 路线 B：Zoho SalesIQ

```text
我要快速做全球客服
      ↓
成熟 SaaS
      ↓
中文后台
      ↓
实时翻译
      ↓
API / CRM
```

特点：

**全球化、成熟度、上线速度之间比较均衡。**

---

## 路线 C：网易七鱼海外版

```text
我的客服团队在中国
      ↓
希望中文操作
      ↓
国内厂商服务
      ↓
同时服务国外客户
```

特点：

**最贴近中国客服团队，但海外能力需要通过正式 PoC 进一步确认。**

---

# 7. 按灵通 AI 展台平台场景比较

| 场景 | LiveHelperChat | Zoho SalesIQ | 网易七鱼海外版 |
|---|---:|---:|---:|
| 一期快速上线 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 中文客服体验 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 全球客户服务 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 双向翻译 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 海外基础设施免运维 | ⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 数据完全自持 | ⭐⭐⭐⭐⭐ | ⭐ | ⭐ |
| API / 二次开发 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| 询价系统深度融合 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| CRM 能力 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| AI 扩展 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 厂商技术支持 | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 长期客服中台 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 运维难度 | 高 | 低 | 低 |

> 注：星级仅用于表达“对灵通当前场景的适配程度”，不是产品通用排名。

---

# 8. 灵通项目建议

## 一期优先 PoC

建议实际测试：

### 方案 1：Zoho SalesIQ Professional

重点验证：

- 中文客服后台
- 中英双向翻译
- 中德双向翻译
- 中法双向翻译
- 中日双向翻译
- 中俄双向翻译
- 中西双向翻译
- 中阿双向翻译
- DeepL 翻译
- Vue3 Widget
- 方案 ID 传递
- 询价 ID 传递
- 客户信息传递
- API
- 中国客服访问速度
- 欧洲 / 美国 / 日本客户访问速度

---

### 方案 2：网易七鱼海外版

让七鱼商务提供 Demo / Trial。

重点验证：

- 常州客服后台体验
- 德国 / 美国 / 日本测试访问
- 自动双向翻译
- 展览专业术语翻译
- API
- Webhook
- CRM 集成
- 海外节点
- GDPR / 数据存储
- WhatsApp / LINE / Facebook
- 正式报价

---

### 方案 3：LiveHelperChat

可以由技术团队用 Docker 单独搭建一套测试环境。

重点验证：

- 海外节点部署
- Cloudflare
- 聊天稳定性
- 自动翻译
- Translation API
- REST API
- Webhook / Hook
- Fastify 集成
- PostgreSQL / CRM 数据同步

---

# 9. 建议使用同一组 PoC 测试数据

不要只测试：

```text
Hello
你好
```

建议直接测试真实业务：

```text
我们需要一个 6m × 6m 的三面开展台，
包含一个储藏室、一块 LED 大屏、两个接待台和发光灯箱。

展位限高 4.5m，
请按照德国展会的搭建规范调整方案。

预算约 25,000 欧元，
请告诉我这个方案是否包含运输和现场搭建费用。
```

分别测试：

- 英语
- 德语
- 法语
- 俄语
- 日语
- 西班牙语
- 阿拉伯语

并重点观察：

1. 翻译准确度
2. 专业术语
3. 翻译延迟
4. 客服是否能看到原文
5. 客户是否能看到译文
6. 消息顺序是否正确
7. 图片 / 文件是否正常
8. 网络异常后的恢复能力

---

# 10. 当前建议

如果目标是 **一期尽快上线**：

```text
Zoho SalesIQ
      VS
网易七鱼海外版
```

做真实 PoC 后再定。

如果公司明确希望：

```text
数据自己掌握
+
以后做客服中台
+
深度接 CRM / 询价 / 订单
+
大量 AI 二次开发
```

则：

```text
LiveHelperChat
```

值得作为长期方案重点评估。

对于当前阶段，不建议从零自研完整客服系统。

---

# 11. 官方网址汇总

## LiveHelperChat

- 官网：https://livehelperchat.com/
- GitHub：https://github.com/LiveHelperChat/livehelperchat
- 文档：https://doc.livehelperchat.com/
- REST API：https://doc.livehelperchat.com/docs/development/rest-api
- Chat 文档：https://doc.livehelperchat.com/docs/chat

## Zoho SalesIQ

- 中国官网：https://www.zoho.com.cn/salesiq/
- 国际官网：https://www.zoho.com/salesiq/
- 中国帮助中心：https://help.zoho.com.cn/portal/zh/kb/salesiq-2-0
- 国际帮助中心：https://help.zoho.com/portal/en/kb/salesiq-2-0
- 中国价格页：https://www.zoho.com.cn/salesiq/pricing.html
- 翻译文档：https://help.zoho.com/portal/en/kb/salesiq-2-0/for-administrators/translation/articles/translation
- DeepL 集成：https://help.zoho.com/portal/en/kb/salesiq-2-0/integration-guides/translation/articles/integrating-deepl-translate-with-salesiq
- 支持语言：https://help.zoho.com/portal/en/kb/salesiq-2-0/for-administrators/specifications-and-limitations/articles/specifications-and-limitations-zoho-salesiq

## 网易七鱼

- 官方入口：https://qiyukf.com/

> 说明：七鱼官网目前会跳转网易企业服务相关页面。海外版的详细节点、翻译语言数量、SLA、数据区域及价格公开资料有限，正式采购前建议由网易七鱼商务书面确认。

---

# 12. 资料来源说明

本文信息整理自：

1. LiveHelperChat 官方网站、官方文档及 GitHub。
2. Zoho SalesIQ 中国官网、国际官网和官方帮助文档。
3. 《在线客服方案选型对比分析》中关于网易七鱼海外版的现有调研信息。
4. 截至 2026-09-23 可查询的公开资料。

对于 SaaS 套餐、海外节点、翻译语言数量、API 限制、数据区域和报价等可能调整的项目，正式采购时应以厂商最新合同、SLA、DPA 和商务书面说明为准。
