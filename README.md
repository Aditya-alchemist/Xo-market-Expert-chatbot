
# XO Market Expert Chatbot (RAG + Tools)

## 🎯 Overview

A specialized Discord chatbot that answers XO Market product, documentation, and trading questions with accurate citations and live blockchain data integration. Built with RAG (Retrieval-Augmented Generation) technology and connected to the XO Market testnet for real-time market information.

## ✨ Key Features

- **🤖 Expert Discord Bot**: Live operational bot serving real users
- **📚 RAG-Powered Responses**: 100% citation accuracy with academic-style references
- **🔗 Live Blockchain Integration**: Real-time data from XO Market testnet
- **⚡ High Performance**: Sub-5 second response times
- **🎯 Comprehensive Knowledge**: 56+ document chunks covering all XO Market aspects
- **💬 Multiple Interaction Methods**: Slash commands, mentions, DMs, and prefix commands

## 🚀 Live Demo

- **Discord Bot**: `xo market expert bot#0480`
- **Bot Invite URL**: `https://discord.com/api/oauth2/authorize?client_id=1405203064474042398&permissions=274877906944&scope=bot`
- **Loom Demo Video**: [loom video](https://drive.google.com/file/d/19rHuWptcp9ZLOaFXNLptvZHAyqU0VisW/view?usp=sharing)

## 📊 Performance Metrics (Grade A - 100%)

- **Success Rate**: 100% (20/20 test questions passed)
- **Citation Accuracy**: 100% (Perfect source attribution)
- **Source Relevance**: 100% (All retrieved sources relevant)
- **Average Response Time**: 3.5-4.6 seconds
- **Knowledge Base**: 56+ document chunks from official XO Market sources

## 🛠 Tech Stack

- **Framework**: Next.js 14 with TypeScript
- **AI Models**: Google Gemini 1.5-flash (primary), OpenAI GPT-3.5-turbo (fallback)
- **Vector Database**: Pinecone
- **Discord Integration**: Discord.js v14
- **Blockchain**: Ethers.js with XO Market testnet
- **Environment**: Node.js with comprehensive error handling

## 📋 Prerequisites

Before setting up the project, ensure you have:

- Node.js 18+ installed
- npm or yarn package manager
- Discord account with developer access
- Google AI Studio account (for Gemini API)
- Pinecone account
- Git for cloning the repository

## ⚙️ Environment Setup

### 1. API Keys and Services Setup

#### **Discord Bot Setup**
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create New Application → Name it "XO Market Expert"
3. Go to **Bot** tab:
   - Create Bot
   - Copy **Bot Token**
   - Enable **Message Content Intent** (Critical!)
   - Disable **Requires OAuth2 Code Grant**
4. Go to **General Information** → Copy **Application ID**
5. Get your Discord server ID (Enable Developer Mode → Right-click server → Copy Server ID)

#### **Google Gemini API Setup**
1. Go to [Google AI Studio](https://aistudio.google.com/)
2. Create new project or select existing
3. Go to **Get API Key**
4. Create new API key
5. Copy the API key

#### **Pinecone Setup**
1. Sign up at [Pinecone](https://www.pinecone.io/)
2. Create new project
3. Get API key from dashboard
4. Create index named `xo-market-docs`
   - Dimensions: 768
   - Metric: cosine
   

#### **OpenAI Setup (Optional Fallback)**
1. Go to [OpenAI Platform](https://platform.openai.com/)
2. Create API key
3. Add billing information for usage

### 2. Clone and Install

```bash
# Clone the repository
git clone [your-repository-url]
cd xo-market-chatbot

# Install dependencies
npm install

# Install additional dependencies for Discord bot
npm install discord.js concurrently --save
npm install --save-dev ts-node typescript @types/node
```

### 3. Environment Configuration

Create a `.env` file in the root directory:

```bash
# AI API Keys
GOOGLE_GEMINI_API_KEY=
GEMINI_MODEL=gemini-1.5-flash
OPENAI_API_KEY=

# Vector Database
PINECONE_API_KEY=
PINECONE_INDEX=xo-market-docs

# Discord Bot Configuration
DISCORD_BOT_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=[your-test-server-id]

# XO Market Blockchain Integration
XO_MARKET_RPC_URL=https://testnet-rpc-1.xo.market/
XO_MARKET_CONTRACT=0x3cf19D0C88a14477DCaA0A45f4AF149a4C917523
XO_MARKET_NFT=0x550318A123d222e841776a281F51B09e8909E144

# API Configuration
API_BASE_URL=http://localhost:3000
```

## 🚀 Installation & Setup

### Step 1: Document Ingestion
```bash
# Ingest XO Market documents into Pinecone
npm run ingest
```

Expected output:
```
✅ Connected to Pinecone
📄 Processing documents...
✅ Successfully ingested 160 document chunks
🎯 Knowledge base ready for queries
```

### Step 2: Start the API Server
```bash
# Start Next.js development server
npm run dev
```

Server will start at `http://localhost:3000`

### Step 3: Test the API
```bash
# Test the chatbot API
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "What is XO Market?"}'
```

### Step 4: Start Discord Bot
```bash
# In a new terminal window
npm run discord-bot
```

Expected output:
```
🤖 XO Market Expert Bot logged in as xo market expert bot#0480!
📊 Connected to X servers
✅ XO Market Expert Discord Bot started successfully!
```

### Step 5: Run Evaluation (Optional)
```bash
# Run the evaluation suite
npm run evaluate
```

## 📱 Bot Usage

### Discord Commands


#### **Text Commands**
- `!xo [question]` - Ask using prefix
- `@XO Market Expert [question]` - Mention the bot
- Direct message the bot with any question

#### **Example Questions**
```
!xo What is XO Market?
!xo How do I create a prediction market?

!xo How does market resolution work?
!xo Explain liquidity mechanisms in XO Market
```

## 📁 Project Structure

```
xo-market-chatbot/
├── README.md                 # This file
├── .env                      # Environment variables
├── .env.example              # Environment template
├── package.json              # Dependencies and scripts
├── tsconfig.json             # TypeScript configuration
├── abi.json                  # Smart contract ABI
├── 
├── src/
│   ├── app/
│   │   └── api/
│   │       └── chat/
│   │           └── route.ts  # Main RAG API endpoint
│   ├── lib/
│   │   ├── blockchain.ts     # XO Market blockchain integration
        ├── gemini.ts
        ├── pinecone.ts
│   │   ├── discord.ts        # Discord client utilities
│   │   └── openai.ts         # OpenAI integration
│   └── scripts/
│       └── ingest.ts         # Document ingestion script
├──
├── bot/
│   └── discord-bot.ts        # Discord bot implementation
├──
├── data/                     # Knowledge base documents
│   ├── xo-market-docs.md
│   ├── blog-posts/
│   ├── docs/
│   └── discord-threads/
├──
└── eval/                     # Evaluation framework
    ├── evaluate.ts           # Evaluation script
    ├── test-questions.json   # Test question set
    └── results.md            # Evaluation results (Grade A)
```

## 🧪 Testing & Evaluation

### Run Evaluation Suite
```bash
npm run evaluate
```

The evaluation system tests:
- **Response Quality**: Accuracy and completeness
- **Citation Accuracy**: Proper source attribution
- **Response Times**: Performance metrics
- **Success Rates**: Query handling reliability

### Current Performance
- **Grade**: A (100%)
- **Success Rate**: 20/20 questions (100%)
- **Citation Accuracy**: 100%
- **Average Response Time**: 3.5 seconds

## 🔧 Configuration Options

### Pinecone Configuration
```javascript
// Optimal settings for XO Market knowledge base
{
  dimensions: 768,        // Balanced performance/cost
  metric: "cosine",      // Best for semantic similarity
  
}
```

### AI Model Configuration
```javascript
// Google Gemini (Primary)
model: "gemini-1.5-flash"  // Fast, cost-effective
temperature: 0.3           // Focused, factual responses

// OpenAI (Fallback)
model: "gpt-3.5-turbo"    // Reliable backup
max_tokens: 1000          // Balanced response length
```

## 🚨 Troubleshooting

### Common Issues

#### **Discord Bot Won't Start**
```bash
# Error: "Used disallowed intents"
# Solution: Enable Message Content Intent in Discord Developer Portal
```

#### **API Timeouts**
```bash
# Error: "AbortError: This operation was aborted"
# Solution: Increase timeout in discord-bot.ts line 157 to 30000ms
```

#### **Pinecone Connection Errors**
```bash
# Error: "PineconeConnectionError"
# Solution: Verify API key and index name in .env file
```

#### **Missing Documents**
```bash
# Error: "No relevant documents found"
# Solution: Run document ingestion: npm run ingest
```

### Debug Mode
```bash
# Enable verbose logging
DEBUG=xo-market:* npm run dev
```

## 📈 Performance Optimization

### For Production Deployment

#### **Environment Variables**
```bash
NODE_ENV=production
API_BASE_URL=https://your-domain.com
```

#### **Rate Limiting**
- Implement Redis for distributed rate limiting
- Add queue system for concurrent requests
- Monitor API usage and costs

#### **Scaling**
- Use PM2 for process management
- Implement clustering for high availability
- Add monitoring and alerting

## 🤝 Contributing

### Development Workflow
1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

### Code Quality
- TypeScript strict mode enabled
- Comprehensive error handling
- Proper logging throughout
- Academic-style citations required





***

*Last Updated: August 14, 2025*
