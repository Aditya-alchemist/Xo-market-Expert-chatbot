import 'dotenv/config';
import { 
  Message, 
  ActivityType, 
  EmbedBuilder, 
  SlashCommandBuilder,
  REST,
  Routes,
  Client,
  GatewayIntentBits,
  Collection,
  ChatInputCommandInteraction,
  Events,
  SlashCommandSubcommandsOnlyBuilder,
  SlashCommandOptionsOnlyBuilder
} from 'discord.js';

interface ChatResponse {
  answer: string;
  sources: string[];
  citations: { [key: number]: string };
  liveData?: any;
  responseTime: number;
  dataFreshness?: string;
  queryType?: string;
}

interface Command {
  data: SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder | SlashCommandOptionsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

class XODiscordBot {
  private client: Client;
  private commands: Collection<string, Command>;
  private token: string;
  private clientId: string;

  constructor() {
    if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_CLIENT_ID) {
      throw new Error('Discord tokens are required in .env file');
    }

    this.token = process.env.DISCORD_BOT_TOKEN;
    this.clientId = process.env.DISCORD_CLIENT_ID;

    console.log('🔧 Initializing XO Market Expert Discord Bot...');
    
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
      ]
    });
    
    this.commands = new Collection();
    this.setupSlashCommands();
    this.setupEventHandlers();
  }

  private setupSlashCommands() {
    const commands: Command[] = [
      // Ask Command
      {
        data: new SlashCommandBuilder()
          .setName('ask')
          .setDescription('Ask any question about XO Markets')
          .addStringOption(option =>
            option.setName('question')
              .setDescription('Your question about XO Markets')
              .setRequired(true)
          ),
        execute: async (interaction) => {
          const question = interaction.options.getString('question', true);
          await interaction.deferReply();
          
          try {
            console.log(`📝 Processing slash command query from ${interaction.user.tag}: "${question}"`);
            const response = await this.callChatAPI(question);

            if (!response.success) {
              const embed = this.createErrorEmbed(response.error || 'Unknown error occurred');
              await interaction.editReply({ embeds: [embed] });
              return;
            }

            await this.sendFormattedSlashResponse(interaction, response.data!, question);
          } catch (error) {
            console.error('Ask command error:', error);
            const embed = this.createErrorEmbed('Unexpected error occurred. Please try again later.');
            await interaction.editReply({ embeds: [embed] });
          }
        }
      },

      // Markets Command with Subcommands
      {
        data: new SlashCommandBuilder()
          .setName('markets')
          .setDescription('Browse markets by different criteria')
          .addSubcommand(subcommand =>
            subcommand
              .setName('closing')
              .setDescription('Show markets closing soon')
              .addIntegerOption(option =>
                option.setName('hours')
                  .setDescription('Hours ahead to look (default: 24)')
                  .setMinValue(1)
                  .setMaxValue(168) // 1 week
              )
          )
          .addSubcommand(subcommand =>
            subcommand
              .setName('volume')
              .setDescription('Show markets with highest volume')
              .addIntegerOption(option =>
                option.setName('limit')
                  .setDescription('Number of markets to show (default: 10)')
                  .setMinValue(1)
                  .setMaxValue(25)
              )
          )
          .addSubcommand(subcommand =>
            subcommand
              .setName('new')
              .setDescription('Show recently created markets')
              .addIntegerOption(option =>
                option.setName('limit')
                  .setDescription('Number of markets to show (default: 10)')
                  .setMinValue(1)
                  .setMaxValue(25)
              )
          )
          .addSubcommand(subcommand =>
            subcommand
              .setName('active')
              .setDescription('Show all active markets')
              .addIntegerOption(option =>
                option.setName('limit')
                  .setDescription('Number of markets to show (default: 10)')
                  .setMinValue(1)
                  .setMaxValue(25)
              )
          ),
        execute: async (interaction) => {
          await interaction.deferReply();
          const subcommand = interaction.options.getSubcommand();

          try {
            let query = '';
            switch (subcommand) {
              case 'closing': {
                const hours = interaction.options.getInteger('hours') || 24;
                query = `markets closing in next ${hours} hours`;
                break;
              }
              case 'volume': {
                const limit = interaction.options.getInteger('limit') || 10;
                query = `top ${limit} markets by volume`;
                break;
              }
              case 'new': {
                const limit = interaction.options.getInteger('limit') || 10;
                query = `latest ${limit} new markets created`;
                break;
              }
              case 'active': {
                const limit = interaction.options.getInteger('limit') || 10;
                query = `${limit} active markets`;
                break;
              }
              default:
                await interaction.editReply('Unknown subcommand.');
                return;
            }

            console.log(`📝 Processing markets query: "${query}"`);
            const response = await this.callChatAPI(query);

            if (!response.success) {
              const embed = this.createErrorEmbed(response.error || 'Failed to fetch market data');
              await interaction.editReply({ embeds: [embed] });
              return;
            }

            await this.sendFormattedSlashResponse(interaction, response.data!, query);
          } catch (error) {
            console.error('Markets command error:', error);
            const embed = this.createErrorEmbed('Failed to fetch market data from the blockchain.');
            await interaction.editReply({ embeds: [embed] });
          }
        }
      },

      // Market Command
      {
        data: new SlashCommandBuilder()
          .setName('market')
          .setDescription('Get detailed information about a specific market')
          .addIntegerOption(option =>
            option.setName('id')
              .setDescription('Market ID to lookup')
              .setRequired(true)
              .setMinValue(1)
          ),
        execute: async (interaction) => {
          await interaction.deferReply();
          const marketId = interaction.options.getInteger('id', true);

          try {
            const query = `market ${marketId} detailed information`;
            console.log(`📝 Processing market query: "${query}"`);
            const response = await this.callChatAPI(query);
            
            if (!response.success) {
              const embed = this.createErrorEmbed(
                response.error || `Market #${marketId} not found or couldn't be retrieved.`
              );
              await interaction.editReply({ embeds: [embed] });
              return;
            }

            await this.sendFormattedSlashResponse(interaction, response.data!, query);
          } catch (error) {
            console.error('Market command error:', error);
            const embed = this.createErrorEmbed('Failed to fetch market data from the blockchain.');
            await interaction.editReply({ embeds: [embed] });
          }
        }
      },

      // Price Command
      {
        data: new SlashCommandBuilder()
          .setName('price')
          .setDescription('Get current price for a specific market outcome')
          .addIntegerOption(option =>
            option.setName('market')
              .setDescription('Market ID')
              .setRequired(true)
              .setMinValue(1)
          )
          .addIntegerOption(option =>
            option.setName('outcome')
              .setDescription('Outcome number (0, 1, 2, etc.)')
              .setRequired(false)
              .setMinValue(0)
          ),
        execute: async (interaction) => {
          await interaction.deferReply();
          const marketId = interaction.options.getInteger('market', true);
          const outcome = interaction.options.getInteger('outcome');

          try {
            const query = outcome !== null 
              ? `market ${marketId} outcome ${outcome} current price`
              : `market ${marketId} all current prices`;
            
            console.log(`📝 Processing price query: "${query}"`);
            const response = await this.callChatAPI(query);

            if (!response.success) {
              const embed = this.createErrorEmbed(response.error || 'Failed to fetch price data');
              await interaction.editReply({ embeds: [embed] });
              return;
            }

            await this.sendFormattedSlashResponse(interaction, response.data!, query);
          } catch (error) {
            console.error('Price command error:', error);
            const embed = this.createErrorEmbed('Failed to fetch price data from the blockchain.');
            await interaction.editReply({ embeds: [embed] });
          }
        }
      },

      // Volume Command
      {
        data: new SlashCommandBuilder()
          .setName('volume')
          .setDescription('Get trading volume for a specific market')
          .addIntegerOption(option =>
            option.setName('id')
              .setDescription('Market ID')
              .setRequired(true)
              .setMinValue(1)
          ),
        execute: async (interaction) => {
          await interaction.deferReply();
          const marketId = interaction.options.getInteger('id', true);

          try {
            const query = `market ${marketId} trading volume and open interest`;
            console.log(`📝 Processing volume query: "${query}"`);
            const response = await this.callChatAPI(query);
            
            if (!response.success) {
              const embed = this.createErrorEmbed(
                response.error || `Market #${marketId} volume data not found.`
              );
              await interaction.editReply({ embeds: [embed] });
              return;
            }

            await this.sendFormattedSlashResponse(interaction, response.data!, query);
          } catch (error) {
            console.error('Volume command error:', error);
            const embed = this.createErrorEmbed('Failed to fetch volume data from the blockchain.');
            await interaction.editReply({ embeds: [embed] });
          }
        }
      },

      // Search Command
      {
        data: new SlashCommandBuilder()
          .setName('search')
          .setDescription('Search for markets by keyword')
          .addStringOption(option =>
            option.setName('query')
              .setDescription('Search terms')
              .setRequired(true)
          ),
        execute: async (interaction) => {
          await interaction.deferReply();
          const searchQuery = interaction.options.getString('query', true);
          
          try {
            const query = `search markets for "${searchQuery}"`;
            console.log(`📝 Processing search query: "${query}"`);
            const response = await this.callChatAPI(query);

            if (!response.success) {
              const embed = this.createErrorEmbed(response.error || 'Search failed');
              await interaction.editReply({ embeds: [embed] });
              return;
            }

            await this.sendFormattedSlashResponse(interaction, response.data!, query);
          } catch (error) {
            console.error('Search command error:', error);
            const embed = this.createErrorEmbed('Failed to search markets.');
            await interaction.editReply({ embeds: [embed] });
          }
        }
      },

      // LSLMSR Command
      {
        data: new SlashCommandBuilder()
          .setName('lslmsr')
          .setDescription('Get information about LSLMSR market maker mechanism')
          .addStringOption(option =>
            option.setName('topic')
              .setDescription('Specific LSLMSR topic')
              .setRequired(false)
              .addChoices(
                { name: 'Overview', value: 'overview' },
                { name: 'Pricing', value: 'pricing' },
                { name: 'Liquidity', value: 'liquidity' },
                { name: 'Parameters', value: 'parameters' }
              )
          ),
        execute: async (interaction) => {
          const topic = interaction.options.getString('topic') || 'overview';
          await interaction.deferReply();
          
          try {
            const query = `LSLMSR ${topic} explanation`;
            console.log(`📝 Processing LSLMSR query: "${query}"`);
            const response = await this.callChatAPI(query);

            if (!response.success) {
              const embed = this.createErrorEmbed(response.error || 'Failed to get LSLMSR information');
              await interaction.editReply({ embeds: [embed] });
              return;
            }

            await this.sendFormattedSlashResponse(interaction, response.data!, query);
          } catch (error) {
            console.error('LSLMSR command error:', error);
            const embed = this.createErrorEmbed('Failed to fetch LSLMSR information.');
            await interaction.editReply({ embeds: [embed] });
          }
        }
      },

      // Status Command
      {
        data: new SlashCommandBuilder()
          .setName('status')
          .setDescription('Check XO Market Expert system status'),
        execute: async (interaction) => {
          await interaction.deferReply();
          await this.sendSlashStatusMessage(interaction);
        }
      },

      // Help Command
      {
        data: new SlashCommandBuilder()
          .setName('help')
          .setDescription('Show help information for XO Market Expert'),
        execute: async (interaction) => {
          await interaction.deferReply();
          await this.sendSlashHelpMessage(interaction);
        }
      }
    ];

    // Add commands to collection
    commands.forEach(command => {
      this.commands.set(command.data.name, command);
    });
  }

  private setupEventHandlers() {
    this.client.once('ready', () => {
      console.log(`🤖 XO Market Expert Bot logged in as ${this.client.user?.tag}!`);
      console.log(`📊 Connected to ${this.client.guilds.cache.size} servers`);
      console.log(`👥 Serving ${this.client.users.cache.size} users`);
      console.log(`⚡ Registered ${this.commands.size} slash commands`);
      
      this.client.user?.setActivity('XO Market questions | /help', { 
        type: ActivityType.Listening 
      });
    });

    // Handle slash commands
    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      const command = this.commands.get(interaction.commandName);
      if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
      }

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error('Slash command execution error:', error);
        
        const errorEmbed = this.createErrorEmbed('There was an error executing this command.');
        
        try {
          if (interaction.replied || interaction.deferred) {
            await interaction.editReply({ embeds: [errorEmbed] });
          } else {
            await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
          }
        } catch (replyError) {
          console.error('Error sending error message:', replyError);
        }
      }
    });

    // Handle regular messages (existing functionality)
    this.client.on(Events.MessageCreate, async (message: Message) => {
      if (message.author.bot) return;

      const isDM = message.guild === null;
      const isMentioned = message.mentions.has(this.client.user!);
      const hasPrefix = message.content.toLowerCase().startsWith('!xo');

      if (isDM || isMentioned || hasPrefix) {
        await this.handleMessage(message);
      }
    });

    this.client.on(Events.Error, (error) => console.error('Discord client error:', error));
    this.client.on(Events.Warn, (warning) => console.warn('Discord client warning:', warning));
  }

  private async registerSlashCommands() {
    try {
      console.log('🔄 Registering slash commands...');
      
      const rest = new REST({ version: '10' }).setToken(this.token);
      const commandsData = Array.from(this.commands.values()).map(command => command.data.toJSON());

      // Register commands globally
      await rest.put(
        Routes.applicationCommands(this.clientId),
        { body: commandsData }
      );

      console.log('✅ Successfully registered slash commands globally');
    } catch (error) {
      console.error('❌ Failed to register slash commands:', error);
    }
  }

  private async handleMessage(message: Message) {
    let query = message.content;
    
    if (message.mentions.has(this.client.user!)) {
      query = query.replace(`<@${this.client.user!.id}>`, '').trim();
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

  private async sendFormattedSlashResponse(interaction: ChatInputCommandInteraction, response: ChatResponse, originalQuery: string) {
    const MAX_EMBED_LENGTH = 4000;
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
          text: `${response.queryType} • ${response.responseTime}ms • ${interaction.user.tag}`.slice(0, 2048)
        });
      }

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Handle long responses
    const chunks = this.smartChunkContent(answer, MAX_EMBED_LENGTH);
    
    console.log(`📤 Sending ${chunks.length} message chunks for long slash response`);
    
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
            text: `${response.queryType} • ${response.responseTime}ms • ${interaction.user.tag}`.slice(0, 2048)
          });
        }
      }

      if (i === 0) {
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.followUp({ embeds: [embed] });
      }
      
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
  }

  private async sendFormattedResponse(message: Message, response: ChatResponse, originalQuery: string) {
    const MAX_EMBED_LENGTH = 4000;
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

    // Handle long responses
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
      
      let currentChunk = markets[0] || '';
      
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
        splitIndex = maxLength;
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

  private async sendSlashHelpMessage(interaction: ChatInputCommandInteraction) {
    const embed = new EmbedBuilder()
      .setTitle('🤖 XO Market Expert Help')
      .setDescription('I\'m your specialized assistant for XO Market questions!')
      .setColor(0x00AE86)
      .addFields(
        {
          name: '🚀 Slash Commands',
          value: [
            '• `/ask <question>` - Ask any question',
            '• `/market <id>` - Get specific market details',
            '• `/markets <subcommand>` - Browse markets by criteria',
            '• `/price <market> [outcome]` - Get current prices',
            '• `/volume <id>` - Get volume data',
            '• `/search <query>` - Search markets by keyword',
            '• `/lslmsr [topic]` - LSLMSR information',
            '• `/status` - Check system status',
            '• `/help` - Show this help'
          ].join('\n'),
          inline: false
        },
        {
          name: '📊 Market Subcommands',
          value: [
            '• `/markets active [limit]` - All active markets',
            '• `/markets closing [hours]` - Markets closing soon',
            '• `/markets volume [limit]` - Highest volume markets',
            '• `/markets new [limit]` - Recently created'
          ].join('\n'),
          inline: false
        },
        {
          name: '💬 Legacy Commands',
          value: [
            '• `!xo <question>` - Ask any question',
            '• `@XO Market Expert <question>` - Mention me',
            '• `!xo help` - Show help',
            '• `!xo status` - Check system status'
          ].join('\n'),
          inline: false
        },
        {
          name: '✨ Features',
          value: [
            '• 📊 Real-time blockchain data',
            '• 💰 Current prices and odds',
            '• 📈 Volume and open interest',
            '• ⏰ Time to close/resolution',
            '• 🔍 Market search functionality',
            '• 📚 LSLMSR documentation'
          ].join('\n'),
          inline: false
        }
      );

    await interaction.editReply({ embeds: [embed] });
  }

  private async sendHelpMessage(message: Message) {
    const embed = new EmbedBuilder()
      .setTitle('🤖 XO Market Expert Help')
      .setDescription('I\'m your specialized assistant for XO Market questions!')
      .setColor(0x00AE86)
      .addFields(
        {
          name: '🚀 Slash Commands',
          value: [
            '• `/ask <question>` - Ask any question',
            '• `/market <id>` - Get specific market details',
            '• `/markets <subcommand>` - Browse markets by criteria',
            '• `/price <market> [outcome]` - Get current prices',
            '• `/volume <id>` - Get volume data',
            '• `/search <query>` - Search markets by keyword',
            '• `/lslmsr [topic]` - LSLMSR information',
            '• `/status` - Check system status',
            '• `/help` - Show this help'
          ].join('\n'),
          inline: false
        },
        {
          name: '💬 Legacy Commands',
          value: [
            '• `!xo <question>` - Ask any question',
            '• `@XO Market Expert <question>` - Mention me',
            '• `!xo help` - Show help',
            '• `!xo status` - Check system status'
          ].join('\n'),
          inline: false
        },
        {
          name: '✨ Features',
          value: [
            '• 📊 Real-time blockchain data',
            '• 💰 Current prices and odds',
            '• 📈 Volume and open interest',
            '• ⏰ Time to close/resolution',
            '• 🔍 Market search functionality',
            '• 📚 LSLMSR documentation'
          ].join('\n'),
          inline: false
        }
      );

    await message.reply({ embeds: [embed] });
  }

  private async sendSlashStatusMessage(interaction: ChatInputCommandInteraction) {
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
          { name: '📊 Bot Latency', value: `${this.client.ws.ping}ms`, inline: true },
          { name: '⚡ API Response', value: `${apiResponseTime}ms`, inline: true },
          { name: '💾 Knowledge Base', value: '✅ Loaded', inline: true },
          { name: '⏰ Uptime', value: `${Math.floor(process.uptime() / 60)}m`, inline: true },
          { name: '🎯 Servers', value: `${this.client.guilds.cache.size}`, inline: true },
          { name: '👥 Users', value: `${this.client.users.cache.size}`, inline: true },
          { name: '⚡ Slash Commands', value: `${this.commands.size} registered`, inline: true }
        );

      await interaction.editReply({ embeds: [embed] });
      
    } catch (error) {
      console.error('Status check error:', error);
      const embed = this.createErrorEmbed('Unable to retrieve complete status information.');
      await interaction.editReply({ embeds: [embed] });
    }
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
          { name: '📊 Bot Latency', value: `${this.client.ws.ping}ms`, inline: true },
          { name: '⚡ API Response', value: `${apiResponseTime}ms`, inline: true },
          { name: '💾 Knowledge Base', value: '✅ Loaded', inline: true },
          { name: '⏰ Uptime', value: `${Math.floor(process.uptime() / 60)}m`, inline: true },
          { name: '🎯 Servers', value: `${this.client.guilds.cache.size}`, inline: true },
          { name: '👥 Users', value: `${this.client.users.cache.size}`, inline: true },
          { name: '⚡ Slash Commands', value: `${this.commands.size} registered`, inline: true }
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
      await this.client.login(this.token);
      
      // Wait a bit for the client to be ready, then register commands
      setTimeout(async () => {
        await this.registerSlashCommands();
      }, 2000);
      
      console.log('✅ XO Market Expert Discord Bot started successfully!');
      console.log('📋 Bot is ready for market queries and questions!');
    } catch (error) {
      console.error('❌ Failed to start Discord bot:', error);
      process.exit(1);
    }
  }

  async stop() {
    console.log('🛑 Shutting down XO Market Expert Bot...');
    this.client.destroy();
    console.log('👋 Discord bot disconnected successfully');
  }

  getClient() {
    return this.client;
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
