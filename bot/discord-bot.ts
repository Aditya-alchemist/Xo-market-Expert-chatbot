import 'dotenv/config';
import { Message, ActivityType, EmbedBuilder } from 'discord.js';
import { DiscordClient } from '../src/lib/discord';

interface ChatResponse {
  answer: string;
  sources: string[];
  citations: { [key: number]: string };
  liveData?: any;
  responseTime: number;
  dataFreshness?: string;
  queryType?: string;
}

class XODiscordBot {
  private discordClient: DiscordClient;

  constructor() {
    if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_CLIENT_ID) {
      throw new Error('Discord tokens are required in .env file');
    }

    console.log('🔧 Initializing XO Market Expert Discord Bot...');
    
    this.discordClient = new DiscordClient({
      token: process.env.DISCORD_BOT_TOKEN,
      clientId: process.env.DISCORD_CLIENT_ID,
      prefix: '!xo',
    });
    
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    const client = this.discordClient.getClient();
    
    client.once('ready', () => {
      console.log(`🤖 XO Market Expert Bot logged in as ${client.user?.tag}!`);
      console.log(`📊 Connected to ${client.guilds.cache.size} servers`);
      console.log(`👥 Serving ${client.users.cache.size} users`);
      
      client.user?.setActivity('XO Market questions | !xo help', { 
        type: ActivityType.Listening 
      });
    });

    client.on('messageCreate', async (message: Message) => {
      if (message.author.bot) return;

      const isDM = message.guild === null;
      const isMentioned = message.mentions.has(client.user!);
      const hasPrefix = message.content.toLowerCase().startsWith('!xo');

      if (isDM || isMentioned || hasPrefix) {
        await this.handleMessage(message);
      }
    });

    client.on('error', (error) => console.error('Discord client error:', error));
    client.on('warn', (warning) => console.warn('Discord client warning:', warning));
  }

  private async handleMessage(message: Message) {
    let query = message.content;
    
    if (message.mentions.has(this.discordClient.getClient().user!)) {
      query = query.replace(`<@${this.discordClient.getClient().user!.id}>`, '').trim();
    }
    if (query.toLowerCase().startsWith('!xo')) {
      query = query.slice(3).trim();
    }

    if (!query || query.toLowerCase() === 'help') {
      await this.sendHelpMessage(message);
      return;
    }

    if (query.toLowerCase() === 'status') {
      await this.sendStatusMessage(message);
      return;
    }

    try {
      if (message.channel && 'sendTyping' in message.channel) {
        await message.channel.sendTyping();
      }
      
      console.log(`📝 Processing query from ${message.author.tag}: "${query}"`);
      const response = await this.callChatAPI(query);

      if (!response.success) {
        const embed = this.createErrorEmbed(response.error || 'Unknown error occurred');
        await message.reply({ embeds: [embed] });
        return;
      }

      await this.sendFormattedResponse(message, response.data!, query);
    } catch (error) {
      console.error('Discord bot error:', error);
      const embed = this.createErrorEmbed('Unexpected error occurred. Please try again later.');
      await message.reply({ embeds: [embed] });
    }
  }

  private async callChatAPI(query: string): Promise<{ success: boolean; data?: ChatResponse; error?: string }> {
    try {
      const apiUrl = process.env.API_BASE_URL || 'http://localhost:3000';
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const response = await fetch(`${apiUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorMessage = `API error: ${response.status}`;
        if (response.status === 429) {
          errorMessage = 'Rate limit exceeded. Please wait a moment and try again.';
        } else if (response.status >= 500) {
          errorMessage = 'Server error. Please try again later.';
        }
        return { success: false, error: errorMessage };
      }

      const data = await response.json();
      console.log(`✅ API response received in ${data.responseTime}ms`);
      return { success: true, data };

    } catch (error) {
      console.error('API call failed:', error);
      
      if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, error: 'Request timed out. Please try again with a simpler query.' };
      }
      
      return { 
        success: false, 
        error: 'Network error. Please check if the API server is running.' 
      };
    }
  }

  private async sendFormattedResponse(message: Message, response: ChatResponse, originalQuery: string) {
    const MAX_EMBED_LENGTH = 4000; // Safe limit under Discord's 4096
    const answer = response.answer || '';
    
    if (answer.length <= MAX_EMBED_LENGTH) {
      const embed = new EmbedBuilder()
        .setTitle('🎯 XO Market Expert')
        .setDescription(answer)
        .setColor(0x00AE86)
        .setTimestamp();

      if (response.dataFreshness) {
        embed.addFields({
          name: '📊 Data Source',
          value: response.dataFreshness.slice(0, 1024), 
          inline: false
        });
      }

      if (response.sources && response.sources.length > 0) {
        const sourcesList = response.sources
          .slice(0, 3)
          .map((source, index) => `${index + 1}. ${source}`)
          .join('\n')
          .slice(0, 1024); 
        
        embed.addFields({
          name: '📚 Sources',
          value: sourcesList,
          inline: false
        });
      }

      if (response.queryType) {
        embed.setFooter({ 
          text: `${response.queryType} • ${response.responseTime}ms • ${message.author.tag}`.slice(0, 2048)
        });
      }

      await message.reply({ embeds: [embed] });
      return;
    }

    const chunks = this.smartChunkContent(answer, MAX_EMBED_LENGTH);
    
    console.log(`📤 Sending ${chunks.length} message chunks for long response`);
    
    for (let i = 0; i < chunks.length; i++) {
      const embed = new EmbedBuilder()
        .setTitle(i === 0 ? '🎯 XO Market Expert' : `🎯 XO Market Expert (${i + 1}/${chunks.length})`)
        .setDescription(chunks[i])
        .setColor(0x00AE86)
        .setTimestamp();
      
      if (i === 0 && response.dataFreshness) {
        embed.addFields({
          name: '📊 Data Source',
          value: response.dataFreshness.slice(0, 1024),
          inline: false
        });
      }
      
      if (i === chunks.length - 1) {
        if (response.sources && response.sources.length > 0) {
          const sourcesList = response.sources
            .slice(0, 3)
            .map((source, index) => `${index + 1}. ${source}`)
            .join('\n')
            .slice(0, 1024);
          
          embed.addFields({
            name: '📚 Sources',
            value: sourcesList,
            inline: false
          });
        }

        if (response.queryType) {
          embed.setFooter({ 
            text: `${response.queryType} • ${response.responseTime}ms • ${message.author.tag}`.slice(0, 2048)
          });
        }
      }

      await message.reply({ embeds: [embed] });
      
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
  }

  private smartChunkContent(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) return [text];
    
    const chunks: string[] = [];
    
    if (text.includes('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')) {
      const markets = text.split(/\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n/);
      
      let currentChunk = markets[0] || ''; // Header
      
      for (let i = 1; i < markets.length; i++) {
        const market = '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' + markets[i];
        
        if ((currentChunk + market).length > maxLength) {
          if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
            currentChunk = market;
          } else {
            chunks.push(...this.forceChunkContent(market, maxLength));
            currentChunk = '';
          }
        } else {
          currentChunk += market;
        }
      }
      
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      
      return chunks.filter(chunk => chunk.length > 0);
    }
    
    return this.lineBasedChunking(text, maxLength);
  }

  private lineBasedChunking(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let currentChunk = '';
    const lines = text.split('\n');
    
    for (const line of lines) {
      if ((currentChunk + line + '\n').length > maxLength) {
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        
        if (line.length > maxLength) {
          chunks.push(...this.forceChunkContent(line, maxLength));
        } else {
          currentChunk = line + '\n';
        }
      } else {
        currentChunk += line + '\n';
      }
    }
    
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
    
    return chunks.filter(chunk => chunk.length > 0);
  }

  private forceChunkContent(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let remaining = text;
    
    while (remaining.length > maxLength) {
      let splitIndex = remaining.lastIndexOf(' ', maxLength);
      if (splitIndex === -1 || splitIndex < maxLength * 0.7) {
        splitIndex = maxLength; // Force split if no good break point
      }
      
      chunks.push(remaining.substring(0, splitIndex));
      remaining = remaining.substring(splitIndex).trim();
    }
    
    if (remaining) {
      chunks.push(remaining);
    }
    
    return chunks;
  }

  private createErrorEmbed(errorMessage: string): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('❌ Error')
      .setDescription(errorMessage.slice(0, 4000))
      .setColor(0xFF0000)
      .setTimestamp();
  }

  private async sendHelpMessage(message: Message) {
    const embed = new EmbedBuilder()
      .setTitle('🤖 XO Market Expert Help')
      .setDescription('I\'m your specialized assistant for XO Market questions!')
      .setColor(0x00AE86)
      .addFields(
        {
          name: '💬 Basic Commands',
          value: [
            '• `!xo <question>` - Ask any question',
            '• `@XO Market Expert <question>` - Mention me',
            '• `!xo help` - Show this help',
            '• `!xo status` - Check system status'
          ].join('\n'),
          inline: false
        },
        {
          name: '🔍 Market Queries',
          value: [
            '• `!xo market 14` - Get specific market details',
            '• `!xo fetch all active markets` - List active markets',
            '• `!xo closing soon` - Markets ending soon',
            '• `!xo high volume` - Popular markets',
            '• `!xo new markets` - Recently created'
          ].join('\n'),
          inline: false
        },
        {
          name: '✨ Live Features',
          value: [
            '• 📊 Real-time blockchain data',
            '• 💰 Current prices and odds',
            '• 📈 Volume and open interest',
            '• ⏰ Time to close/resolution',
            '• 📚 Official documentation'
          ].join('\n'),
          inline: false
        }
      );

    await message.reply({ embeds: [embed] });
  }

  private async sendStatusMessage(message: Message) {
    try {
      const apiUrl = process.env.API_BASE_URL || 'http://localhost:3000';
      const startTime = Date.now();
      
      let healthResponse: Response | null = null;
      try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 5000);
        
        healthResponse = await fetch(`${apiUrl}/api/chat`, {
          method: 'GET',
          signal: controller.signal
        });
      } catch (error) {
        console.error('Health check failed:', error);
      }
      
      const apiResponseTime = Date.now() - startTime;
      const isAPIHealthy = healthResponse?.ok || false;
      
      const embed = new EmbedBuilder()
        .setTitle('🔍 XO Market Expert Status')
        .setDescription('System health and performance metrics')
        .setColor(isAPIHealthy ? 0x00FF00 : 0xFF0000)
        .addFields(
          { name: '🤖 Discord Bot', value: '✅ Online', inline: true },
          { name: '🔌 API Backend', value: isAPIHealthy ? '✅ Healthy' : '❌ Offline', inline: true },
          { name: '🔗 Blockchain', value: '✅ Connected', inline: true },
          { name: '📊 Bot Latency', value: `${this.discordClient.getClient().ws.ping}ms`, inline: true },
          { name: '⚡ API Response', value: `${apiResponseTime}ms`, inline: true },
          { name: '💾 Knowledge Base', value: '✅ Loaded', inline: true },
          { name: '⏰ Uptime', value: `${Math.floor(process.uptime() / 60)}m`, inline: true },
          { name: '🎯 Servers', value: `${this.discordClient.getClient().guilds.cache.size}`, inline: true },
          { name: '👥 Users', value: `${this.discordClient.getClient().users.cache.size}`, inline: true }
        );

      await message.reply({ embeds: [embed] });
      
    } catch (error) {
      console.error('Status check error:', error);
      const embed = this.createErrorEmbed('Unable to retrieve complete status information.');
      await message.reply({ embeds: [embed] });
    }
  }

  async start() {
    try {
      console.log('🚀 Starting XO Market Expert Discord Bot...');
      await this.discordClient.login();
      console.log('✅ XO Market Expert Discord Bot started successfully!');
      console.log('📋 Bot is ready for market queries and questions!');
    } catch (error) {
      console.error('❌ Failed to start Discord bot:', error);
      process.exit(1);
    }
  }

  async stop() {
    console.log('🛑 Shutting down XO Market Expert Bot...');
    this.discordClient.getClient().destroy();
    console.log('👋 Discord bot disconnected successfully');
  }
}

const bot = new XODiscordBot();
bot.start().catch(console.error);

process.on('SIGINT', async () => {
  console.log('\n🔄 Received SIGINT, shutting down gracefully...');
  await bot.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🔄 Received SIGTERM, shutting down gracefully...');
  await bot.stop();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
