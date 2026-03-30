# Itte CLI 交互稿

## 3.1 CLI 启动

### 启动命令
```bash
itte
```

### 启动欢迎语示意
```text
Itte started.

You can just talk to me in English.
If you want help, use commands like:

/optimize
/help
/daily
/summary
/end
```

---

## 3.2 基础交互

## 情况 A：用户正常说，意思清楚

### 输入
```text
> I think people are too nervous about AI sometimes
```

### 输出
```text
I understand what you mean — you think people can be overly nervous about AI sometimes.
Why do you think that happens?
```

特点：
- 接住
- 不强纠错
- 继续话题

---

## 情况 B：表达不自然，但能懂

### 输入
```text
> Yesterday I very busy and no have time to finish it
```

### 默认输出
```text
I understand — you were very busy yesterday and couldn’t finish it.
What were you trying to finish?
```

这里不自动教学化展开。

---

## 情况 C：用户主动优化

### 输入
```text
> /optimize Yesterday I very busy and no have time to finish it
```

### 输出
```text
I understand you mean that you were very busy yesterday and couldn’t finish it.

A more natural way to say it is:
"I was very busy yesterday and didn’t have time to finish it."

A simpler version:
"I was really busy yesterday, so I couldn’t finish it."

What were you trying to finish?
```

---

## 情况 D：用户不会表达

### 输入
```text
> /help 我想表达“虽然我知道它有好处，但我还是有点不安”
```

### 输出
```text
You want to express two ideas:

1. You know it has benefits.
2. But you still feel a little uneasy.

You can say:

"I know it has some benefits, but I still feel a little uneasy about it."

Another natural version is:

"I know it can be helpful, but I still feel a bit uneasy about it."

What exactly makes you feel uneasy about it?
```

---

## 3.3 `/daily` 交互稿

### 输入
```text
> /daily
```

### 输出示意
```text
Today’s topic: AI assistants in daily work.

Round 1:
Some people use AI tools every day to save time, while others worry that this makes people think less.

What about you — do AI tools usually make your work easier, or do they sometimes make things more confusing?
```

`/daily` 在 MVP 中只发起一轮引导问题，不进入第二轮和第三轮。

---

## 3.4 `/summary` 交互稿

### 输入
```text
> /summary
```

### 输出示意
```text
Session Summary

Scene:
News discussion / work-related opinion

Intent:
- expressing concern
- explaining reasons
- comparing two views

Useful Expressions:
- I still feel a little uneasy about it.
- It makes things easier, but it can also be confusing.
- In my experience, the biggest issue is ...

Try Next Time:
Try saying:
"I can see the benefits, but I’m still not completely comfortable with it."
```

---

## 3.5 `/end` 交互稿

### 输入
```text
> /end
```

### 输出示意
```text
Session ended.

Session Summary

Scene:
Work / opinion sharing

Intent:
- expressing worry
- giving reasons
- talking about experience

Useful Expressions:
- I didn’t have time to finish it.
- I know it has benefits, but ...
- What worries me most is ...

Try Next Time:
Try saying:
"I understand why people like it, but I still have some concerns."
```

---

## 3.6 命令清单建议

```text
/optimize [text]   -> 优化表达
/help [text]       -> 帮你一步步搭表达
/daily             -> 开始今日 1 轮对话
/summary           -> 查看本次 session 积累
/end               -> 结束并生成总结
```

---

## 3.7 CLI 内部数据结构建议

这个部分更偏实现，可以直接给 coder 看。

### session_state
```json
{
  "session_id": "uuid",
  "started_at": "timestamp",
  "current_scene": "news_discussion",
  "current_intents": ["express_opinion", "explain_reason"],
  "messages": [],
  "useful_expressions": [],
  "user_requested_optimization_count": 0
}
```

### user_profile
```json
{
  "estimated_level": "A2-B1",
  "common_breakdown_types": [
    "tense inconsistency",
    "missing linking structure",
    "direct translation from Chinese"
  ],
  "preferred_topics": [
    "AI",
    "product work",
    "daily opinions"
  ],
  "prefers_short_feedback": true,
  "prefers_more_guidance": true
}
```

### daily_topic_mock
```json
{
  "topic_id": "ai_daily_001",
  "scene": "news_discussion",
  "title": "AI assistants in daily work",
  "round": {
    "step": 1,
    "prompt": "Do AI tools usually make your work easier, or more confusing?"
  }
}
```
