import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth0 } from "@/lib/auth0";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  const t = await getTranslations("adminLayout");
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="flex items-center justify-between border-b bg-white px-6 py-3">
        <a href="/admin" className="font-semibold tracking-tight">PhonoManager</a>
        <a href="/auth/logout" className="text-sm text-neutral-500 hover:text-neutral-900">{t("logout")}</a>
      </header>
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
