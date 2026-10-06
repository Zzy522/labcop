'use client';

import { Tabs as ArcoTabs } from '@arco-design/web-react';
import { cn } from '@/lib/utils';
import * as React from 'react';

// Map shadcn Tabs API to Arco Tabs
// shadcn: <Tabs value={} onValueChange={}><TabsList><TabsTrigger value="x"></TabsList><TabsContent value="x"></Tabs>
// Arco:  <Tabs activeTab={} onChange={}><Tabs.TabPane key="x" title="x">content</Tabs.TabPane></Tabs>

function Tabs({
  className,
  value,
  onValueChange,
  defaultValue,
  children,
  orientation,
}: {
  className?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  defaultValue?: string;
  children?: React.ReactNode;
  orientation?: 'horizontal' | 'vertical';
}) {
  const titles = new Map<string, React.ReactNode>();
  const panes: React.ReactElement<React.ComponentProps<typeof TabsContent>>[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement<{ children?: React.ReactNode; value?: string }>(child)) return;
    if (child.type === TabsList) {
      React.Children.forEach(child.props.children, (trigger) => {
        if (React.isValidElement<{ value?: string; children?: React.ReactNode }>(trigger)
          && trigger.type === TabsTrigger && trigger.props.value) {
          titles.set(trigger.props.value, trigger.props.children);
        }
      });
    } else if (child.type === TabsContent && child.props.value) {
      panes.push(child);
    }
  });

  return (
    <ArcoTabs
      {...(value === undefined ? {} : { activeTab: value })}
      onChange={(key) => onValueChange?.(key as string)}
      defaultActiveTab={defaultValue}
      className={cn("", className)}
      tabPosition={orientation === 'vertical' ? 'left' : 'top'}
    >
      {/* Arco reads the keys and titles of its direct TabPane children. */}
      {panes.map(({ props: { value: key, children: content, ...paneProps } }) => (
        <ArcoTabs.TabPane key={key} title={titles.get(key!)} {...paneProps}>
          {content}
        </ArcoTabs.TabPane>
      ))}
    </ArcoTabs>
  );
}

function TabsList({ className, children, variant, ...props }: React.HTMLAttributes<HTMLDivElement> & { variant?: string }) {
  // TabsList in Arco is handled internally; we pass children through
  return <div className={cn("hidden", className)} {...props}>{children}</div>;
}

function TabsTrigger({ className, value, children, ...props }: React.HTMLAttributes<HTMLButtonElement> & { value?: string }) {
  // TabsTrigger handled by Arco Tabs.TabPane title
  return <button className={cn("", className)} {...props}>{children}</button>;
}

function TabsContent({ className, value, children, ...props }: React.HTMLAttributes<HTMLDivElement> & { value?: string }) {
  // Render as TabPane
  return (
    <ArcoTabs.TabPane key={value} title="" className={cn("", className)} {...props}>
      {children}
    </ArcoTabs.TabPane>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
