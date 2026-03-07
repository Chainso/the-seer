'use client';

import { useEffect, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/app/lib/utils';
import { Button } from '@/app/components/ui/button';
import { Network, Sparkles, Sun, Moon, Database, Bot } from 'lucide-react';

const THEME_STORAGE_KEY = 'theme';
const THEME_CHANGE_EVENT = 'seer-theme-change';

const navigation = [
  {
    name: 'Ontology Explorer',
    href: '/ontology/overview',
    icon: Network,
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

interface NavSidebarProps {
  variant?: 'desktop' | 'drawer';
  onNavigate?: () => void;
}

function getThemeSnapshot(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  return storedTheme ? storedTheme === 'dark' : true;
}

function subscribeToTheme(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key && event.key !== THEME_STORAGE_KEY) {
      return;
    }
    onStoreChange();
  };
  const handleThemeChange = () => {
    onStoreChange();
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
  };
}

export function NavSidebar({ variant = 'desktop', onNavigate }: NavSidebarProps) {
  const pathname = usePathname();
  const isDark = useSyncExternalStore(subscribeToTheme, getThemeSnapshot, () => true);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light');
  }, [isDark]);

  const toggleTheme = () => {
    const nextTheme = !isDark;
    document.documentElement.classList.toggle('dark', nextTheme);
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme ? 'dark' : 'light');
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  };

  const containerClassName =
    variant === 'drawer'
      ? 'flex h-full w-[min(20rem,calc(100vw-1.5rem))] max-w-full flex-col rounded-r-[28px] border-r border-sidebar-border bg-sidebar pb-[env(safe-area-inset-bottom)] text-sidebar-foreground shadow-[0_18px_60px_-28px_black]'
      : 'flex h-full w-72 flex-col border-r bg-sidebar text-sidebar-foreground';

  return (
    <div className={containerClassName}>
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
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={onNavigate}
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
        <div className="rounded-2xl border border-sidebar-border bg-card px-4 py-3">
          <Button
            variant="ghost"
            className="w-full justify-between"
            onClick={toggleTheme}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            <span className="text-sm font-medium">{isDark ? 'Light mode' : 'Dark mode'}</span>
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
