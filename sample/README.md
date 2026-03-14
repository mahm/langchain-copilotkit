# langchain-copilotkit Sample App

LangChain (LangGraph) と CopilotKit を統合したチャット UI のサンプルアプリケーションです。`langchain-copilotkit` アダプターを使い、LangGraph エージェントを CopilotKit のランタイムに接続します。

## 構成

- **Next.js 16** + React 19 + Tailwind CSS 4
- **CopilotKit** - チャット UI とランタイム
- **LangGraph** - エージェントのオーケストレーション
- **deepagents** - LangGraph エージェントの構築ヘルパー

## セットアップ

### 前提条件

- [bun](https://bun.sh/) がインストールされていること
- Anthropic API キーまたは OpenAI API キー

### 手順

1. リポジトリルートで依存関係をインストール(monorepo のため、ルートから実行):

```bash
bun install
```

2. 環境変数を設定:

```bash
cp .env.sample .env.local
```

`.env.local` を編集し、使用する LLM プロバイダーの API キーを設定:

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

## 起動方法

```bash
bun dev
```

ブラウザで http://localhost:3000 を開くとチャット UI が表示されます。
