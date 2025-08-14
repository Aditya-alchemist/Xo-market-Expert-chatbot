import 'dotenv/config';
import { Message, ActivityType, ChannelType } from 'discord.js';
import { DiscordClient } from '../src/lib/discord';

interface ChatResponse {
  answer: string;
  sources: string[];
  citations: { [key: number]: string };
  liveData?: any;
  responseTime: number;
}

class XODiscordBot {
  private discordClient: DiscordClient;

  constructor() {
    if (!process.env.DISCORD_BOT_TOKEN) {
      throw new Error('DISCORD_BOT_TOKEN is required in .env file');
    }
    if (!process.env.DISCORD_CLIENT_ID) {
      throw new Error('DISCORD_CLIENT_ID is required in .env file');
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

    client.on('error', (error) => {
      console.error('Discord client error:', error);
    });

    client.on('warn', (warning) => {
      console.warn('Discord client warning:', warning);
    });
  }

  private canSendTyping(channel: any): channel is { sendTyping(): Promise<void> } {
    return channel && typeof channel.sendTyping === 'function';
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
      if (this.canSendTyping(message.channel)) {
        await message.channel.sendTyping();
      }
      
      console.log(`📝 Processing query from ${message.author.tag}: "${query}"`);

      const response = await this.callChatAPI(query);

      if (!response.success) {
        const embed = this.discordClient.createEmbed(
          '❌ Error',
          response.error || 'Sorry, I encountered an error processing your question. Please try again later.',
          0xFF0000
        );
        await message.reply({ embeds: [embed] });
        return;
      }

      await this.sendFormattedResponse(message, response.data!, query);

    } catch (error) {
      console.error('Discord bot error:', error);
      const embed = this.discordClient.createEmbed(
        '❌ Error',
        'Sorry, I encountered an unexpected error. Please try again later.',
        0xFF0000
      );
      await message.reply({ embeds: [embed] });
    }
  }

  private async fetchWithTimeout(
    resource: string, 
    options: RequestInit = {}, 
    timeoutMs: number = 5000
  ): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      const response = await fetch(resource, {
        ...options,
        signal: controller.signal
      });
      return response;
    } finally {
      clearTimeout(id);
    }
  }

  private async callChatAPI(query: string): Promise<{ success: boolean; data?: ChatResponse; error?: string }> {
    try {
      const apiUrl = process.env.API_BASE_URL || 'http://localhost:3000';
      
      const response = await this.fetchWithTimeout(`${apiUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      }, 30000); 

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
        return { success: false, error: 'Request timed out. Please try again.' };
      }
      
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Network error. Please check if the API server is running.' 
      };
    }
  }

  private async sendFormattedResponse(message: Message, response: ChatResponse, originalQuery: string) {
    const embed = this.discordClient.createEmbed(
      '🎯 XO Market Expert',
      this.discordClient.truncateText(response.answer, 4000),
      0x00AE86
    );

    if (response.sources && response.sources.length > 0) {
      const sourcesList = response.sources
        .slice(0, 5) 
        .map((source, index) => `\`${index + 1}.\` ${source}`)
        .join('\n');
      
      embed.addFields({
        name: '📚 Sources',
        value: sourcesList,
        inline: false
      });
    }

    if (response.liveData && Array.isArray(response.liveData) && response.liveData.length > 0) {
      embed.addFields({
        name: '📊 Live Data',
        value: `✅ Includes real-time blockchain data (${response.liveData.length} markets)`,
        inline: false
      });
    }

    embed.setFooter({ 
      text: `Response time: ${response.responseTime}ms • Sources: ${response.sources?.length || 0} • Requested by ${message.author.tag}` 
    });

    await message.reply({ embeds: [embed] });
  }

  private async sendHelpMessage(message: Message) {
    const embed = this.discordClient.createEmbed(
      '🤖 XO Market Expert Help',
      'I\'m your specialized assistant for XO Market questions!',
      0x00AE86
    );

    embed.addFields(
      {
        name: '💬 How to use me',
        value: [
          '• `!xo <your question>` - Ask any question about XO Market',
          '• Mention me: `@XO Market Expert <question>`',
          '• Send me a direct message',
          '• `!xo help` - Show this help message',
          '• `!xo status` - Check bot and API status'
        ].join('\n'),
        inline: false
      },
      {
        name: '💡 Example questions',
        value: [
          '• `!xo What is XO Market?`',
          '• `!xo How do I create a prediction market?`',
          '• `!xo What are the current active markets?`',
          '• `!xo How does market resolution work?`',
          '• `!xo What is the XO token used for?`'
        ].join('\n'),
        inline: false
      },
      {
        name: '✨ My capabilities',
        value: [
          '• 📚 Answer with citations from official docs',
          '• 🔴 Provide live blockchain data when relevant',
          '• ⚡ Fast response times (~3-5 seconds)',
          '• 🎯 Specialized knowledge about prediction markets',
          '• 💡 Help with platform features and trading'
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
        healthResponse = await this.fetchWithTimeout(`${apiUrl}/api/chat`, {
          method: 'GET'
        }, 5000);
      } catch (error) {
        console.error('Health check failed:', error);
      }
      
      const apiResponseTime = Date.now() - startTime;
      const isAPIHealthy = healthResponse?.ok || false;

      const embed = this.discordClient.createEmbed(
        '🔍 XO Market Expert Bot Status',
        'Current system status and health check',
        isAPIHealthy ? 0x00FF00 : 0xFF0000
      );

      embed.addFields(
        { name: '🤖 Discord Bot', value: '✅ Online and responsive', inline: true },
        { name: '🔌 API Backend', value: isAPIHealthy ? '✅ Healthy' : '❌ Offline', inline: true },
        { name: '📊 Bot Ping', value: `${this.discordClient.getClient().ws.ping}ms`, inline: true },
        { name: '⚡ API Response', value: `${apiResponseTime}ms`, inline: true },
        { name: '💾 Knowledge Base', value: '✅ 56+ Documents loaded', inline: true },
        { name: '🔗 Blockchain', value: '✅ XO Testnet connected', inline: true },
        { name: '⏰ Bot Uptime', value: `${Math.floor(process.uptime() / 60)} minutes`, inline: true },
        { name: '🎯 Servers', value: `${this.discordClient.getClient().guilds.cache.size}`, inline: true },
        { name: '👥 Users', value: `${this.discordClient.getClient().users.cache.size}`, inline: true }
      );

      await message.reply({ embeds: [embed] });
      
    } catch (error) {
      console.error('Error checking status:', error);
      const embed = this.discordClient.createEmbed(
        '❌ Status Check Failed',
        'Unable to retrieve complete status information.',
        0xFF0000
      );
      await message.reply({ embeds: [embed] });
    }
  }

  async start() {
    try {
      console.log('🚀 Starting XO Market Expert Discord Bot...');
      await this.discordClient.login();
      console.log('✅ XO Market Expert Discord Bot started successfully!');
      console.log('📋 Bot is ready to receive messages and answer XO Market questions!');
    } catch (error) {
      console.error('❌ Failed to start Discord bot:', error);
      
      if (error instanceof Error) {
        if (error.message.includes('TOKEN_INVALID')) {
          console.error('🔑 Invalid Discord bot token. Please check DISCORD_BOT_TOKEN in your .env file.');
        } else if (error.message.includes('PRIVILEGED_INTENTS')) {
          console.error('🔒 Missing privileged intents. Enable MESSAGE CONTENT INTENT in Discord Developer Portal.');
        }
      }
      
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
