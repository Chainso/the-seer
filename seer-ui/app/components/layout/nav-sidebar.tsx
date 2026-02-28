'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/app/lib/utils';
import { Button } from '@/app/components/ui/button';
import { Home, Network, Activity, Sparkles, Sun, Moon, Database, Bot, GitPullRequest } from 'lucide-react';

const navigation = [
  {
    name: 'Dashboard',
    href: '/',
    icon: Home,
  },
  {
    name: 'Ontology Explorer',
    href: '/ontology/overview',
    icon: Network,
  },
  {
    name: 'Change Intelligence',
    href: '/changes',
    icon: GitPullRequest,
  },
  {
    name: 'Process Inspector',
    href: '/inspector',
    icon: Activity,
  },
  {
    name: 'Object Store',
    href: '/inspector/history',
    icon: Database,
  },
  {
    name: 'Insights',
    href: '/inspector/insights',
    icon: Sparkles,
  },
  {
    name: 'Assistant',
    href: '/assistant',
    icon: Bot,
  },
];

export function NavSidebar() {
  const pathname = usePathname();
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === 'undefined') {
      return true;
    }
    const storedTheme = localStorage.getItem('theme');
    return storedTheme ? storedTheme === 'dark' : true;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  const toggleTheme = () => {
    setIsDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle('dark', next);
      localStorage.setItem('theme', next ? 'dark' : 'light');
      return next;
    });
  };

  return (
    <div className="flex h-full w-72 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center border-b border-sidebar-border px-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Seer</p>
            <p className="font-display text-lg">Atlas Explorer</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 space-y-2 p-5">
        {navigation.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </Link>
          );
        })}
      </nav>
      <div className="px-5 pb-6">
        <div className="rounded-2xl border border-sidebar-border bg-card p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Tip</p>
          <p className="mt-2 text-sm">
            Navigate ontology concepts as a connected system and verify model intent before shipping repo changes.
          </p>
        </div>
        <div className="mt-4 rounded-2xl border border-sidebar-border bg-card px-4 py-3">
          <Button
            variant="ghost"
            className="w-full justify-between"
            onClick={toggleTheme}
            aria-label="Toggle dark mode"
          >
            <span className="text-sm font-medium">Dark mode</span>
            <span className="relative inline-flex h-4 w-4 items-center justify-center">
              <Moon className="hidden h-4 w-4 dark:block" aria-hidden="true" />
              <Sun className="block h-4 w-4 dark:hidden" aria-hidden="true" />
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
