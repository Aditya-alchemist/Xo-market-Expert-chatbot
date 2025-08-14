import { Client, GatewayIntentBits, Message, EmbedBuilder } from 'discord.js';

export interface DiscordBotConfig {
  token: string;
  clientId: string;
  prefix?: string;
}

export class DiscordClient {
  private client: Client;
  private config: DiscordBotConfig;

  constructor(config: DiscordBotConfig) {
    this.config = config;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions,
      ],
    });
  }

  getClient(): Client {
    return this.client;
  }

  async login(): Promise<void> {
    await this.client.login(this.config.token);
  }

  createEmbed(title: string, description: string, color?: number): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(color || 0x0099FF)
      .setTimestamp()
      .setFooter({ text: 'XO Market Expert' });
  }

  private isSendableChannel(channel: any): channel is { send(content: any): Promise<any> } {
    return channel && typeof channel.send === 'function';
  }

  async sendLongMessage(message: Message, content: string, maxLength: number = 2000): Promise<void> {
    if (content.length <= maxLength) {
      await message.reply(content);
      return;
    }

    const chunks = this.splitMessage(content, maxLength);
    for (let i = 0; i < chunks.length; i++) {
      if (i === 0) {
        await message.reply(chunks[i]);
      } else {
        if (this.isSendableChannel(message.channel)) {
          await message.channel.send(chunks[i]);
        } else {
          console.warn('Channel does not support send(), attempting reply fallback');
          try {
            await message.reply(chunks[i]);
          } catch (error) {
            console.error('Failed to send message chunk:', error);
            break; // Stop trying to send more chunks
          }
        }
      }
    }
  }

  private splitMessage(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let currentChunk = '';

    const lines = text.split('\n');
    for (const line of lines) {
      if (currentChunk.length + line.length + 1 > maxLength) {
        if (currentChunk) chunks.push(currentChunk);
        currentChunk = line;
      } else {
        currentChunk += (currentChunk ? '\n' : '') + line;
      }
    }

    if (currentChunk) chunks.push(currentChunk);
    return chunks;
  }

  formatChatResponse(answer: string, sources: string[], citations: { [key: number]: string }): string {
    let response = answer;

    if (Object.keys(citations).length > 0) {
      response += '\n\n**📚 Sources:**\n';
      Object.entries(citations).forEach(([num, source]) => {
        response += `[${num}] ${source}\n`;
      });
    }

    return response;
  }

  truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }
}
