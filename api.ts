import type { ChatCompletionMessage } from './types'

const ZHIPU_API_BASE_URL = import.meta.env.VITE_ZHIPU_API_BASE_URL ?? 'https://open.bigmodel.cn/api/paas/v4'
const ZHIPU_API_KEY = import.meta.env.VITE_ZHIPU_API_KEY
const ZHIPU_MODEL = import.meta.env.VITE_ZHIPU_MODEL ?? 'glm-4-flash'

interface ZhipuStreamDelta {
  content?: string
}

interface ZhipuStreamChoice {
  delta?: ZhipuStreamDelta
  finish_reason?: string | null
}

interface ZhipuStreamChunk {
  choices?: ZhipuStreamChoice[]
  error?: {
    code?: string
    message?: string
  }
}

interface StreamChatOptions {
  messages: ChatCompletionMessage[]
  signal?: AbortSignal
  onUpdate: (content: string) => void
}

export class ChatApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChatApiError'
  }
}

function extractErrorMessage(errorText: string) {
  if (!errorText) {
    return ''
  }

  try {
    const parsedValue = JSON.parse(errorText) as {
      error?: { message?: string; code?: string }
      message?: string
    }

    return parsedValue.error?.message || parsedValue.message || errorText
  } catch {
    return errorText
  }
}

function assertApiKey() {
  if (!ZHIPU_API_KEY) {
    throw new ChatApiError('请先配置 VITE_ZHIPU_API_KEY 环境变量。')
  }
}

function parseStreamLine(line: string): ZhipuStreamChunk | null {
  const trimmedLine = line.trim()

  if (!trimmedLine || !trimmedLine.startsWith('data:')) {
    return null
  }

  const data = trimmedLine.replace(/^data:\s*/, '')

  if (data === '[DONE]') {
    return null
  }

  try {
    return JSON.parse(data) as ZhipuStreamChunk
  } catch {
    return null
  }
}

export async function streamChatCompletion({ messages, signal, onUpdate }: StreamChatOptions) {
  assertApiKey()

  const response = await fetch(`${ZHIPU_API_BASE_URL}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${ZHIPU_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: ZHIPU_MODEL,
      messages,
      stream: true,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    const errorMessage = extractErrorMessage(errorText)
    throw new ChatApiError(errorMessage || `请求失败，请稍后重试。状态码：${response.status}`)
  }

  if (!response.body) {
    throw new ChatApiError('浏览器不支持流式响应，请更换现代浏览器后重试。')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let fullContent = ''

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const chunk = parseStreamLine(line)

        if (!chunk) {
          continue
        }

        if (chunk.error?.message) {
          throw new ChatApiError(chunk.error.message)
        }

        const content = chunk.choices?.[0]?.delta?.content

        if (content) {
          fullContent += content
          onUpdate(fullContent)
        }
      }
    }

    const finalChunk = parseStreamLine(buffer)
    const finalContent = finalChunk?.choices?.[0]?.delta?.content

    if (finalContent) {
      fullContent += finalContent
      onUpdate(fullContent)
    }

    return fullContent
  } catch (error) {
    if (error instanceof ChatApiError) {
      throw error
    }

    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ChatApiError('请求已取消。')
    }

    throw new ChatApiError('AI 服务暂时不可用，请稍后重试。')
  } finally {
    reader.releaseLock()
  }
}
