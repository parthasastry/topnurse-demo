# TopNurse Web

React + Vite + TypeScript + Tailwind CSS + **AWS Amplify UI** (wealth-ai-llc pattern). Candidate portal, recruiter portal, and shared UI.

## Auth (Amplify UI + Cognito)

- **@aws-amplify/ui-react** — `<Authenticator>` (sign-in, sign-up, sign-out).
- **aws-amplify** — Configured in `src/amplify-config.ts` from env.
- Copy `apps/web/.env.example` to `apps/web/.env` and set:
  - `VITE_USER_POOL_ID` — Cognito User Pool ID (CDK output).
  - `VITE_USER_POOL_CLIENT_ID` — Cognito App Client ID (CDK output).
  - `VITE_AWS_REGION` — e.g. `us-west-1`.
  - `VITE_API_URL` — API Gateway base URL (CDK output **ApiUrl**). Used for the hospitals list (GET /hospitals) on sign-up. Without it, the recruiter hospital dropdown is empty.

## Commands

```bash
# From repo root
npm run web:dev     # Start dev server (http://localhost:5173)
npm run web:build   # Production build
npm run web:preview # Preview production build

# Or from apps/web
cd apps/web && npm run dev
```

## Stack

- **Vite** — dev server and build
- **React 18** + **TypeScript**
- **Tailwind CSS 3** — utility-first CSS (PostCSS)
- **AWS Amplify UI** — Authenticator, Cognito-backed auth
- Path alias: `@/` → `src/`

## Structure

- `src/main.tsx` — entry
- `src/App.tsx` — root component
- `src/index.css` — Tailwind directives
- `public/` — static assets
