---
name: add-component
description: >
  Create new React components following FluidCalendar UI patterns.
  Use when adding UI components, pages, modals, or settings panels.
  Triggers: "add component", "create page", "new modal", "new UI",
  "add settings tab", "create form", "new view", "add feature UI".
  Ensures correct Shadcn usage, SAAS/OSS patterns, store integration,
  and import conventions.
---

# Add Component

## When to Use
- Creating new React components
- Adding pages or settings tabs
- Building modals, forms, or list views
- Creating SAAS/OSS variant components

## Step-by-Step Process

### 1. Choose the location
```
src/components/<feature>/ComponentName.tsx   # Feature component
src/app/(common)/<page>/page.tsx             # Shared page
src/app/(open)/<page>/page.open.tsx          # OSS-only page
src/app/(saas)/<page>/page.saas.tsx          # SAAS-only page
```

### 2. Component template
```tsx
import { useCallback, useState } from "react";

import { SomeIcon } from "react-icons/hi";

import { Button } from "@/components/ui/button";
import { useTaskStore } from "@/store/task";
import { Task } from "@/types/task";

interface ComponentNameProps {
  initialData?: Task[];
  onSave: (data: Task) => void;
}

export function ComponentName({ initialData, onSave }: ComponentNameProps) {
  const { tasks, fetchTasks } = useTaskStore();
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async () => {
    setLoading(true);
    try {
      // ...
      onSave(result);
    } finally {
      setLoading(false);
    }
  }, [onSave]);

  return (
    <div className="flex flex-col gap-4">
      <h2>Component Title</h2>
      <Button onClick={handleSubmit} disabled={loading}>
        {loading ? "Saving..." : "Save"}
      </Button>
    </div>
  );
}
```

### 3. SAAS/OSS variant pattern
When a component needs different implementations:
```tsx
// ComponentName.open.tsx (OSS version)
export default function ComponentName() { /* OSS implementation */ }

// ComponentName.saas.tsx (SAAS version)
export default function ComponentName() { /* SAAS implementation */ }

// Parent that loads the correct variant:
import dynamic from "next/dynamic";

const ComponentName = dynamic(
  () => import(`./ComponentName${process.env.NEXT_PUBLIC_ENABLE_SAAS_FEATURES === "true" ? ".saas" : ".open"}`),
  { ssr: false }
);
```

### 4. Forms with React Hook Form + Zod
```tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const schema = z.object({
  title: z.string().min(1, "Title required"),
  dueDate: z.date().optional(),
});

type FormData = z.infer<typeof schema>;

export function MyForm() {
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });
  // ...
}
```

### 5. Consider command palette integration
If the new feature should be keyboard-accessible, add to `src/lib/commands/`:
```typescript
// Register in the commands system
{ id: "feature-action", name: "Do Thing", action: () => { /* ... */ } }
```

## Key Files
- `src/components/ui/` - Shadcn base components (Button, Dialog, Form, etc.)
- `src/components/providers/` - Context providers
- `src/hooks/useAdmin.ts` - Admin access check
- `src/hooks/useCommands.ts` - Command palette hook
- `src/lib/config.ts` - `isSaasEnabled`, `isFeatureEnabled()`
- `src/store/` - Zustand stores

## UI Guidelines
- **Shadcn**: Use existing components from `src/components/ui/`. Add new ones: `npx shadcn@latest add <name>`
- **Icons**: `react-icons` (import from `react-icons/hi`, `react-icons/fi`, etc.)
- **Toasts**: `sonner` for notifications
- **Styling**: Tailwind CSS utilities, mobile-first
- **Dark mode**: Supported via `next-themes` and CSS variables
- **Text**: Use `&apos;` and `&quot;` instead of literal quotes in JSX

## Admin-Only Features
```tsx
import { useAdmin } from "@/hooks/useAdmin";
import { AccessDeniedMessage } from "@/components/auth/AccessDeniedMessage";
import { AdminOnly } from "@/components/auth/AdminOnly";

// Option 1: Hook
const { isAdmin } = useAdmin();
if (!isAdmin) return <AccessDeniedMessage message="Admin only" />;

// Option 2: Wrapper
<AdminOnly fallback={<AccessDeniedMessage />}>
  {/* Admin content */}
</AdminOnly>
```

## Common Pitfalls
- Using `lucide-react` for new icons (use `react-icons` instead)
- Forgetting SAAS/OSS consideration (ask if unsure)
- Not using Shadcn for standard UI elements (buttons, dialogs, forms)
- Using literal quotes in JSX instead of HTML entities
- Not considering command palette integration for new features
