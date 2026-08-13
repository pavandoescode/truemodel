import type { StreamEnvelope, Usage } from '@/lib/types';

interface RawEvent {
  event: string;
  data: string;
}

/**
 * Incremental SSE parser that turns an Anthropic message stream into the
 * NDJSON envelopes consumed by the browser.
 */
export class SseAccumulator {
  private buffer = '';
  private currentEvent = '';
  private toolPartials = new Map<number, { id: string; name: string; json: string }>();

  text = '';
  usage: Usage | null = null;
  stopReason: string | null = null;
  eventCount = 0;

  feed(chunk: string): StreamEnvelope[] {
    this.buffer += chunk;
    const out: StreamEnvelope[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, '');
      this.buffer = this.buffer.slice(idx + 1);
      this.consumeLine(line, out);
    }
    return out;
  }

  /** Flush a trailing line that arrived without a newline. */
  finish(): StreamEnvelope[] {
    const out: StreamEnvelope[] = [];
    if (this.buffer.trim()) {
      this.consumeLine(this.buffer.replace(/\r$/, ''), out);
      this.buffer = '';
    }
    return out;
  }

  private consumeLine(line: string, out: StreamEnvelope[]) {
    if (!line.trim()) return;
    if (line.startsWith(':')) return;
    if (line.startsWith('event:')) {
      this.currentEvent = line.slice(6).trim();
      return;
    }
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let data: unknown;
    try {
      data = JSON.parse(payload);
    } catch {
      return;
    }
    this.eventCount += 1;
    const evt = (data as { type?: string }).type ?? this.currentEvent ?? 'message';
    out.push({ type: 'event', event: evt, data });
    this.interpret(evt, data as Record<string, unknown>, out);
  }

  private interpret(evt: string, data: Record<string, unknown>, out: StreamEnvelope[]) {
    if (evt === 'message_start') {
      const msg = data.message as { usage?: Usage } | undefined;
      if (msg?.usage) this.usage = { ...msg.usage };
      return;
    }
    if (evt === 'content_block_start') {
      const block = data.content_block as { type?: string; id?: string; name?: string } | undefined;
      if (block?.type === 'tool_use') {
        this.toolPartials.set(Number(data.index ?? 0), { id: block.id ?? '', name: block.name ?? '', json: '' });
      }
      return;
    }
    if (evt === 'content_block_delta') {
      const delta = data.delta as { type?: string; text?: string; partial_json?: string } | undefined;
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        this.text += delta.text;
        out.push({ type: 'delta', text: delta.text });
      } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        const entry = this.toolPartials.get(Number(data.index ?? 0));
        if (entry) entry.json += delta.partial_json;
      }
      return;
    }
    if (evt === 'content_block_stop') {
      const entry = this.toolPartials.get(Number(data.index ?? 0));
      if (entry) {
        let input: unknown = entry.json;
        try {
          input = entry.json ? JSON.parse(entry.json) : {};
        } catch {
          /* keep the raw partial JSON */
        }
        out.push({ type: 'toolUse', id: entry.id, name: entry.name, input });
        this.toolPartials.delete(Number(data.index ?? 0));
      }
      return;
    }
    if (evt === 'message_delta') {
      const delta = data.delta as { stop_reason?: string | null } | undefined;
      if (delta && 'stop_reason' in delta) this.stopReason = delta.stop_reason ?? null;
      const usage = data.usage as Usage | undefined;
      if (usage) this.usage = { ...(this.usage ?? { input_tokens: null, output_tokens: null }), ...usage };
      return;
    }
    if (evt === 'error') {
      const error = data.error as { message?: string } | undefined;
      out.push({
        type: 'event',
        event: 'provider_error',
        data: { message: error?.message ?? 'Provider sent an error event' },
      });
    }
  }
}

export function ndjson(envelope: StreamEnvelope): string {
  return `${JSON.stringify(envelope)}\n`;
}
