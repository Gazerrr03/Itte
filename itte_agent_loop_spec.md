# Itte Agent Loop Spec

## 2.1 系统总览

系统由两个主循环组成：

### Loop A：Conversation Loop
默认主循环。  
目标：理解用户、承接用户、推进对话。

### Loop B：Optimization Loop
用户主动触发。  
目标：帮助用户优化表达、理解表达逻辑、沉淀表达方式。

---

## 2.2 核心设计理念

### 核心原则
1. 默认不打断
2. 默认不强纠错
3. 优化是按需能力，不是默认惩罚
4. 用户的表达意图比语言正确性更重要
5. 任何优化输出后，都要回到对话主线

---

## 2.3 输入分类

系统接收用户输入后，先做分类。

### 类型 A：Command Input
用户输入 `/` 开头命令。  
进入命令分发器。

### 类型 B：Normal Conversation
普通自然语言输入。  
进入 Conversation Loop。

---

## 2.4 Conversation Loop 状态分类

对于普通输入，系统需要判断用户当前处于哪种状态：

### S1：Clear Expression
特点：
- 意思清楚
- 表达虽然不一定完美，但足够理解
- 对话可以直接继续

策略：
- 简述理解
- 继续话题
- 不主动展开优化

---

### S2：Understandable but Unnatural
特点：
- 意思可懂
- 但表达明显不自然或不标准
- 不影响继续聊

策略：
- 默认仍然继续聊
- 不自动进入显性纠错
- 用户主动触发 `/optimize` 时再展开

---

### S3：Ambiguous Meaning
特点：
- agent 无法确定用户真实意思
- 输入存在明显歧义或结构断裂

策略：
- 先做 clarification
- 只问最小必要澄清问题
- 对齐意思后回到对话主线

---

### S4：Expression Breakdown
特点：
- 用户明显不会表达
- 中英混杂严重
- 句子无法独立成形
- 用户在求助“怎么说”

策略：
- 拆分表达意图
- 搭建表达脚手架
- 给 1 个主版本，必要时 1 个更自然版本
- 最后继续聊

---

## 2.5 Optimization Loop

用户主动触发时进入。

### 触发原则
- 只由用户主动触发
- 不由系统高频自动触发
- 例外：输入严重影响理解时，系统仍可先做 clarification

---

## 2.6 命令系统

MVP 命令建议如下。

### `/optimize`
对当前输入做更自然表达优化。

输出结构：
1. I understand you mean...
2. A more natural way to say it is...
3. 可选 simpler version
4. 回到话题继续聊

---

### `/help`
当用户不知道怎么表达时使用。  
适合中英混杂输入。

输出结构：
1. identify the intended meaning
2. break it into small ideas
3. build one usable sentence
4. give one alternative
5. ask a follow-up question

---

### `/daily`
启动当天主动练习模式。  
使用 mock topic，发起 1 轮引导式对话。

---

### `/summary`
手动查看当前 session 的积累。

---

### `/end`
结束 session 并生成 session summary。

---

## 2.7 `/daily` 设计

### 目标
给用户一个“随开随用”的主动入口。  
不是课程，而是一轮带方向的真实表达练习。

### 输入源
MVP 用 mock data。

### 输出结构
一轮对话框架：

#### Round 1：进入场景
- 简短介绍话题
- 问一个低门槛问题

---

## 2.8 Session Summary 结构

默认包含四部分：

### Scene
今天主要练的场景

### Intent
今天主要练到的表达意图

### Useful Expressions
3 条可复用表达

### Try Next Time
下一次可以尝试主动说的一句话

---

## 2.9 Memory Spec

MVP 只保存两类记忆。

### A. Language Profile
字段示意：
- estimated_level
- common_breakdown_types
- preferred_sentence_complexity
- frequent_intents
- optimize_usage_pattern

### B. Preference Profile
字段示意：
- prefers_more_guidance
- prefers_short_feedback
- preferred_topics
- work_vs_life_ratio
- daily_mode_frequency

---

## 2.10 中文使用规则

### 默认禁止
普通对话与普通优化默认不用中文。

### 允许条件
仅以下情况允许：
- 用户主动要求中文解释
- 用户明确表示完全听不懂
- 需要进行深度理解辅助时

---

## 2.11 回复风格规则

### 默认风格
- 耐心
- 简洁
- 不批判
- 不像老师训人
- 以“接住”和“继续聊”为核心

### 禁止风格
- 频繁指出错误
- 冗长语法课
- 像考试批改
- 因小错而中断对话节奏

---

## 2.12 核心状态流转

```text
User Input
  ├── starts with "/" → Command Router
  │       ├── /optimize → Optimization Loop
  │       ├── /help     → Scaffolding Loop
  │       ├── /daily    → Daily One-shot Loop
  │       ├── /summary  → Session Summary
  │       └── /end      → End Session + Summary
  │
  └── normal text → Conversation Classifier
          ├── S1 Clear → Continue conversation
          ├── S2 Understandable → Continue conversation
          ├── S3 Ambiguous → Clarify
          └── S4 Breakdown → Scaffold
```

---

## 2.13 MVP 评估重点

实现后最先观察：

1. 用户会不会持续发言
2. `/optimize` 是否自然被使用
3. `/daily` 是否成为高频入口
4. session summary 是否真有“带走感”
5. agent 是否真的没有过度教学
