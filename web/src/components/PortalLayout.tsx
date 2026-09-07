import { ReactNode } from 'react';
import { TopBar } from './TopBar';
import { Sidebar, SidebarItem } from './Sidebar';

interface PortalLayoutProps {
  breadcrumb: string;
  rolLabel: string;
  sidebarItems: SidebarItem[];
  children: ReactNode;
}

export function PortalLayout({ breadcrumb, rolLabel, sidebarItems, children }: PortalLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar breadcrumb={breadcrumb} />
      <div className="flex flex-1">
        <Sidebar rolLabel={rolLabel} items={sidebarItems} />
        <main className="flex-1 bg-white px-8 py-6">{children}</main>
      </div>
    </div>
  );
}
