import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { useIsMobile } from "@/hooks/useMobile";
import { PanelLeft, LogOut, type LucideIcon } from "lucide-react";
import { useLocation } from "wouter";

export type DashboardNavItem = {
  label: string;
  path: string;
  icon: LucideIcon;
  allowedRoles?: string[];
};

export default function DashboardLayout({
  title,
  navItems,
  children,
}: {
  title: string;
  navItems: DashboardNavItem[];
  children: React.ReactNode;
}) {
  const { user, loading, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const visibleNavItems = user
    ? navItems.filter((item) => !item.allowedRoles || item.allowedRoles.includes(user.role))
    : navItems;

  if (loading) {
    return <DashboardLayoutSkeleton />;
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="w-full max-w-md rounded-3xl bg-card p-10 shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">登入後即可開始作業</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            這套系統提供站點作業、抽樣返工、工程師 KPI 與管理後台。請先登入以載入你的角色導向入口。
          </p>
          <Button className="mt-8 w-full" onClick={() => (window.location.href = getLoginUrl())}>
            立即登入
          </Button>
        </div>
      </div>
    );
  }

  return (
      <SidebarProvider>
      <Sidebar collapsible="icon" className="border-r border-[color:rgba(148,163,184,0.18)] bg-[linear-gradient(180deg,rgba(245,248,252,0.98),rgba(237,243,249,0.98))] backdrop-blur">

        <SidebarHeader className="h-16 justify-center border-b border-[color:rgba(148,163,184,0.16)] px-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <PanelLeft className="h-4 w-4" />
            </div>
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <p className="text-sm font-medium text-muted-foreground">倉儲站點作業</p>
              <p className="truncate text-base font-semibold tracking-tight">{title}</p>
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent className="px-2 py-4">
          <SidebarMenu>
            {visibleNavItems.map((item) => {
              const isActive = location === item.path;
              return (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton
                    isActive={isActive}
                    onClick={() => setLocation(item.path)}
                    tooltip={item.label}
                    className="h-11 rounded-2xl"
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarContent>

        <SidebarFooter className="border-t border-[color:rgba(148,163,184,0.16)] p-3">
          <div className="flex items-center gap-3 rounded-2xl border border-white/70 bg-white/88 p-3 shadow-[0_10px_24px_rgba(15,23,42,0.06)] group-data-[collapsible=icon]:justify-center">
            <Avatar className="h-10 w-10 border border-border/60">
              <AvatarFallback>{user.name?.charAt(0) ?? "U"}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <p className="truncate text-sm font-semibold">{user.name ?? "未命名使用者"}</p>
              <p className="truncate text-xs text-muted-foreground">{user.role}</p>
            </div>
            <Button variant="ghost" size="icon" className="ml-auto group-data-[collapsible=icon]:hidden" onClick={logout}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        {isMobile ? (
          <div className="sticky top-0 z-40 flex h-14 items-center border-b border-border/60 bg-background/95 px-3 backdrop-blur">
            <SidebarTrigger className="mr-3 h-9 w-9 rounded-xl" />
            <div>
              <p className="text-xs text-muted-foreground">MVP</p>
              <p className="text-sm font-semibold">{title}</p>
            </div>
          </div>
        ) : null}
        <main className="min-h-screen bg-[linear-gradient(180deg,rgba(244,247,251,0.45),rgba(250,252,255,0.7))] p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
