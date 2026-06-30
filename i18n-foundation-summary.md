# i18n Foundation Setup — Issue #173

## Completed

### package.json
- Added `"next-intl": "^4.0.0"` dependency

### next.config.ts
- Imported `createNextIntlPlugin` from `next-intl/plugin`
- Wrapped the config with `withNextIntl(nextConfig)` pointing to `./src/lib/i18n/request.ts`

### src/lib/i18n/request.ts
- `getRequestConfig` from `next-intl/server` that loads the locale and messages
- Dynamically imports the correct message file based on locale

### src/lib/i18n/config.ts
- `locales`, `Locale`, `defaultLocale` constants
- `routing` config with `localePrefix: 'never'` (no URL prefix for single locale)
- Exports `Link`, `redirect`, `usePathname`, `useRouter` from `createNavigation`

### src/lib/i18n/messages/en.json
- ~300+ translation keys across 11 namespaces:
  - `navigation` — sidebar/header labels, app name, roles
  - `auth` — login/signup/forgot-password forms and validation
  - `inbox` — conversation list, message thread, contact sidebar, composer
  - `contacts` — table, CRUD, custom fields
  - `pipeline` — pipelines, stages, deals, analytics
  - `broadcast` — list, creation, status cells
  - `automation` — list, cards, triggers, actions
  - `flows` — list, cards, triggers, status labels
  - `settings` — all 9 sections with nested subsection keys
  - `dashboard` — metric cards, chart labels, range buttons
  - `common` — buttons, states, pagination, errors, validation

## How to adopt (for contributors)

**Server components:**
```ts
import { getTranslations } from 'next-intl/server';

export default async function Page() {
  const t = await getTranslations('inbox');
  return <h1>{t('title')}</h1>;
}
```

**Client components:**
```ts
import { useTranslations } from 'next-intl';

export default function Component() {
  const t = useTranslations('common');
  return <button>{t('save')}</button>;
}
```

**Navigation (locale-aware):**
```ts
import { Link, useRouter, usePathname } from '@/lib/i18n/config';
```

## Next steps
1. Update root layout to wrap client components with `NextIntlClientProvider` (optional for now — server components work without it)
2. Incrementally replace hardcoded strings in components with `t('key')` calls
3. Add more locale files (e.g. `es.json`, `fr.json`) when ready to support additional languages
