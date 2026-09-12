# Buddy Next.js entry point

This app renders `../frontend/src/DemoApp.jsx` and proxies chat/preference requests
to OpenAI and the real Python optimizer. Run `npm run setup` and `npm run dev` from
the repository root to start both services. Configure the server-only OpenAI key
in `.env.local`; see [.env.example](.env.example).

See the root [README](../README.md) for demo prompts, setup, tests, and hosting,
and [PIPELINE.md](PIPELINE.md) for the current API contract.
