import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { LogIn, ShieldCheck } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const nextPath = useMemo(() => {
    if (typeof window === "undefined") return "/";
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    return next && next.startsWith("/") ? next : "/";
  }, []);

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: async () => {
      setErrorMessage(null);
      await utils.auth.me.invalidate();
      setLocation(nextPath);
    },
    onError: (error) => {
      setErrorMessage(error.message || "登入失敗，請再試一次");
    },
  });

  useEffect(() => {
    if (meQuery.data) {
      setLocation(nextPath);
    }
  }, [meQuery.data, nextPath, setLocation]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    await loginMutation.mutateAsync({
      username: username.trim(),
      password,
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f7fa] px-6 py-10">
      <Card className="w-full max-w-md rounded-[32px] border-0 bg-white shadow-sm">
        <CardHeader className="space-y-4 p-8 pb-0">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-[0.2em] text-slate-500">本地帳密登入</p>
            <CardTitle className="mt-3 text-3xl font-black tracking-tight text-slate-900">
              登入回收品檢系統
            </CardTitle>
          </div>
          <p className="text-sm leading-7 text-slate-600">
            請輸入管理者建立的帳號與密碼。登入後，系統會依你的角色導向對應入口。
          </p>
        </CardHeader>
        <CardContent className="p-8">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700" htmlFor="username">
                帳號
              </label>
              <input
                id="username"
                autoComplete="username"
                className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                placeholder="請輸入帳號"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700" htmlFor="password">
                密碼
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                placeholder="請輸入密碼"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            {errorMessage ? (
              <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{errorMessage}</div>
            ) : null}

            <Button className="h-12 w-full rounded-2xl" disabled={loginMutation.isPending || meQuery.isLoading} type="submit">
              <LogIn className="mr-2 h-4 w-4" />
              {loginMutation.isPending ? "登入中..." : "登入系統"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
