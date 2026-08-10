export type MessageRole = 'user' | 'assistant'

export interface Message {
  id: string
  role: MessageRole
  content: string
  timestamp: number
}

export type ChatCompletionMessage = Pick<Message, 'role' | 'content'>
