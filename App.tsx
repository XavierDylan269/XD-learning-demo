import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { ChatApiError, streamChatCompletion } from './api'
import './App.css'
import 'highlight.js/styles/github-dark.css'
import type { FormEvent } from 'react'
import type { Message } from './types'

const STORAGE_KEY = 'ai-chat-assistant:messages'

function createMessage(role: Message['role'], content: string): Message {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    timestamp: Date.now(),
  }
}

function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== 'object') {
    return false
  }

  const message = value as Partial<Message>

  return (
    typeof message.id === 'string' &&
    (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string' &&
    typeof message.timestamp === 'number'
  )
}

function loadStoredMessages(): Message[] {
  try {
    const storedValue = localStorage.getItem(STORAGE_KEY)

    if (!storedValue) {
      return []
    }

    const parsedValue = JSON.parse(storedValue) as unknown

    return Array.isArray(parsedValue) ? parsedValue.filter(isMessage) : []
  } catch {
    return []
  }
}

function getFriendlyErrorMessage(error: unknown) {
  const message = error instanceof ChatApiError ? error.message : '发送失败，请稍后重试。'

  if (message.includes('VITE_ZHIPU_API_KEY')) {
    return '还没有配置智谱 AI API Key。请在项目根目录的 .env 文件中填写 VITE_ZHIPU_API_KEY，然后重启开发服务器。'
  }

  if (message.includes('401') || message.toLowerCase().includes('unauthorized')) {
    return 'API Key 校验失败，请确认 .env 中的 VITE_ZHIPU_API_KEY 是否正确。'
  }

  if (message.includes('429')) {
    return '请求过于频繁或额度不足，请稍后再试，或检查智谱 AI 账户额度。'
  }

  if (message.includes('404')) {
    return 'AI 接口地址或模型配置可能不正确，请检查 VITE_ZHIPU_API_BASE_URL 和 VITE_ZHIPU_MODEL。'
  }

  return message || 'AI 服务暂时不可用，请稍后重试。'
}

function App() {
  const [messages, setMessages] = useState<Message[]>(loadStoredMessages)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [copiedMessageId, setCopiedMessageId] = useState('')
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const canSend = useMemo(() => input.trim().length > 0 && !isLoading, [input, isLoading])
  const canClear = useMemo(() => messages.length > 0 && !isLoading, [messages.length, isLoading])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages))
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  function handleClearMessages() {
    setMessages([])
    setError('')
    setCopiedMessageId('')
    localStorage.removeItem(STORAGE_KEY)
  }

  async function handleCopyMessage(message: Message) {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopiedMessageId(message.id)
      window.setTimeout(() => setCopiedMessageId(''), 1600)
    } catch {
      setError('复制失败，请手动选择文本复制。')
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const content = input.trim()

    if (!content || isLoading) {
      return
    }

    const userMessage = createMessage('user', content)
    const assistantMessage = createMessage('assistant', '')
    const nextMessages = [...messages, userMessage, assistantMessage]

    setMessages(nextMessages)
    setInput('')
    setError('')
    setCopiedMessageId('')
    setIsLoading(true)

    try {
      await streamChatCompletion({
        messages: [...messages, userMessage].map(({ role, content }) => ({ role, content })),
        onUpdate: (assistantContent) => {
          setMessages((currentMessages) =>
            currentMessages.map((message) =>
              message.id === assistantMessage.id
                ? { ...message, content: assistantContent }
                : message,
            ),
          )
        },
      })
    } catch (unknownError) {
      const message = getFriendlyErrorMessage(unknownError)

      setError(message)
      setMessages((currentMessages) =>
        currentMessages.map((item) =>
          item.id === assistantMessage.id
            ? { ...item, content: `抱歉，${message}` }
            : item,
        ),
      )
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main className="chat-page">
      <section className="chat-shell" aria-label="AI 聊天助手">
        <header className="chat-header">
          <div>
            <p className="eyebrow">Zhipu AI Assistant</p>
            <h1>AI 聊天助手</h1>
          </div>
          <div className="header-actions">
            {isLoading && <span className="status">思考中...</span>}
            <button
              type="button"
              className="clear-button"
              disabled={!canClear}
              onClick={handleClearMessages}
            >
              清空对话
            </button>
          </div>
        </header>

        <div className="messages" aria-live="polite">
          {messages.length === 0 ? (
            <div className="empty-state">
              <h2>开始一次对话</h2>
              <p>输入你的问题，AI 会结合上下文进行多轮回答。</p>
            </div>
          ) : (
            messages.map((message) => (
              <article key={message.id} className={`message-row ${message.role}`}>
                <div className="avatar">{message.role === 'user' ? '我' : 'AI'}</div>
                <div className="message-card">
                  <div className="message-bubble">
                    {message.content ? (
                      message.role === 'assistant' ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                          {message.content}
                        </ReactMarkdown>
                      ) : (
                        message.content
                      )
                    ) : (
                      message.role === 'assistant' && isLoading ? '思考中...' : ''
                    )}
                  </div>
                  {message.role === 'assistant' && message.content && (
                    <button
                      type="button"
                      className="copy-button"
                      onClick={() => handleCopyMessage(message)}
                    >
                      {copiedMessageId === message.id ? '已复制' : '复制'}
                    </button>
                  )}
                </div>
              </article>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {error && <p className="error-message">{error}</p>}

        <form className="chat-form" onSubmit={handleSubmit}>
          <textarea
            value={input}
            disabled={isLoading}
            rows={1}
            placeholder={isLoading ? '思考中...' : '输入消息，按 Enter 发送'}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }}
          />
          <button type="submit" disabled={!canSend}>
            {isLoading ? '思考中...' : '发送'}
          </button>
        </form>
      </section>
    </main>
  )
}

export default App
