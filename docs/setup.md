# VibSDK Setup Guide

Local first time setup guide for VibSDK - get your AI coding platform running locally and also ready to be deployed.

## Prerequisites

Before getting started, make sure you have:

### Required
- **Node.js** (v18 or later)
- **Cloudflare account** with API access  
- **Cloudflare API Token** with appropriate permissions

### Recommended
- **Bun** (automatically installed by setup script for better performance)
- **Custom domain** configured in Cloudflare (for production deployment)

### For Production Features
- **Workers Paid Plan** (for remote Cloudflare resources)
- **Workers for Platforms** subscription (for app deployment features)
- **Advanced Certificate Manager** (if using first-level subdomains)

## Quick Start

The fastest way to get VibSDK running is with our automated setup script:

```bash
npm run setup
# Or if you already have Bun installed: bun run setup
```

This interactive script will guide you through the entire setup process, including:

- **Package manager setup** (installs Bun automatically for better performance)
- **Cloudflare credentials** collection (Account ID and API Token)
- **Domain configuration** (custom domain or localhost for development)
- **Remote setup** (optional production deployment configuration)
- **AI Gateway configuration** (Cloudflare AI Gateway recommended)
- **API key collection** (OpenAI, Anthropic, Google AI Studio, etc.)
- **OAuth setup** (Google, GitHub login - optional)
- **Resource creation** (KV namespaces, D1 databases, R2 buckets, AI Gateway)
- **File generation** (`.dev.vars` and optionally `.prod.vars`)
- **Configuration updates** (`wrangler.jsonc` and `vite.config.ts`)
- **Database setup** (schema generation and migrations)
- **Template deployment** (example app templates to R2)
- **Readiness report** (comprehensive status and next steps)

## What You'll Need During Setup

The setup script will ask you for the following information:

### Cloudflare Account Information

1. **Account ID**: Found in your Cloudflare dashboard sidebar
2. **API Token**: Create one with these permissions:
   - **Account** - Account:Read
   - **Zone** - Zone Settings:Edit, Zone:Edit, DNS:Edit (if using custom domain)
   - **Account** - Workers KV Storage:Edit, D1:Edit, Workers Scripts:Edit, Workers AI:Edit
   - **Account** - R2:Edit (for object storage)
   - **Account** - Cloudflare Images:Edit (for image handling)
   - **Account** - Account Rulesets:Edit (for rate limiting)

   **Important**: Some features like D1 databases and R2 may require a paid Cloudflare plan.

### Domain Configuration (Optional)

- **Custom Domain**: Any domain you own that's managed by Cloudflare
- **No Domain**: Script will default to `localhost:5173` for local development

### AI Gateway Configuration

Choose one:
- **Cloudflare AI Gateway**: Automatic setup through Cloudflare
- **Custom OpenAI URL**: Use your own OpenAI-compatible endpoint

### AI Model Configuration

The setup script will ask for API keys from various providers (OpenAI, Anthropic, Google AI Studio). 

**Important**: Default model configurations are located in `worker/agents/inferutils/config.ts`. You may need to edit these configurations based on which API keys you provide:

- If you **don't provide Google AI Studio keys**, update fallback models from Gemini to your available providers
- Review the performance recommendations in the config file comments
- Consider switching primary models based on your available providers and cost preferences

### OAuth Configuration

The script will also ask for OAuth credentials:

- **Google OAuth**: For user authentication and login (not AI Studio access)
- **GitHub OAuth**: For user authentication and login
- **GitHub Export OAuth**: For exporting generated apps to GitHub repositories (separate from login OAuth)

## Manual Setup (Alternative)

If you prefer to set up manually:

### 1. Create `.dev.vars` file

Copy `.dev.vars.example` to `.dev.vars` and fill in your values:

```bash
cp .dev.vars.example .dev.vars
```

### 2. Configure Required Variables

```bash
# Essential
CLOUDFLARE_API_TOKEN="your-api-token"
CLOUDFLARE_ACCOUNT_ID="your-account-id"

# Security
JWT_SECRET="generated-secret"
WEBHOOK_SECRET="generated-secret"

# Domain (optional)
CUSTOM_DOMAIN="your-domain.com"
```

### 3. Create Cloudflare Resources

Create required resources in your Cloudflare account:
- KV Namespace for `VibecoderStore`
- D1 Database named `vibesdk-db`
- R2 Bucket named `vibesdk-templates`

### 4. Update `wrangler.jsonc`

Update resource IDs in `wrangler.jsonc` with the IDs from step 3.

## Starting Development

After setup is complete:

```bash
# Set up database
npm run db:migrate:local

# Start development server
npm run dev
```

Visit your app at `http://localhost:5173`

## Troubleshooting

### Common Issues

**D1 Database "Unauthorized" Error**: This usually means:
- Your API token lacks "D1:Edit" permissions
- Your account doesn't have access to D1 (may require paid plan)
- You've exceeded your D1 database quota
- **Solution**: Update your API token permissions or upgrade your Cloudflare plan

**Permission Errors**: Ensure your API token has all required permissions listed above.

**Domain Not Found**: Make sure your domain is:
- Added to Cloudflare
- DNS is properly configured
- API token has zone permissions

**Resource Creation Failed**: Check that your account has:
- Available KV namespace quota (10 on free plan)
- D1 database quota (may require paid plan)
- R2 bucket quota (may require paid plan)
- Appropriate plan level for requested features

**R2 Bucket "Unauthorized" Error**: This usually means:
- Your API token lacks "R2:Edit" permissions
- Your account doesn't have access to R2 (may require paid plan)
- You've exceeded your R2 bucket quota
- **Solution**: Update your API token permissions or upgrade your Cloudflare plan

### Getting Help

1. Check the setup report for specific issues and suggestions
2. Review the Cloudflare Workers documentation
3. Ensure all prerequisites are met

## Production Deployment

If you configured remote deployment during setup, you'll have a `.prod.vars` file ready for production. Deploy with:

```bash
npm run deploy
```

This will:
- Build the application
- Update Cloudflare resources 
- Deploy to Cloudflare Workers
- Apply database migrations
- Configure custom domain routing (if specified)

### Production-Only Setup

If you only set up for local development initially, you can configure production later:

1. **Run setup again** and choose "yes" for remote deployment configuration
2. **Provide production domain** when prompted
3. **Deploy** using `npm run deploy`

### Manual Production Setup

Alternatively, create `.prod.vars` manually based on `.dev.vars` but with:
- Production domain in `CUSTOM_DOMAIN`
- Production API keys and secrets
- `ENVIRONMENT="production"`

## Next Steps

Once setup is complete:

1. **Start developing** with `npm run dev`
2. **Visit** `http://localhost:5173` to access VibSDK
3. **Try generating** your first AI-powered application
4. **Deploy to production** when ready with `npm run deploy`

## File Structure After Setup

The setup script creates and modifies these files:

```
vibesdk/
├── .dev.vars              # Local development environment variables
├── .prod.vars             # Production environment variables (if configured)
├── wrangler.jsonc         # Updated with resource IDs and domain
├── vite.config.ts         # Updated for remote/local bindings
├── migrations/            # Database migration files
└── templates/             # Template repository (downloaded)
```

## Summary

The VibSDK setup script automates the entire configuration process, from Cloudflare resource creation to database setup. It supports both local-only development and full production deployment configuration, making it easy to get started regardless of your Cloudflare plan or requirements.

For any issues during setup, check the troubleshooting section above or refer to the comprehensive status report the script provides at the end. If issue persists, please open an issue on GitHub with the status report and any additional information you think would be helpful.
